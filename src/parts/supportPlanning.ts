import { Vector3 } from 'three'
import type { BookProject } from '../schema/bookPackage'
import type { Spread } from '../schema/book'
import type { PartElement } from '../schema/stageElement'
import { evaluateBookParts, deployBookParts, validateBookParts, bookContentHoldTime } from './book'
import { bindBookContents } from './contents'
import { inspectContentMotion } from './contentValidation'
import { dependentPartIds, evaluatedOutput } from './evaluate'
import { faceShape, faceContains, makeFace, logicalPagePorts as pagePorts, pointOnFace, type PaperFace, type FoldPair, type PartPort } from './geometry'
import { inspectIntersections } from './intersections'
import { createPaperMotionInspector, inspectClosedLayout, validatePartDefinition } from './validate'
import type { PartBinding, PartInstance, PartSurfaceRef, PartDefinition, PartDefinitions } from './schema'
import { builtinPart } from './catalog'
import { clearFictionSupportCrossings } from './contentPlacement'
import { parameterValues, evaluateExpression } from './schema'
import { newPartDefinition } from './schema'
import { connectedContentSchema } from '../schema/content'
import { extensionFor, materialPoint } from './mountGeometry'

const round = (n: number) => Math.round(n * 1e9) / 1e9
type Interval = [number, number]

export function supportHeights(height: number, parentHeight: number, hasAttachedMotion = false): number[] {
  const ceiling = Math.min(height - .03, parentHeight - .03), baseline = Math.min(height * .5, ceiling)
  return [...new Set([baseline, ...[.6, .7, .8, .9, ...hasAttachedMotion ? [.45, .4, .35, .3, .25, .2, .175, .15, .125, .1] : []]
    .map(r => Math.min(height * r, ceiling))].map(round))].filter(h => h >= .05)
}

/** 共有する複合部品は本の時刻に依存せず、入力角と内部演出の組み合わせで支持を設計する。 */
export function designAutomaticDefinitionSupports(definition: PartDefinition, definitions: PartDefinitions): void {
  for (const node of definition.nodes) {
    if (node.supportDesign !== 'automatic' || !('builtin' in node.definition) || node.definition.builtin !== 'upright') continue
    const values = parameterValues(definition.parameters, {})
    const p = parameterValues(builtinPart('upright', 1).parameters,
      Object.fromEntries(Object.entries(node.parameters).map(([key, value]) => [key, evaluateExpression(value, values)])))
    const motion = definition.contents?.some(({ element, tracks }) => element.attachment.type === 'surface'
      && element.attachment.surface.nodeId === node.id && (element.motion.length || tracks.some(track => track.property.startsWith('rotation'))))
    let errors: string[] = []
    for (const height of supportHeights(p.height, p.height, motion)) {
      node.parameters.supportHeight = height
      const result = validatePartDefinition(definition, definitions)
      if (result.ok) { errors = []; break }
      errors = result.errors
    }
    if (errors.length) throw new Error(errors[0])
  }
}

function attachedMotionCeiling(spread: Spread, element: PartElement, distance: number): number | undefined {
  const attached = spread.elements.filter(e => e.attachment?.type === 'surface' && e.attachment.surface.nodeId === element.id && e.motion.length > 0)
  if (!attached.length) return undefined
  // 絵のファイルを要しない材料・演出の検査用定義。画像の寸法と輪郭は元の値を使う。
  const probe = newPartDefinition('Support design', { kind: 'fold-pair', maxOpeningAngleDeg: 90 })
  probe.requiredBuiltins = { upright: 1 }
  probe.nodes = [{ id: element.id, name: element.name, ...element.part, supportDesign: 'automatic', mount: { type: 'input' },
    parameters: { ...element.part.parameters, distance }, materials: {} }]
  probe.contents = attached.map(e => ({ element: connectedContentSchema.parse({ ...e, image: undefined }),
    tracks: spread.timeline.tracks.filter(t => t.target.type === 'element' && t.target.elementId === e.id && t.property !== 'visual.image') }))
  designAutomaticDefinitionSupports(probe, {})
  return probe.nodes[0].parameters.supportHeight as number
}

