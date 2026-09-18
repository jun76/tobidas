import { Vector3 } from 'three'
import type { PaperEvaluation, PaperFace } from './geometry'
import { faceContains, faceShape, pointOnFace } from './geometry'
import type { PartSurfaceRef } from './schema'
import type { BookProject } from '../schema/bookPackage'
import type { Spread } from '../schema/book'
import { bookContentHoldTime, evaluateBookParts } from './book'
import { bindBookContents, evaluateContents } from './contents'
import { contentSampleTimes, inspectContentIntersections, inspectContentMotion } from './contentValidation'
import { contentTriangles } from './contentDisplay'
import { contentMotionEnvelopes } from './contentEnvelope'

/** 演出の到着先は近くの実紙を基準にする。支持紙は生成しない。 */
export function nearestContentSurface(paper: PaperEvaluation & { nodes: Record<string, PaperEvaluation> }, position: [number, number, number], heightWeight = 1) {
  const target = new Vector3(...position)
  const candidates: { face: PaperFace; reference: PartSurfaceRef; point: [number, number]; score: number }[] = []
  for (const [nodeId, node] of Object.entries(paper.nodes)) for (const [portId, port] of Object.entries(node.ports)) {
    if (port.kind !== 'surface' || port.face.support || port.face.v.y < .9 || port.face.u.clone().cross(port.face.v).z < .8) continue
    const face = port.face, delta = target.clone().sub(face.origin)
    const margin = Math.min(.006, face.width / 10, face.height / 10)
    const wanted: [number, number] = [Math.max(.001, Math.min(face.width - .001, delta.dot(face.u))), Math.max(.001, Math.min(face.height - .001, delta.dot(face.v)))]
    const points: [number, number][] = [wanted]
    for (const ring of [faceShape(face).outer, ...faceShape(face).holes]) for (const [u, v] of ring) {
      for (const x of [-margin, 0, margin]) for (const y of [-margin, 0, margin]) points.push([u * face.width + x, v * face.height + y])
    }
    for (let i = 0; i < 100; i++) points.push([face.width * (i + .5) / 100, wanted[1]])
    // 切り抜きの縁ぎりぎりを避け、配置後の微調整にも接着面を残す。
    for (const point of points) if ([[0, 0], [-margin, 0], [margin, 0], [0, -margin], [0, margin]]
      .every(([u, v]) => faceContains(face, pointOnFace(face, point[0] + u, point[1] + v)))) {
      const gap = pointOnFace(face, ...point).sub(target); gap.y *= heightWeight
      candidates.push({ face, reference: { nodeId, portId }, point, score: gap.length() })
    }
  }
  candidates.sort((a, b) => a.score - b.score)
  return candidates[0]
}

/** 浮遊している演出を支持紙の上へ逃がす。接地した出現は持ち上げず、移動キーの経路も保つ。 */
export function clearFictionSupportCrossings(project: BookProject, spread: Spread, allowed?: ReadonlySet<string>): string[] {
  const changed = new Set<string>()
  for (let pass = 0; pass < 4; pass++) {
    const paper = evaluateBookParts(project, spread, Math.PI, 0), supports = paper.faces.filter(face => face.support)
    const bindings = bindBookContents(project, spread, paper, Math.PI, 0)
    const shifts = new Map<string, { amount: number; direction: Vector3 }>()
    for (const time of contentSampleTimes(bindings, spread.sequence.holdSeconds).filter(t => t <= spread.sequence.holdSeconds)) {
      const contents = evaluateContents(bindings, { openingAngleDeg: 180, maxOpeningAngleDeg: 180, holdTime: time, clock: () => time })
      const envelopes = new Map(contentMotionEnvelopes(contents).map(envelope => [envelope.id, envelope]))
      for (const content of contents) {
        if (allowed && !allowed.has(content.id)) continue
        if (!content.visible || content.parentId || content.element.presentation.kind !== 'fiction' || content.element.type !== 'visual') continue
        const element = spread.elements.find(e => e.id === content.id)
        // 実部品内の回転する羽根などは、取り付けをずらして解決しない。
        if (!element || element.attachment?.type !== 'surface' || !element.motion.length && !spread.timeline.tracks.some(t => t.target.type === 'element' && t.target.elementId === element.id && /^(position|scale|opacity|visible)/.test(t.property))) continue
        // 地面を足元にした出現を浮遊物へ変えない。成立しない接地配置は支持側の再設計か配置変更で解決する。
        const foot = new Vector3(...element.baseTransform.position).applyMatrix4(content.anchor)
        if (element.pivot[1] === 0 && foot.y <= .05) continue
        const hit = supports.filter(face => inspectContentIntersections([content], [face], true).length)
        if (!hit.length) continue
        const points = (envelopes.get(content.id)?.triangles ?? contentTriangles(content)).flatMap(triangle => triangle.map(vertex => vertex.point))
        const bottom = Math.min(...points.map(p => p.y)), top = Math.max(...hit.flatMap(face => faceShape(face).outer.map(([u, v]) => pointOnFace(face, u * face.width, v * face.height).y)))
        const amount = top + .025 - bottom
        if (amount <= 0 || (shifts.get(content.id)?.amount ?? 0) >= amount) continue
        shifts.set(content.id, { amount, direction: new Vector3(0, 1, 0).transformDirection(content.anchor.clone().invert()) })
      }
    }
    if (!shifts.size) return [...changed]
    for (const [id, { amount, direction }] of shifts) {
      const element = spread.elements.find(e => e.id === id)!
      const delta = direction.multiplyScalar(amount)
      element.baseTransform.position = new Vector3(...element.baseTransform.position).add(delta).toArray()
      for (const track of spread.timeline.tracks) if (track.target.type === 'element' && track.target.elementId === id && /^position\.[xyz]$/.test(track.property)) {
        const shift = delta.getComponent('xyz'.indexOf(track.property.at(-1)!))
        for (const key of track.keys) if (typeof key.value === 'number') key.value += shift
      }
      changed.add(id)
    }
  }
  return [...changed]
}

