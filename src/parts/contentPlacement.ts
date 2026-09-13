import { Vector3 } from 'three'
import type { PaperEvaluation, PaperFace } from './geometry'
import { faceContains, faceShape, pointOnFace } from './geometry'
import type { PartSurfaceRef } from './schema'
import type { BookProject } from '../schema/bookPackage'
import type { Spread } from '../schema/book'
import { evaluateBookParts } from './book'
import { bindBookContents, evaluateContents } from './contents'
import { contentSampleTimes, inspectContentIntersections } from './contentValidation'
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
