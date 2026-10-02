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
import { bindingDependencies, parameterValues, evaluateExpression } from './schema'
import { newPartDefinition } from './schema'
import { connectedContentSchema } from '../schema/content'
import { extensionFor, materialPoint } from './mountGeometry'
import { keyedMemo } from './shape'

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

const motionCeilings = keyedMemo<{ value: number } | { error: unknown }>(128)
/** cachedOnly は操作中の表示用で、記憶済みの上限だけを返し、未計算なら undefined にする */
function attachedMotionCeiling(spread: Spread, element: PartElement, distance: number, cachedOnly = false): number | undefined {
  const attached = spread.elements.filter(e => e.attachment?.type === 'surface' && e.attachment.surface.nodeId === element.id && e.motion.length > 0)
  if (!attached.length) return undefined
  // 高さごとに試作定義を全角度で検証するので重い。ギズモ操作中は取り付け位置だけが変わり、設計と演出は同じなので結果を使い回す。
  const tracks = spread.timeline.tracks.filter(t => t.target.type === 'element' && attached.some(e => t.target.type === 'element' && t.target.elementId === e.id))
  const { mount: _mount, ...design } = element.part
  const key = JSON.stringify([element.id, element.name, design, distance, attached, tracks])
  const memo = cachedOnly ? motionCeilings.peek(key) : motionCeilings(key, () => {
    try { return { value: designMotionCeiling(spread, element, distance, attached) } } catch (error) { return { error } }
  })
  if (!memo) return undefined
  if ('error' in memo) throw memo.error
  return memo.value
}
function designMotionCeiling(spread: Spread, element: PartElement, distance: number, attached: Spread['elements']): number {
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
  /** 交差を検査しない演出。動かした紙に当たる浮遊演出は、配置後に押しのけて解く */
  ignoreContents?: ReadonlySet<string>
  /** ギズモ操作中の表示用。開閉の検査を省いて最上位の候補を返す。確定時は必ず検査する */
  unchecked?: boolean
}
const same = (a: PartSurfaceRef, b: PartSurfaceRef) => a.nodeId === b.nodeId && a.portId === b.portId
/** 指定の部品と、その面に貼った内容 (とそれに従う内容) を除いた見開き */
export function withoutParts(spread: Spread, ids: Set<string>): Spread {
  const dropped = new Set([...ids].filter(id => spread.elements.some(e => e.id === id && e.type === 'part')))
  for (let grown = true; grown;) {
    grown = false
    for (const e of spread.elements) {
      if (dropped.has(e.id)) continue
      const follows = e.attachment?.type === 'surface' ? dropped.has(e.attachment.surface.nodeId) : e.attachment?.type === 'visual' ? dropped.has(e.attachment.elementId) : false
      if (follows) { dropped.add(e.id); grown = true }
    }
  }
  return { ...spread, elements: spread.elements.filter(e => !dropped.has(e.id)) }
}

