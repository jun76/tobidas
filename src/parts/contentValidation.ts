import { Box3, Vector3 } from 'three'
import { COLOR_PROPERTIES, DISCRETE_PROPERTIES, NUMBER_PROPERTIES } from '../schema/timeline'
import { evaluateContents, type ContentContext, type EvaluatedContent } from './contents'
import { contentTriangles } from './contentDisplay'
import { faceShape, makeFace, pointOnFace, type BoundPaperContent, type PaperFace } from './geometry'
import { facesCross } from './intersections'
import { contentMotionEnvelopes } from './contentEnvelope'

export function inspectContentBindings(bindings: BoundPaperContent[]): string[] {
  const errors: string[] = []
  for (const { id, element, tracks } of bindings) {
    if (element.presentation.kind === 'decal' && element.attachment.type !== 'surface') errors.push(`Decal requires a material surface: ${id}`)
    const seen = new Set<string>()
    for (const track of tracks) {
      if (track.target.type !== 'element' || track.target.elementId !== element.id) errors.push(`Content track must target its own element: ${id}`)
      if (!/^(position\.|rotation\.|scale|opacity$|visible$|visual\.)/.test(track.property)) errors.push(`Unsupported content property: ${id}/${track.property}`)
      if (element.presentation.kind === 'decal' && /^(position|rotation|scale|visual\.(width|height))/.test(track.property)) errors.push(`Printed content cannot animate its material placement: ${id}`)
      if (element.type !== 'visual' && track.property.startsWith('visual.') && !(element.type === 'particle' && /^visual\.(width|height|particles\.)/.test(track.property))) errors.push(`Content property does not match its display type: ${id}`)
      if (seen.has(track.property)) errors.push(`Duplicate content track: ${id}/${track.property}`)
      seen.add(track.property)
      const times = new Set<number>()
      for (const key of track.keys) {
        if (times.has(key.time)) errors.push(`Duplicate content key time: ${id}`)
        times.add(key.time)
        const valid = NUMBER_PROPERTIES.has(track.property) ? typeof key.value === 'number' && Number.isFinite(key.value)
          : COLOR_PROPERTIES.has(track.property) || track.property === 'visual.image' ? typeof key.value === 'string' : typeof key.value === 'boolean'
        if (!valid || DISCRETE_PROPERTIES.has(track.property) !== (key.ease === 'hold')) errors.push(`Invalid content timeline value or easing: ${id}`)
      }
    }
  }
  return [...new Set(errors)]
}
/** 演出は剛体紙として登録せず、評価後の三角形と紙の実形状の交差を検査する。 */
export function inspectContentIntersections(contents: EvaluatedContent[], faces: PaperFace[], envelope = false): string[] {
  const bounds = faces.map((face) => new Box3().setFromPoints(faceShape(face).outer.map(([u, v]) => pointOnFace(face, u * face.width, v * face.height))))
  const errors: string[] = []
  const envelopes = envelope ? new Map(contentMotionEnvelopes(contents).map((item) => [item.id, item])) : undefined
  for (const content of contents) {
    if (!content.visible || content.element.presentation.kind === 'decal' || content.element.type === 'group') continue
    const motionEnvelope = envelopes?.get(content.id)
    const triangles = motionEnvelope?.triangles ?? contentTriangles(content, content.element.type === 'particle')
    const hit = new Set<string>()
    // 紙全体が包絡の内部にある場合も、箱の外周との交線がないだけで見逃さない。
    const volume = motionEnvelope?.volume
    if (volume) for (const face of faces) if (faceShape(face).outer.some(([u, v]) => volume.bounds.containsPoint(
      pointOnFace(face, u * face.width, v * face.height).applyMatrix4(volume.inverse)))) hit.add(face.id)
    for (const vertices of triangles) {
      const points = vertices.map((v) => v.point), u = points[1].clone().sub(points[0]), edge = points[2].clone().sub(points[0]), normal = u.clone().cross(edge)
      if (normal.lengthSq() < 1e-14) continue
      u.normalize(); normal.normalize(); const v = normal.clone().cross(u)
      const local = points.map((p) => p.clone().sub(points[0])), xs = local.map((p) => p.dot(u)), ys = local.map((p) => p.dot(v))
      const x = Math.min(...xs), y = Math.min(...ys), width = Math.max(...xs) - x, height = Math.max(...ys) - y
      const face = makeFace(content.id, points[0].clone().addScaledVector(u, x).addScaledVector(v, y), u, v, width, height)
      face.outline = xs.map((value, i) => [(value - x) / width, (ys[i] - y) / height])
      const box = new Box3().setFromPoints(points)
      for (let i = 0; i < faces.length; i++) if (!hit.has(faces[i].id) && bounds[i].intersectsBox(box) && facesCross(face, faces[i])) hit.add(faces[i].id)
    }
    for (const id of hit) errors.push(`Content crosses paper: ${content.id} / ${id}`)
  }
  return errors
}
/** 代表位相とキー間を明示して検査する。有限サンプルを全位相の証明とは扱わない。 */
export function contentSampleTimes(bindings: BoundPaperContent[], hold: number): number[] {
  const times = new Set([0, hold / 2, hold])
  for (const { element, tracks } of bindings) {
    for (const motion of element.motion) if ('period' in motion) for (const phase of [.25, .5, .75, 1]) times.add(motion.period * phase)
    for (const track of tracks) {
      const keys = [...track.keys].sort((a, b) => a.time - b.time)
      keys.forEach((key, i) => { times.add(key.time); if (i) times.add((keys[i - 1].time + key.time) / 2) })
    }
  }
  return [...times].sort((a, b) => a - b)
}
export function inspectContentsAt(bindings: BoundPaperContent[], context: Omit<ContentContext, 'clock'>, motionTime = 0): string[] {
  try { evaluateContents(bindings, { ...context, clock: () => motionTime }); return [] }
  catch (error) { return [error instanceof Error ? error.message : String(error)] }
}

/** 確定操作用の有限検査。角度は呼び出し側で共有し、保持時刻ごとに全周期の包絡を調べる。 */
export function inspectContentMotion(bindings: BoundPaperContent[], faces: PaperFace[], context: Omit<ContentContext, 'clock' | 'holdTime'>, hold: number): string[] {
  const errors = new Set<string>()
  let samples = 0
  const byId = new Map(bindings.map((bound) => [bound.id, bound]))
  for (const bound of bindings) {
    if (bound.element.presentation.kind === 'decal') continue
    const family = [bound], seen = new Set([bound.id])
    let parentId = bound.parentId
    while (parentId && !seen.has(parentId)) {
      const parent = byId.get(parentId); if (!parent) break
      family.push(parent); seen.add(parentId); parentId = parent.parentId
    }
    const times = contentSampleTimes(family, hold).filter((time) => time <= hold)
    samples += times.length * family.length
    if (samples > 20000) return [...errors, 'Content motion is unverified: inspection budget exceeded']
    for (const holdTime of times) {
      try {
        const contents = evaluateContents(family, { ...context, holdTime, clock: () => holdTime })
        for (const error of inspectContentIntersections(contents, faces, true)) errors.add(error)
      } catch (error) { errors.add(error instanceof Error ? error.message : String(error)) }
    }
  }
  return [...errors]
}