/** 輪郭・穴・補完紙を同じ材料座標で横切り、接着できる区間だけを返す。 */
export function attachmentIntervals(face: PaperFace, center: Vector3, axis: Vector3, vertical: Vector3): Interval[] {
  const cuts: number[] = []
  const boundaries = (surface: PaperFace) => {
    const shape = faceShape(surface)
    for (const ring of [shape.outer, ...shape.holes]) {
      const points = ring.map(([u, v]) => {
        const delta = pointOnFace(surface, u * surface.width, v * surface.height).sub(center)
        return [delta.dot(axis), delta.dot(vertical)]
      })
      for (const [i, a] of points.entries()) {
        const b = points[(i + 1) % points.length]
        if (Math.abs(a[1]) < 1e-8) cuts.push(a[0])
        if (a[1] * b[1] < 0) cuts.push(a[0] + (b[0] - a[0]) * -a[1] / (b[1] - a[1]))
      }
    }
    surface.contactRegions?.forEach(boundaries)
  }
  boundaries(face); cuts.sort((a, b) => a - b)
  const intervals: Interval[] = []
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1], b = cuts[i]
    if (b - a < 1e-8 || !faceContains(face, center.clone().addScaledVector(axis, (a + b) / 2))) continue
    if (intervals.length && Math.abs(intervals.at(-1)![1] - a) < 1e-8) intervals.at(-1)![1] = b
    else intervals.push([a, b])
  }
  return intervals
}

interface SupportSource { pair: FoldPair; a: PartSurfaceRef; b: PartSurfaceRef }
export interface SupportPlacement {
  position: [number, number, number]
  /** 面をクリックした場合はその二面を守る。省略時だけ既存の実面から接続先を探す。 */
  surfaces?: [PartSurfaceRef, PartSurfaceRef]
}
const same = (a: PartSurfaceRef, b: PartSurfaceRef) => a.nodeId === b.nodeId && a.portId === b.portId

function sources(project: BookProject, spread: Spread, excluded: Set<string>, selected?: [PartSurfaceRef, PartSurfaceRef], target?: Vector3): SupportSource[] {
  const paper = evaluateBookParts(project, spread, Math.PI, 0)
  const { pageWidth: w, pageAspect } = project.book.format, pages = pagePorts(w, w / pageAspect, Math.PI, 0)
  if (selected && target) {
    const face = (ref: PartSurfaceRef) => {
      const port = ref.nodeId === '$book' ? pages[ref.portId] : paper.nodes[ref.nodeId] && evaluatedOutput(paper.nodes[ref.nodeId], ref.portId, ref.nodeId)
      if (port?.kind !== 'surface') throw new Error('Support surface is missing')
      return port.face
    }
    const a = face(selected[0]), b = face(selected[1]), na = a.u.clone().cross(a.v), nb = b.u.clone().cross(b.v), cross = na.clone().cross(nb)
    if (cross.lengthSq() > 1e-10) {
      const origin = nb.clone().cross(cross).multiplyScalar(na.dot(a.origin))
        .addScaledVector(cross.clone().cross(na), nb.dot(b.origin)).divideScalar(cross.lengthSq())
      const axis = cross.normalize(); if (axis.dot(b.u) < 0) axis.negate()
      origin.addScaledVector(axis, target.clone().sub(origin).dot(axis))
      const rayA = na.clone().cross(axis).normalize(), rayB = nb.clone().cross(axis).normalize()
      if (rayA.dot(target.clone().sub(origin)) < 0) rayA.negate()
      if (rayB.dot(pointOnFace(b, b.width / 2, b.height / 2).sub(origin)) < 0) rayB.negate()
      return [{ a: selected[0], b: selected[1], pair: { kind: 'fold-pair', a, b, origin, axis, rayA, rayB,
        extentA: 160, extentB: 160, width: 160, foldSign: axis.dot(rayA.clone().cross(rayB)) < 0 ? -1 : 1 } }]
    }
  }
  const reference = (face: PaperFace): PartSurfaceRef => {
    for (const [nodeId, ports] of [['$book', pages], ...Object.entries(paper.nodes).map(([id, node]) => [id, node.ports])] as [string, Record<string, PartPort>][]) {
      for (const [portId, port] of Object.entries(ports)) if (port.kind === 'surface' && port.face.id === face.id) return { nodeId, portId }
    }
    for (const [nodeId, node] of Object.entries(paper.nodes)) if (node.faces.some(f => f.id === face.id)) return { nodeId, portId: `face:${face.id.slice(nodeId.length + 1)}` }
    throw new Error(`Support surface is missing: ${face.id}`)
  }
  const found: SupportSource[] = []
  for (const [nodeId, node] of Object.entries(paper.nodes)) {
    if (excluded.has(nodeId)) continue
    for (const pair of Object.values(node.ports)) {
      if (pair.kind !== 'fold-pair' || pair.b.support || pair.a.support) continue
      if (!selected && (pair.rayA.z < .85 || Math.abs(pair.rayA.y) > 1e-5)) continue
      const a = reference(pair.a), b = reference(pair.b)
      if (!excluded.has(a.nodeId) && !excluded.has(b.nodeId) && !found.some(s => s.pair.a.id === pair.a.id && s.pair.b.id === pair.b.id)) found.push({ pair, a, b })
    }
    // 公開二面口のない側方部品や複合部品も、接地した実面から候補を作る。
    for (const face of node.faces) {
      if (face.support || face.v.y < .85 || Math.abs(face.origin.y) > 1e-6 || Math.abs(face.u.y) > 1e-6 || found.some(s => s.pair.b.id === face.id)) continue
      const rayA = face.u.clone().cross(face.v); if (rayA.z < 0) rayA.negate()
      if (rayA.z < .85) continue
      const origin = pointOnFace(face, face.width / 2, 0), pageId = (target?.x ?? origin.x) >= 0 ? 'right-page' : 'left-page'
      const page = pages[pageId]; if (page.kind !== 'surface') continue
      found.push({ a: { nodeId: '$book', portId: pageId }, b: reference(face), pair: { kind: 'fold-pair', a: page.face, b: face,
        origin, axis: face.u, rayA, rayB: face.v, extentA: Infinity, extentB: face.height, width: face.width,
        foldSign: face.u.dot(rayA.clone().cross(face.v)) < 0 ? -1 : 1 } })
    }
  }
  return found
}