function sources(project: BookProject, spread: Spread, excluded: Set<string>, selected?: [PartSurfaceRef, PartSurfaceRef], target?: Vector3): SupportSource[] {
  // 設計し直す部品とその配下は候補にならない。動かした直後で評価できない取り付けのこともあるので、評価からも外す。
  const paper = evaluateBookParts(project, withoutParts(spread, excluded), Math.PI, 0)
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
const isolated = (element: PartElement): PartElement => ({ ...element, part: structuredClone(element.part) })
export function planSupportedPart(project: BookProject, spread: Spread, element: PartElement, placement: SupportPlacement): PartElement {
  if (!('builtin' in element.part.definition) || !['upright', 'root-upright', 'side-upright'].includes(element.part.definition.builtin)) throw new Error('Automatic support requires an upright part')
  const existing = spread.elements.some(e => e.id === element.id)
  const excluded = existing ? dependentPartIds(spread.elements.filter((e): e is PartElement => e.type === 'part').map(e => ({ id: e.id, name: e.name, ...e.part })), element.id) : new Set([element.id])
  const { pageWidth: w, pageAspect } = project.book.format, depth = w / pageAspect
  const parameters = parameterValues(builtinPart(element.part.definition.builtin, 1).parameters, element.part.parameters)
  const unit = element.part.uniformScale ?? 1, width = parameters.width * unit, height = parameters.height * unit
  const target = new Vector3(...placement.position), failures = new Set<string>()
  // 配下の部品は親の新しい位置に合わせて後から取り付け直すので、候補の検査には含めない。
  const dependents = new Set([...excluded].filter(id => id !== element.id))
  const replace = (candidate: PartElement): Spread => existing
    ? { ...spread, elements: withoutParts(spread, dependents).elements.map(e => e.id === element.id ? candidate : e) }
    : { ...spread, elements: [...spread.elements, candidate] }
  type Choice = { candidate: PartElement; score: number; height?: number; distance?: number }
  // 幅外へ延長する支持は、二面を明示した配置では通常の候補に混ぜ、自動探索では最奥の起立部品も成立しないときの最後の候補にする
  const choices: Choice[] = [], farChoices: Choice[] = []
  for (const source of sources(project, spread, excluded, placement.surfaces, target)) {
    const { pair } = source
    if (placement.surfaces && !(same(source.a, placement.surfaces[0]) && same(source.b, placement.surfaces[1]))) continue
    const distance = target.clone().sub(pair.origin).dot(pair.rayA)
    if (distance < .065 || Math.abs(target.clone().sub(pair.origin).dot(pair.rayA.clone().cross(pair.axis))) > 1e-5) continue
    const origin = pair.origin.clone().addScaledVector(pair.axis, target.clone().sub(pair.origin).dot(pair.axis))
    const foot = origin.clone().addScaledVector(pair.rayA, distance)
    const panel = makeFace(element.id + '/panel', foot.clone().addScaledVector(pair.axis, -width / 2), pair.axis, pair.rayB, width, height)
    panel.shape = element.part.shapes?.panel
    // 上端の余白までを接着可能範囲とする。距離が長いという理由で取り付けを低くしない。
    const ceiling = Math.min(height - .03, pair.b.height - .03), baseline = Math.min(height * .5, ceiling)
    const attachedMotion = spread.elements.some(e => e.attachment?.type === 'surface' && e.attachment.surface.nodeId === element.id && e.motion.length > 0)
    // 演出が届く高さの上限は重いので、候補を検査する直前に、その距離の分だけ求める
    for (const h of supportHeights(height, pair.b.height, attachedMotion)) {
      const parentCenter = origin.clone().addScaledVector(pair.rayB, h), childCenter = foot.clone().addScaledVector(pair.rayB, h)
      const parents = attachmentIntervals(pair.b, parentCenter, pair.axis, pair.rayB)
      const children = attachmentIntervals(panel, childCenter, pair.axis, pair.rayB)
      for (const supportWidth of [...new Set([Math.max(.05, Math.min(.12, width * .18)), .05])]) {
        const offsets: { offset: number; extension: number }[] = []
        for (const a of parents) for (const b of children) {
          const lo = Math.max(a[0], b[0]) + supportWidth / 2 + 1e-5, hi = Math.min(a[1], b[1]) - supportWidth / 2 - 1e-5
          if (lo <= hi) {
            for (const offset of [Math.max(lo, Math.min(hi, 0)), (lo + hi) / 2, lo, hi]) offsets.push({ offset: round(offset), extension: 0 })
          }
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
          // 候補は検査で読むだけなので元の設計を共有し、採用した一件だけを複製して返す
          const instance: PartInstance = { ...element.part, supportDesign: 'automatic', definition: { builtin: 'upright', version: 1 },
            parameters: { width: width / unit, height: height / unit, distance: distance / unit, offset: 0, supportHeight: h / unit, supportWidth: supportWidth / unit, supportOffset: offset / unit },
            mount: mountAt(source, target, width, h, supportWidth, offset) }
          const candidate = { ...element, part: instance }
          ;(extension > 0 && !placement.surfaces ? farChoices : choices).push({ candidate, score: (extension > 0 ? 10000 : 0) + Math.abs(h - baseline) * 20 + distance + Math.abs(offset) * .25 + extension * 4,
            ...attachedMotion ? { height: h, distance } : {} })
        }
      }
    }
  }
  if (!placement.surfaces) {
    const paper = evaluateBookParts(project, withoutParts(spread, excluded), Math.PI, 0)
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
  const seen = new Set<string>(), ceilings = new Map<number, number | null | undefined>()
  // 上限を求められない距離の候補は捨てる。表示用の幾何モードでは記憶済みの上限だけを使い、未計算なら確定時の検査に任せる
  const underCeiling = (height: number, distance: number) => {
    if (!ceilings.has(distance)) {
      try { ceilings.set(distance, attachedMotionCeiling(spread, element, distance / unit, placement.unchecked)) }
      catch (error) { failures.add(error instanceof Error ? error.message : String(error)); ceilings.set(distance, null) }
    }
    const ceiling = ceilings.get(distance)
    return ceiling === undefined ? !!placement.unchecked : ceiling !== null && height <= ceiling * unit + 1e-8
  }
  const firstValid = (list: Choice[]): PartElement | undefined => {
    list.sort((a, b) => a.score - b.score)
    for (const { candidate, height, distance } of list) {
      if (height !== undefined && distance !== undefined && !underCeiling(height, distance)) continue
      const key = JSON.stringify(candidate.part); if (seen.has(key)) continue; seen.add(key)
      if (placement.unchecked) return isolated(candidate)
      try {
        const next = replace(candidate), inspect = createPaperMotionInspector()
        // 全開時の衝突で候補を絞ってから、両側の開閉と演出の包絡を検査する。
        for (const angle of [180, 120, 60, 15, 0]) for (const side of angle === 180 ? ['left'] as const : ['left', 'right'] as const) {
          const left = side === 'left' ? angle * Math.PI / 180 : Math.PI, right = side === 'right' ? (180 - angle) * Math.PI / 180 : 0
          const result = evaluateBookParts(project, next, left, right), input = pagePorts(w, depth, left, right).gutter
          const errors = [...inspect(result, [input]), ...inspectIntersections(result).filter(s => s.includes(element.id + '/'))]
          if (angle === 0 && input.kind === 'fold-pair') errors.push(...inspectClosedLayout(deployBookParts(project, next, result, left, right).nodes[element.id], w, depth, input.rayA))
          if (!errors.length) errors.push(...inspectContentMotion(bindBookContents(project, next, result, left, right).filter(b => !placement.ignoreContents?.has(b.id)), result.nodes[element.id].faces,
            { openingAngleDeg: angle, maxOpeningAngleDeg: 180 }, spread.sequence.holdSeconds, bookContentHoldTime(angle, side, spread.sequence.holdSeconds)))
          if (errors.length) throw new Error(errors[0])
        }
        return isolated(candidate)
      } catch (error) { failures.add(error instanceof Error ? error.message : String(error)) }
    }
  }
  const planned = firstValid(choices)
  if (planned) return planned
  // 背後や側方に候補があるのに接続が不成立の場合は、勝手に支持を切らない。
  if (!placement.surfaces && !choices.some(c => c.height === undefined || c.distance === undefined || underCeiling(c.height, c.distance))) {
    const candidate: PartElement = { ...element, part: { ...element.part, definition: { builtin: 'root-upright', version: 1 },
      supportDesign: 'automatic', mount: { type: 'output', nodeId: '$book', portId: 'gutter' },
      parameters: { width: width / unit, height: height / unit, centerX: target.x / unit, offset: target.z / unit } } }
    if (placement.unchecked) return candidate
    const next = replace(candidate), errors = validateBookParts({ ...project, book: { ...project.book, spreads: [next] } })
    if (!errors.length) return candidate
    errors.forEach(error => failures.add(error))
  }
  const extended = firstValid(farChoices)
  if (extended) return extended
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

/**
 * 二面へ掛けた起立部品の足元 (板の下辺の中央)。部品自身は評価せず、接続先の二面と保存した折り線から求める。
 * 動かした直後の取り付けは接続先からはみ出して評価できないことがあるので、再設計の目標位置はこれで取る。
 */
export function supportedPartFoot(project: BookProject, spread: Spread, element: PartElement): [number, number, number] {
  const mount = element.part.mount
  if (mount.type !== 'pair') throw new Error('Expected a two-surface mount')
  const nodes = spread.elements.filter((e): e is PartElement => e.type === 'part').map(e => ({ id: e.id, name: e.name, ...e.part }))
  const skipped = dependentPartIds(nodes, element.id)
  const paper = evaluateBookParts(project, { ...spread, elements: spread.elements.filter(e => !skipped.has(e.id)) }, Math.PI, 0)
  const { pageWidth: w, pageAspect } = project.book.format, pages = pagePorts(w, w / pageAspect, Math.PI, 0)
  const face = (ref: PartSurfaceRef) => {
    const port = ref.nodeId === '$book' ? pages[ref.portId] : paper.nodes[ref.nodeId] && evaluatedOutput(paper.nodes[ref.nodeId], ref.portId, ref.nodeId)
    if (port?.kind !== 'surface') throw new Error('Support surface is missing')
    return port.face
  }
  const a = face(mount.a), pa = mount.hingeA.map(([u, v]) => pointOnFace(a, u, v))
  const origin = pa[0].clone().add(pa[1]).multiplyScalar(.5), axis = pa[1].clone().sub(pa[0]).normalize()
  const rayA = a.u.clone().cross(a.v).cross(axis).normalize().multiplyScalar(mount.directionA === 'positive' ? 1 : -1)
  const parameters = parameterValues(builtinPart('upright', 1).parameters, element.part.parameters)
  return origin.addScaledVector(rayA, parameters.distance * (element.part.uniformScale ?? 1)).toArray() as [number, number, number]
}

/** 配下を除いた見開きで、その部品の取り付けが評価できるか (はみ出した支持紙などで壊れていないか) */
export function supportEvaluates(project: BookProject, spread: Spread, element: PartElement): boolean {
  const nodes = spread.elements.filter((e): e is PartElement => e.type === 'part').map(e => ({ id: e.id, name: e.name, ...e.part }))
  const dependents = new Set([...dependentPartIds(nodes, element.id)].filter(id => id !== element.id))
  try { evaluateBookParts(project, withoutParts(spread, dependents), Math.PI, 0); return true } catch { return false }
}

/**
 * 動かした起立部品の支持を作り直す。今の接続先で成り立つならそれを保ち (継ぎ足しで届く場合も含む)、
 * 成り立たないときだけ移動先の奥にある紙へ乗り換える。どこにも乗れなければ元の失敗を返す。
 */
export function replanMovedSupport(project: BookProject, spread: Spread, element: PartElement, position: [number, number, number], ignoreContents?: ReadonlySet<string>, unchecked = false): PartElement {
  const mount = element.part.mount
  let keptFailure: unknown
  if (mount.type === 'pair') {
    try { return planSupportedPart(project, spread, element, { position, surfaces: [mount.a, mount.b], ignoreContents, unchecked }) }
    catch (error) { keptFailure = error }
  }
  try { return planSupportedPart(project, spread, element, { position, ignoreContents, unchecked }) }
  catch (error) { throw keptFailure ?? error }
}

/** 接続先を失ったときに別の紙へ繋ぎ直せる部品か。支持を自動設計できる起立だけ */
export function canRehomePart(element: { type: string; part?: { definition: PartInstance['definition'] } }): boolean {
  return element.type === 'part' && element.part !== undefined && 'builtin' in element.part.definition && ['upright', 'side-upright'].includes(element.part.definition.builtin)
}

/**
 * 部品を外すとき、その部品に乗っていた子部品を繋ぎ直す。
 * 直接の子は外す部品の接続先 (その親) へ掛け替え、無理なら位置の奥にある紙を探し、
 * それも無ければ紙面へ直接立てる孤立した起立にする。孫以下は同じ位置のまま、繋ぎ直した親へ取り付け直す。
 */
export function rehomeDependentParts(project: BookProject, spread: Spread, removedId: string): Spread {
  const removed = spread.elements.find(e => e.id === removedId)
  if (removed?.type !== 'part') return spread
  const removedMount = removed.part.mount
  const parentSurfaces = removedMount.type === 'pair' && removedMount.b.nodeId !== '$book' ? [removedMount.a, removedMount.b] as [PartSurfaceRef, PartSurfaceRef] : undefined
  const nodes = spread.elements.filter((e): e is PartElement => e.type === 'part').map(e => ({ id: e.id, name: e.name, ...e.part }))
  const paper = evaluateBookParts(project, spread, Math.PI, 0)
  // 繋ぎ直せるのは外す部品に直接乗る起立とその配下の起立。折り機構などの他の部品は乗り先を失うので残さない
  const feet = new Map<string, [number, number, number]>()
  for (const id of [...dependentPartIds(nodes, removedId)].filter(id => id !== removedId)) {
    const element = spread.elements.find(e => e.id === id)
    if (!element || !canRehomePart(element)) continue
    const deps = bindingDependencies(nodes.find(n => n.id === id)!.mount).filter(dep => dep !== '$book')
    if (!deps.every(dep => dep === removedId || feet.has(dep))) continue
    const panel = paper.nodes[id]?.ports.panel
    if (panel?.kind === 'surface') feet.set(id, pointOnFace(panel.face, panel.face.width / 2, 0).toArray() as [number, number, number])
  }
  const orphanOf = (element: PartElement, position: [number, number, number]): PartElement => {
    const unit = element.part.uniformScale ?? 1
    const parameters = parameterValues(builtinPart('upright', 1).parameters, element.part.parameters)
    return { ...element, part: { ...element.part, definition: { builtin: 'root-upright', version: 1 }, supportDesign: 'automatic',
      mount: { type: 'output', nodeId: '$book', portId: 'gutter' },
      parameters: { width: parameters.width, height: parameters.height, centerX: position[0] / unit, offset: position[2] / unit } } }
  }
  // 繋ぎ直す前の子部品は外した部品を参照したままで評価できないので、いったん見開きから外し、繋ぎ直した順に戻す
  const dropped = new Set([...dependentPartIds(nodes, removedId)].filter(id => !feet.has(id)))
  let next: Spread = withoutParts(spread, new Set([...dropped, ...feet.keys()]))
  const contents = spread.elements.filter(e => !next.elements.includes(e) && !dropped.has(e.id) && !feet.has(e.id))
  const restore = (planned: PartElement) => {
    const elements = [...next.elements, planned]
    // その部品の面に貼っていた内容も戻す
    for (const e of contents) if (e.attachment?.type === 'surface' && e.attachment.surface.nodeId === planned.id && !elements.includes(e)) elements.push(e)
    next = { ...next, elements }
  }
  // 親から順に繋ぎ直す
  const done = new Set<string>(), order: string[] = []
  while (order.length < feet.size) {
    const ready = [...feet.keys()].find(id => !done.has(id) && bindingDependencies(nodes.find(n => n.id === id)!.mount).every(dep => dep === '$book' || dep === removedId || !feet.has(dep) || done.has(dep)))
    if (!ready) break
    done.add(ready); order.push(ready)
  }
  for (const id of order) {
    const original = nodes.find(n => n.id === id)!, position = feet.get(id)!
    const element = spread.elements.find(e => e.id === id)
    if (element?.type !== 'part') continue
    const direct = bindingDependencies(original.mount).includes(removedId)
    const preferred = direct ? parentSurfaces : original.mount.type === 'pair' ? [original.mount.a, original.mount.b] as [PartSurfaceRef, PartSurfaceRef] : undefined
    const staged = { ...next, elements: [...next.elements, element] }
    let planned: PartElement | undefined
    for (const surfaces of preferred ? [preferred, undefined] : [undefined]) {
      try { planned = planSupportedPart(project, staged, element, { position, surfaces }); break }
      catch { /* 次の候補へ */ }
    }
    if (!planned) {
      // どこにも乗れない子は紙面へ孤立して立てる。輪郭が最奥のカードに合わなければ輪郭を外す
      planned = orphanOf(element, position)
      try { evaluateBookParts(project, { ...next, elements: [...next.elements, planned] }, Math.PI, 0) }
      catch { planned = { ...planned, part: { ...planned.part, shapes: undefined } } }
    }
    restore(planned)
  }
  // 戻せなかった内容 (乗り先のない貼り付け) はここで落ちる
  return next
}

