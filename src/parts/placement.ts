import { Vector3 } from 'three'
import { extensionFor, materialPoint } from './mountGeometry'
export { extensionFor, materialPoint } from './mountGeometry'
import { planSupportedPart } from './supportPlanning'
import { builtinPart } from './catalog'
import { backdropForBook } from './backdrop'
import { evaluateBookParts, validateBookParts } from './book'
import { evaluatePartReference, evaluatedOutput } from './evaluate'
import { faceContains, faceCorners, makeFace, pagePorts, pointOnFace, type PaperFace, type PartPort, type FoldPair } from './geometry'
import { parameterValues, type PartBinding, type PartInstance, type PartReference, type PartSurfaceRef } from './schema'
import { createStageElement } from '../schema/bookDefaults'
import type { BookProject } from '../schema/bookPackage'
import type { Spread } from '../schema/book'

export interface SurfacePick { surface: PartSurfaceRef; point: [number, number] }
export interface PlacementSurface { reference: PartSurfaceRef; face: PaperFace }
export type PlacementFailure = 'sameFace' | 'noHinge' | 'angleLimit' | 'connection' | 'stow' | 'dimensions' | 'cutout' | 'missing'
export type PartPlacementPlan = { ok: true; instance: PartInstance; bridgeCount: number }
  | { ok: false; reason: PlacementFailure; detail: string }

export function placementSurfaces(project: BookProject, spread: Spread, leftAngle = Math.PI, rightAngle = 0): PlacementSurface[] {
  const { pageWidth, pageAspect } = project.book.format
  const book = pagePortsForPlacement(pageWidth, pageWidth / pageAspect, leftAngle, rightAngle)
  const result: PlacementSurface[] = Object.entries(book).map(([portId, face]) => ({ reference: { nodeId: '$book', portId }, face }))
  for (const [nodeId, node] of Object.entries(evaluateBookParts(project, spread, leftAngle, rightAngle).nodes)) {
    for (const face of node.faces) {
      const port = Object.entries(node.ports).find(([, port]) => port.kind === 'surface' && port.face.id === face.id)
      result.push({ reference: { nodeId, portId: port?.[0] ?? `face:${face.id.slice(nodeId.length + 1)}` }, face })
    }
  }
  return result
}
function pagePortsForPlacement(width: number, depth: number, left: number, right: number) {
  const ports = pagePorts(width, depth, left, right)
  return { 'right-page': (ports['right-page'] as Extract<PartPort, { kind: 'surface' }>).face,
    'left-page': (ports['left-page'] as Extract<PartPort, { kind: 'surface' }>).face }
}
function surfaceAt(project: BookProject, spread: Spread, reference: PartSurfaceRef, angle: number): PaperFace {
  const { pageWidth, pageAspect } = project.book.format
  const result = evaluateBookParts(project, spread, angle, 0)
  const port = reference.nodeId === '$book' ? pagePorts(pageWidth, pageWidth / pageAspect, angle, 0)[reference.portId]
    : result.nodes[reference.nodeId] && evaluatedOutput(result.nodes[reference.nodeId], reference.portId, reference.nodeId)
  if (port?.kind !== 'surface') throw new Error('Placement surface is missing')
  return port.face
}
function failure(error: unknown): Extract<PartPlacementPlan, { ok: false }> {
  const detail = error instanceof Error ? error.message : String(error)
  const reason: PlacementFailure = detail.includes('same face') ? 'sameFace' : detail.includes('common hinge') ? 'noHinge'
    : detail.includes('Opening angle') ? 'angleLimit' : detail.includes('Closed part') ? 'stow' : detail.includes('cut-out') ? 'cutout'
      : /Parameter|dimensions|width|bounds|Glued part/.test(detail) ? 'dimensions' : detail.includes('missing') ? 'missing' : 'connection'
  return { ok: false, reason, detail }
}