/** 紙面を離れて浮遊し、揺れや移動で動く演出。部品を動かしたとき紙と交わるなら、押しのけて解決してよい相手 */
export function floatingFictionIds(spread: Spread): Set<string> {
  const ids = new Set<string>()
  for (const element of spread.elements) {
    if (element.type !== 'visual' || element.attachment?.type !== 'surface' || element.presentation?.kind !== 'fiction' || !element.visible) continue
    const animated = element.motion.length > 0 || spread.timeline.tracks.some(t => t.target.type === 'element' && t.target.elementId === element.id && /^(position|scale|opacity|visible)/.test(t.property))
    if (!animated || (element.pivot[1] === 0 && element.baseTransform.position[1] <= .05)) continue
    ids.add(element.id)
  }
  return ids
}

type Opening = { side: 'left' | 'right'; angle: number }
const OPENINGS: Opening[] = (['left', 'right'] as const).flatMap(side => [180, 150, 120, 90, 60, 30, 15, 0].filter(angle => !(side === 'right' && angle === 180)).map(angle => ({ side, angle })))
const openingAngles = ({ side, angle }: Opening) => ({ left: side === 'left' ? angle * Math.PI / 180 : Math.PI, right: side === 'right' ? (180 - angle) * Math.PI / 180 : 0 })

/** 紙の評価は演出を動かしても変わらないので、姿勢ごとに一度だけ行う */
type PoseCache = Map<string, ReturnType<typeof evaluateBookParts>>
function paperAt(cache: PoseCache, project: BookProject, spread: Spread, opening: Opening) {
  const key = opening.side + opening.angle, { left, right } = openingAngles(opening)
  let paper = cache.get(key)
  if (!paper) { paper = evaluateBookParts(project, spread, left, right); cache.set(key, paper) }
  return paper
}

/** 開閉の途中も含めて、演出が指定の部品の紙と交わる最初の姿勢 */
function firstCrossing(cache: PoseCache, project: BookProject, spread: Spread, contentId: string, partIds: ReadonlySet<string>): Opening | undefined {
  const hold = spread.sequence.holdSeconds
  for (const opening of OPENINGS) {
    const { left, right } = openingAngles(opening), result = paperAt(cache, project, spread, opening)
    const faces = Object.entries(result.nodes).filter(([id]) => partIds.has(id)).flatMap(([, node]) => node.faces.filter(face => !face.support))
    const bindings = bindBookContents(project, spread, result, left, right).filter(binding => binding.id === contentId)
    if (inspectContentMotion(bindings, faces, { openingAngleDeg: opening.angle, maxOpeningAngleDeg: 180 }, hold, bookContentHoldTime(opening.angle, opening.side, hold)).length) return opening
  }
  return undefined
}