function mountAt(source: SupportSource, target: Vector3, width: number, height: number, supportWidth: number, offset: number): PartBinding {
  const { pair } = source
  const origin = pair.origin.clone().addScaledVector(pair.axis, target.clone().sub(pair.origin).dot(pair.axis))
  const line = (face: PaperFace): [Interval, Interval] => [-1, 1].map(sign => materialPoint(face, origin.clone().addScaledVector(pair.axis, sign * width / 2)).map(round)) as [Interval, Interval]
  const hingeA = line(pair.a), hingeB = line(pair.b)
  const distance = target.clone().sub(pair.origin).dot(pair.rayA)
  const contacts = (face: PaperFace, ray: Vector3, reach: number, half: number, along = 0): Interval[] => [-1, 1].map(sign =>
    materialPoint(face, origin.clone().addScaledVector(ray, reach).addScaledVector(pair.axis, along + sign * half)))
  const direction = (face: PaperFace, ray: Vector3) => face.u.clone().cross(face.v).cross(pair.axis).dot(ray) < 0 ? 'negative' as const : 'positive' as const
  return { type: 'pair', a: source.a, b: source.b, hingeA, hingeB,
    directionA: direction(pair.a, pair.rayA), directionB: direction(pair.b, pair.rayB), foldSign: pair.foldSign,
    extensions: { a: extensionFor(pair.a, contacts(pair.a, pair.rayA, distance, width / 2), { hinge: hingeA }),
      b: extensionFor(pair.b, contacts(pair.b, pair.rayB, height, supportWidth / 2, offset), { hinge: hingeB }) } }
}