/** クリック位置から材料座標の接続を作る。ホバーと確定で同じ全開閉検査を使う。 */
export function planPartPlacement(project: BookProject, spreadId: string, reference: PartReference, first: SurfacePick, second?: SurfacePick): PartPlacementPlan {
  try {
    const spread = project.book.spreads.find((item) => item.id === spreadId)
    if (!spread) throw new Error('Placement spread is missing')
    const definition = 'builtin' in reference ? builtinPart(reference.builtin, reference.version) : project.partDefinitions?.[reference.custom]
    if (!definition) throw new Error('Part definition is missing')
    const sourceA = surfaceAt(project, spread, first.surface, Math.PI)
    if (!faceContains(sourceA, pointOnFace(sourceA, ...first.point))) throw new Error('Placement point is outside its surface')
    let mount: PartBinding, parameters: Record<string, number> = {}
    if ('builtin' in reference && reference.builtin === 'upright' && second) {
      const sourceB = surfaceAt(project, spread, second.surface, Math.PI)
      if (!faceContains(sourceB, pointOnFace(sourceB, ...second.point))) throw new Error('Placement point is outside its surface')
      if (sourceA.id !== sourceB.id && Math.abs(sourceA.u.clone().cross(sourceA.v).y) > .9 && sourceB.v.y > .5) {
        const candidate = { ...createStageElement('part'), id: '__placement__', type: 'part' as const, part: { definition: reference, mount: { type: 'output' as const, nodeId: '$book', portId: 'gutter' }, parameters: {}, materials: {} } }
        const planned = planSupportedPart(project, spread, candidate, { position: pointOnFace(sourceA, ...first.point).toArray(), surfaces: [first.surface, second.surface] })
        const result = evaluateBookParts(project, { ...spread, elements: [...spread.elements, planned] }, Math.PI, 0)
        return { ok: true, instance: planned.part, bridgeCount: result.nodes.__placement__.faces.filter(face => face.id.includes('/mount/')).length }
      }
    }
    if (definition.input.kind === 'surface') {
      mount = { type: 'output', ...first.surface }
      if ('builtin' in reference) {
        const p = parameterValues(definition.parameters, {})
        // 面全体を貼る部品には、接着辺用の余白を付けない。支持紙を飾り縁として露出させない。
        const bounds = extensionFor(sourceA, [[first.point[0] - p.width / 2, first.point[1] - p.height / 2],
          [first.point[0] + p.width / 2, first.point[1] + p.height / 2]], { margin: 0 })
        if (bounds) mount.extension = bounds
        parameters = { u: first.point[0] - (bounds ? (bounds.min[0] + bounds.max[0]) / 2 : sourceA.width / 2),
          v: first.point[1] - (bounds?.min[1] ?? 0) }
      } else {
        // 定義内の相対配置を保ったまま、部品全体の中心をクリック位置へ合わせる。
        const input = makeFace('placement-mount/surface', sourceA.origin.clone(), sourceA.u, sourceA.v, 80, 80)
        const probe = evaluatePartReference(reference, { kind: 'surface', face: input }, project.partDefinitions ?? {})
        const points = probe.faces.flatMap(faceCorners).map((point) => materialPoint(sourceA, point))
        if (!points.length) throw new Error('Part has no material faces')
        const origin = [0, 1].map((axis) => first.point[axis] - (Math.min(...points.map((p) => p[axis])) + Math.max(...points.map((p) => p[axis]))) / 2) as [number, number]
        mount.frame = { origin, width: 80, height: 80 }
        mount.extension = extensionFor(sourceA, points.map(([u, v]) => [u + origin[0], v + origin[1]]), { margin: 0 })
      }
    } else {
      if (!second) throw new Error('Second placement surface is missing')
      const sourceB = surfaceAt(project, spread, second.surface, Math.PI)
      if (sourceA.id === sourceB.id) throw new Error('Cannot select the same face twice')
      if (!faceContains(sourceB, pointOnFace(sourceB, ...second.point))) throw new Error('Placement point is outside its surface')
      if ('builtin' in reference && reference.builtin === 'backdrop' && reference.version === 2
        && [first.surface, second.surface].every((face) => face.nodeId === '$book' && ['left-page', 'right-page'].includes(face.portId))) {
        // 背景は左右ページを選んだ順序によらず、見開きの奥へ広がる屏風として配置する。
        mount = { type: 'output', nodeId: '$book', portId: 'gutter' }
        parameters = backdropForBook(project.book.format.pageWidth, project.book.format.pageWidth / project.book.format.pageAspect)
      } else {
        let firstPoint = first.point
        if ('builtin' in reference && reference.builtin === 'backdrop'
          && [first.surface, second.surface].every((face) => face.nodeId === '$book' && ['left-page', 'right-page'].includes(face.portId))) {
          // 左右ページの指定は接続面の選択。紙端を触っても、背景と支持紙が収納できる位置へ寄せる。
          // 背景は閉状態で地面の接着位置から高さ分だけ外へ倒れる。寸法や途中姿勢は変えない。
          const { width, height, distance } = definition.parameters
          const minU = width.default / 2, maxU = sourceA.width - minU, maxV = sourceA.height - height.default
          if (minU > maxU || distance.min > maxV) throw new Error('Backdrop dimensions exceed the closed page bounds')
          firstPoint = [Math.max(minU, Math.min(maxU, first.point[0])), Math.max(distance.min, Math.min(maxV, first.point[1]))]
        }
        // 全開時に平行な面でも、途中姿勢の材料座標から実際の共通折り線を求められる。
        let pair: { a: PaperFace; b: PaperFace; axis: Vector3; origin: Vector3 } | undefined
        for (const angle of [150, 120, 90, 60]) {
          const a = surfaceAt(project, spread, first.surface, angle * Math.PI / 180), b = surfaceAt(project, spread, second.surface, angle * Math.PI / 180)
          const na = a.u.clone().cross(a.v), nb = b.u.clone().cross(b.v), cross = na.clone().cross(nb)
          if (cross.lengthSq() < 1e-10) continue
          const origin = nb.clone().cross(cross).multiplyScalar(na.dot(a.origin))
            .addScaledVector(cross.clone().cross(na), nb.dot(b.origin)).divideScalar(cross.lengthSq())
          const axis = cross.normalize()
          if (axis.dot(a.u) < -1e-7 || Math.abs(axis.dot(a.u)) < 1e-7 && axis.dot(a.v) < 0) axis.negate()
          origin.addScaledVector(axis, pointOnFace(a, ...firstPoint).sub(origin).dot(axis))
          pair = { a, b, axis, origin }; break
        }
        if (!pair) throw new Error('The selected faces do not have a driven common hinge')
        const { a, b, axis, origin } = pair
        const direction = (face: PaperFace, point: [number, number]) => {
          const ray = face.u.clone().cross(face.v).cross(axis).normalize()
          const delta = pointOnFace(face, ...point).sub(origin)
          return { sign: ray.dot(delta) < -1e-7 ? 'negative' as const : 'positive' as const, ray: ray.multiplyScalar(ray.dot(delta) < -1e-7 ? -1 : 1) }
        }
        const da = direction(a, firstPoint), db = direction(b, second.point)
        if ('builtin' in reference && definition.parameters.distance) {
          parameters.distance = Math.max(definition.parameters.distance.min, pointOnFace(a, ...firstPoint).sub(origin).dot(da.ray))
          parameters.offset = 0
        }
        const foldSign = axis.dot(da.ray.clone().cross(db.ray)) < 0 ? -1 as const : 1 as const
        const line = (face: PaperFace, width: number): [[number, number], [number, number]] => [
          materialPoint(face, origin.clone().addScaledVector(axis, -width / 2)), materialPoint(face, origin.clone().addScaledVector(axis, width / 2))]
        const binding: Extract<PartBinding, { type: 'pair' }> = { type: 'pair', a: first.surface, b: second.surface,
          hingeA: line(a, 80), hingeB: line(b, 80), directionA: da.sign, directionB: db.sign, foldSign }
        // 必要な接着領域を測る段階だけ、十分に広い入力面で評価する。実支持紙は後で絞り込む。
        const input: FoldPair = { kind: 'fold-pair', a: makeFace('placement-mount/a', pointOnFace(a, -80, -80), a.u, a.v, 160, 160),
          b: makeFace('placement-mount/b', pointOnFace(b, -80, -80), b.u, b.v, 160, 160),
          axis, origin, rayA: da.ray, rayB: db.ray, width: 80, extentA: 80, extentB: 80, foldSign }
        const probe = evaluatePartReference(reference, input, project.partDefinitions ?? {}, parameters)
        const corners = probe.faces.flatMap(faceCorners)
        const width = Math.max(.05, ...corners.map((point) => Math.abs(point.clone().sub(origin).dot(axis)) * 2))
        binding.hingeA = line(a, width); binding.hingeB = line(b, width)
        const contacts = (face: PaperFace, portFace: PaperFace) => probe.connections.filter((edge) => edge.parentFace === portFace.id)
          .flatMap((edge) => edge.expected.map((point) => materialPoint(face, point)))
        binding.extensions = { a: extensionFor(a, contacts(a, input.a), { hinge: binding.hingeA }),
          b: extensionFor(b, contacts(b, input.b), { hinge: binding.hingeB }) }
        mount = binding
      }
    }
    const instance: PartInstance = { definition: reference, mount, parameters, materials: {} }
    const element = { ...createStageElement('part'), id: '__placement__', part: instance }
    const candidate = { ...project, book: { ...project.book, spreads: project.book.spreads.map((item) => item.id === spreadId ? { ...item, elements: [...item.elements, element] } : item) } }
    const errors = validateBookParts(candidate)
    if (errors.length) throw new Error(errors.join('\n'))
    const result = evaluateBookParts(candidate, candidate.book.spreads.find((item) => item.id === spreadId)!, Math.PI, 0)
    return { ok: true, instance, bridgeCount: result.nodes.__placement__.faces.filter((face) => face.id.includes('/mount/')).length }
  } catch (error) { return failure(error) }
}