/** その姿勢で交わっている紙の枠から抜ける移動の候補 (演出の取り付け座標系)。小さい順 */
function escapeCandidates(cache: PoseCache, project: BookProject, spread: Spread, contentId: string, partIds: ReadonlySet<string>, opening: Opening): Vector3[] {
  const { left, right } = openingAngles(opening)
  const paper = paperAt(cache, project, spread, opening)
  const faces = Object.entries(paper.nodes).filter(([id]) => partIds.has(id)).flatMap(([, node]) => node.faces.filter(face => !face.support))
  const bindings = bindBookContents(project, spread, paper, left, right)
  const hold = spread.sequence.holdSeconds, holdTime = bookContentHoldTime(opening.angle, opening.side, hold)
  const times = holdTime === undefined ? contentSampleTimes(bindings, hold).filter(t => t <= hold) : [holdTime]
  const candidates = new Map<string, { amount: number; local: Vector3 }>()
  for (const time of times) {
    const contents = evaluateContents(bindings, { openingAngleDeg: opening.angle, maxOpeningAngleDeg: 180, holdTime: time, clock: () => time })
    const content = contents.find(c => c.id === contentId)
    if (!content || !content.visible) continue
    const envelope = contentMotionEnvelopes([content])[0]
    const points = (envelope?.triangles ?? contentTriangles(content)).flatMap(triangle => triangle.map(vertex => vertex.point))
    const inverse = content.anchor.clone().invert()
    for (const face of faces) {
      if (!inspectContentIntersections([content], [face], true).length) continue
      const normal = face.u.clone().cross(face.v).normalize(), margin = .03
      const along = (axis: Vector3) => points.map(p => p.clone().sub(face.origin).dot(axis))
      const u = along(face.u), v = along(face.v), n = along(normal)
      const options: [number, Vector3][] = [
        [-(Math.max(...u) + margin), face.u], [face.width + margin - Math.min(...u), face.u],
        [-(Math.max(...n) + margin), normal], [margin - Math.min(...n), normal],
        [face.height + margin - Math.min(...v), face.v],
      ]
      for (const [amount, axis] of options) {
        const local = axis.clone().multiplyScalar(amount).transformDirection(inverse).multiplyScalar(Math.abs(amount))
        candidates.set(local.toArray().map(n => n.toFixed(3)).join(','), { amount: Math.abs(amount), local })
      }
    }
  }
  return [...candidates.values()].sort((a, b) => a.amount - b.amount).map(c => c.local)
}

/**
 * 動かした部品の紙を貫くことになった浮遊演出を押しのける。交わる姿勢ごとに、その紙の枠から
 * 横・前後・上へ抜ける最小の移動を試し、開閉の全域で交わらなくなるまで重ねる。抜けなければ動かさない (検証が止める)。
 * 支持紙との交差は clearFictionSupportCrossings が持ち上げで解く。
 */
export function clearFictionPaperCrossings(project: BookProject, spread: Spread, partIds: ReadonlySet<string>, allowed: ReadonlySet<string>): string[] {
  const changed: string[] = [], cache: PoseCache = new Map()
  for (const id of allowed) {
    const element = spread.elements.find(e => e.id === id)
    if (!element || !firstCrossing(cache, project, spread, id, partIds)) continue
    const tracks = spread.timeline.tracks.filter(track => track.target.type === 'element' && track.target.elementId === id && /^position\.[xyz]$/.test(track.property))
    const original = [...element.baseTransform.position] as [number, number, number], originalKeys = tracks.map(track => track.keys.map(key => key.value))
    const place = (shift: Vector3) => {
      element.baseTransform.position = new Vector3(...original).add(shift).toArray()
      tracks.forEach((track, index) => track.keys.forEach((key, k) => { const value = originalKeys[index][k]; if (typeof value === 'number') key.value = value + shift.getComponent('xyz'.indexOf(track.property.at(-1)!)) }))
    }
    let shift = new Vector3(), solved = false
    for (let pass = 0; pass < 4 && !solved; pass++) {
      const crossing = firstCrossing(cache, project, spread, id, partIds)
      if (!crossing) { solved = true; break }
      let advanced = false
      for (const local of escapeCandidates(cache, project, spread, id, partIds, crossing)) {
        place(shift.clone().add(local))
        const next = firstCrossing(cache, project, spread, id, partIds)
        if (!next) { shift.add(local); solved = true; advanced = true; break }
        // その姿勢は抜けたなら、残りの姿勢を次の回で解く
        if (next.side !== crossing.side || next.angle !== crossing.angle) { shift.add(local); advanced = true; break }
      }
      if (!advanced) break
    }
    if (solved) changed.push(id)
    else place(new Vector3())
  }
  return changed
}