/** 寸法と接続先を配置時に決める。再生器は保存された一組の紙を折るだけ。 */
export function planSupportedPart(project: BookProject, spread: Spread, element: PartElement, placement: SupportPlacement): PartElement {
  if (!('builtin' in element.part.definition) || !['upright', 'root-upright', 'side-upright'].includes(element.part.definition.builtin)) throw new Error('Automatic support requires an upright part')
  const existing = spread.elements.some(e => e.id === element.id)
  const excluded = existing ? dependentPartIds(spread.elements.filter((e): e is PartElement => e.type === 'part').map(e => ({ id: e.id, name: e.name, ...e.part })), element.id) : new Set([element.id])
  const { pageWidth: w, pageAspect } = project.book.format, depth = w / pageAspect
  const parameters = parameterValues(builtinPart(element.part.definition.builtin, 1).parameters, element.part.parameters)
  const unit = element.part.uniformScale ?? 1, width = parameters.width * unit, height = parameters.height * unit
  const target = new Vector3(...placement.position), failures = new Set<string>()
  const replace = (candidate: PartElement): Spread => ({ ...spread, elements: existing ? spread.elements.map(e => e.id === element.id ? candidate : e) : [...spread.elements, candidate] })
  const choices: { candidate: PartElement; score: number }[] = []
  let rearCandidate = false
  for (const source of sources(project, spread, excluded, placement.surfaces, target)) {
    const { pair } = source
    if (placement.surfaces && !(same(source.a, placement.surfaces[0]) && same(source.b, placement.surfaces[1]))) continue
    const distance = target.clone().sub(pair.origin).dot(pair.rayA)
    if (distance < .065 || Math.abs(target.clone().sub(pair.origin).dot(pair.rayA.clone().cross(pair.axis))) > 1e-5) continue
    rearCandidate = true
    const origin = pair.origin.clone().addScaledVector(pair.axis, target.clone().sub(pair.origin).dot(pair.axis))
    const foot = origin.clone().addScaledVector(pair.rayA, distance)
    const panel = makeFace(element.id + '/panel', foot.clone().addScaledVector(pair.axis, -width / 2), pair.axis, pair.rayB, width, height)
    panel.shape = element.part.shapes?.panel
    // 上端の余白までを接着可能範囲とする。距離が長いという理由で取り付けを低くしない。
    const ceiling = Math.min(height - .03, pair.b.height - .03), baseline = Math.min(height * .5, ceiling)
    const attachedMotion = spread.elements.some(e => e.attachment?.type === 'surface' && e.attachment.surface.nodeId === element.id && e.motion.length > 0)
    let motionCeiling: number | undefined
    try { motionCeiling = attachedMotion ? attachedMotionCeiling(spread, element, distance / unit) : undefined }
    catch (error) { failures.add(error instanceof Error ? error.message : String(error)); continue }
    const heights = supportHeights(height, pair.b.height, attachedMotion).filter(h => motionCeiling === undefined || h <= motionCeiling * unit + 1e-8)
    for (const h of heights) {
      const parentCenter = origin.clone().addScaledVector(pair.rayB, h), childCenter = foot.clone().addScaledVector(pair.rayB, h)
      const parents = attachmentIntervals(pair.b, parentCenter, pair.axis, pair.rayB)
      const children = attachmentIntervals(panel, childCenter, pair.axis, pair.rayB)
      for (const supportWidth of [...new Set([Math.max(.05, Math.min(.12, width * .18)), .05])]) {
        const offsets: { offset: number; extension: number }[] = []
        for (const a of parents) for (const b of children) {
          const lo = Math.max(a[0], b[0]) + supportWidth / 2 + 1e-5, hi = Math.min(a[1], b[1]) - supportWidth / 2 - 1e-5
          if (lo <= hi) for (const offset of [Math.max(lo, Math.min(hi, 0)), (lo + hi) / 2, lo, hi]) offsets.push({ offset: round(offset), extension: 0 })
        }
        // 幅外にだけ延長する。穴や切り抜きの上に架空の接着先を作らない。
        if (!offsets.length) for (const b of children) {
          const lo = b[0] + supportWidth / 2 + 1e-5, hi = b[1] - supportWidth / 2 - 1e-5
          if (lo > hi) continue
          const offset = Math.max(lo, Math.min(hi, 0)), point = parentCenter.clone().addScaledVector(pair.axis, offset)
          const uv = materialPoint(pair.b, point)
          if (uv[0] < 0 || uv[0] > pair.b.width) offsets.push({ offset, extension: Math.max(-uv[0], uv[0] - pair.b.width) })
        }
        for (const { offset, extension } of offsets) {
          const instance: PartInstance = { ...structuredClone(element.part), supportDesign: 'automatic', definition: { builtin: 'upright', version: 1 },
            parameters: { width: width / unit, height: height / unit, distance: distance / unit, offset: 0, supportHeight: h / unit, supportWidth: supportWidth / unit, supportOffset: offset / unit },
            mount: mountAt(source, target, width, h, supportWidth, offset) }
          const candidate = { ...element, part: instance }
          choices.push({ candidate, score: (extension > 0 ? 10000 : 0) + Math.abs(h - baseline) * 20 + distance + Math.abs(offset) * .25 + extension * 4 })
        }
      }
    }
  }
  if (!placement.surfaces) {
    const paper = evaluateBookParts(project, spread, Math.PI, 0)
    // 同じ奥行きにある側方の紙は、水平の連結紙で親と一緒に寝かせる。
    for (const [nodeId, evaluated] of Object.entries(paper.nodes)) {
      if (excluded.has(nodeId)) continue
      for (const [portId, port] of Object.entries(evaluated.ports)) {
        if (port.kind !== 'surface' || port.face.support || port.face.v.y < .99) continue
        const face = port.face, uv = materialPoint(face, target), normal = face.u.clone().cross(face.v)
        if (Math.abs(target.clone().sub(face.origin).dot(normal)) > 1e-5) continue
        const u = uv[0] - width / 2, gap = u > face.width ? u - face.width : u + width < 0 ? -u - width : -1
        if (gap < .001) continue
        const candidate = { ...element, part: { ...element.part, definition: { builtin: 'side-upright', version: 1 }, supportDesign: 'automatic' as const,
          mount: { type: 'output' as const, nodeId, portId }, parameters: { width: width / unit, height: height / unit, u: u / unit, v: uv[1] / unit } } }
        choices.push({ candidate, score: 9000 + gap })
      }
    }
  }
  const seen = new Set<string>()
  choices.sort((a, b) => a.score - b.score)
  for (const { candidate } of choices) {
    const key = JSON.stringify(candidate.part); if (seen.has(key)) continue; seen.add(key)
    try {
      const next = replace(candidate), inspect = createPaperMotionInspector()
      // 全開時の衝突で候補を絞ってから、両側の開閉と演出の包絡を検査する。
      for (const angle of [180, 120, 60, 15, 0]) for (const side of angle === 180 ? ['left'] as const : ['left', 'right'] as const) {
        const left = side === 'left' ? angle * Math.PI / 180 : Math.PI, right = side === 'right' ? (180 - angle) * Math.PI / 180 : 0
        const result = evaluateBookParts(project, next, left, right), input = pagePorts(w, depth, left, right).gutter
        const errors = [...inspect(result, [input]), ...inspectIntersections(result).filter(s => s.includes(element.id + '/'))]
        if (angle === 0 && input.kind === 'fold-pair') errors.push(...inspectClosedLayout(deployBookParts(project, next, result, left, right).nodes[element.id], w, depth, input.rayA))
        if (!errors.length) errors.push(...inspectContentMotion(bindBookContents(project, next, result, left, right), result.nodes[element.id].faces,
          { openingAngleDeg: angle, maxOpeningAngleDeg: 180 }, spread.sequence.holdSeconds, bookContentHoldTime(angle, side, spread.sequence.holdSeconds)))
        if (errors.length) throw new Error(errors[0])
      }
      return candidate
    } catch (error) { failures.add(error instanceof Error ? error.message : String(error)) }
  }
  // 背後や側方に候補があるのに接続が不成立の場合は、勝手に支持を切らない。
  if (!placement.surfaces && !choices.length && !rearCandidate) {
    const candidate: PartElement = { ...element, part: { ...element.part, definition: { builtin: 'root-upright', version: 1 },
      supportDesign: 'automatic', mount: { type: 'output', nodeId: '$book', portId: 'gutter' },
      parameters: { width: width / unit, height: height / unit, centerX: target.x / unit, offset: target.z / unit } } }
    const next = replace(candidate), errors = validateBookParts({ ...project, book: { ...project.book, spreads: [next] } })
    if (!errors.length) return candidate
    errors.forEach(error => failures.add(error))
  }
  throw new Error(`${element.name}: No valid automatic support at ${placement.position.join(', ')}\n${[...failures].slice(0, 6).join('\n')}`)
}

/** 画像や演出も含む完成した配置から再設計する。作品IDや手動の接着位置は参照しない。 */
export function replanAutomaticSupports(project: BookProject, spread: Spread, options: {
  preserveConnections?: boolean; floatingIds?: ReadonlySet<string>
} = {}, pass = 0): void {
  const failed: string[] = []
  for (const element of [...spread.elements]) {
    if (element.type !== 'part' || element.part.supportDesign !== 'automatic') continue
    const paper = evaluateBookParts(project, spread, Math.PI, 0), port = paper.nodes[element.id].ports.panel
    if (port?.kind !== 'surface') continue
    const target = pointOnFace(port.face, port.face.width / 2, 0).toArray() as [number, number, number]
    try {
      const mount = element.part.mount
      const candidate = planSupportedPart(project, spread, element, { position: target,
        surfaces: options.preserveConnections && mount.type === 'pair' ? [mount.a, mount.b] : undefined })
      spread.elements[spread.elements.findIndex(e => e.id === element.id)] = candidate
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('Content crosses paper')) throw error
      failed.push(error.message)
    }
  }
  if (failed.length) {
    if (pass >= 3) throw new Error(failed[0])
    const moved = clearFictionSupportCrossings(project, spread, options.floatingIds)
    if (!moved.length) throw new Error(failed[0])
    replanAutomaticSupports(project, spread, options, pass + 1)
  }
}
