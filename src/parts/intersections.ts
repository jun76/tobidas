import { Box3, Vector3 } from 'three'
import { faceContains, faceShape, pointOnFace, type PaperEvaluation, type PaperFace } from './geometry'

import { shapeRings } from './shape'

const tolerance = 1e-6
const polygon = (face: PaperFace) => faceShape(face).outer.map(([u, v]) => pointOnFace(face, u * face.width, v * face.height))
function interior(face: PaperFace, point: Vector3) {
  if (!faceContains(face, point, tolerance)) return false
  for (const ring of shapeRings(faceShape(face))) {
  const vertices = ring.map(([u, v]) => pointOnFace(face, u * face.width, v * face.height))
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], edge = vertices[(i + 1) % vertices.length].clone().sub(a), length = edge.lengthSq()
    const t = length ? Math.max(0, Math.min(1, point.clone().sub(a).dot(edge) / length)) : 0
    if (a.clone().addScaledVector(edge, t).distanceTo(point) < tolerance) return false
  }
  }
  return true
}
/** 交線上の全区間を調べる。凹輪郭の穴や、共有ヒンジ上の接触を貫通とみなさない。 */
export function facesCross(a: PaperFace, b: PaperFace): boolean {
  const na = a.u.clone().cross(a.v), nb = b.u.clone().cross(b.v), cross = na.clone().cross(nb)
  if (cross.lengthSq() < 1e-12) return false
  const origin = nb.clone().cross(cross).multiplyScalar(na.dot(a.origin))
    .addScaledVector(cross.clone().cross(na), nb.dot(b.origin)).divideScalar(cross.lengthSq())
  const axis = cross.normalize(), cuts: number[] = []
  for (const [face, other, normal] of [[a, b, nb], [b, a, na]] as const) {
    for (const ring of shapeRings(faceShape(face))) {
    const points = ring.map(([u, v]) => pointOnFace(face, u * face.width, v * face.height))
    for (let i = 0; i < points.length; i++) {
      const p = points[i], q = points[(i + 1) % points.length]
      const da = p.clone().sub(other.origin).dot(normal), db = q.clone().sub(other.origin).dot(normal)
      if (Math.abs(da) < tolerance) cuts.push(p.clone().sub(origin).dot(axis))
      if (da * db < 0) cuts.push(p.clone().lerp(q, da / (da - db)).sub(origin).dot(axis))
    }
  }
  }
  cuts.sort((x, y) => x - y)
  return cuts.slice(1).some((end, i) => end - cuts[i] > tolerance && (() => {
    const mid = origin.clone().addScaledVector(axis, (cuts[i] + end) / 2)
    return interior(a, mid) && interior(b, mid)
  })())
}
export function inspectIntersections(result: PaperEvaluation, affected?: Set<string>): string[] {
  const faces = result.faces, bounds = faces.map((face) => new Box3().setFromPoints(polygon(face)).expandByScalar(tolerance))
  const errors: string[] = []
  let checks = 0
  for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
    if (affected && !affected.has(faces[i].id.split('/')[0]) && !affected.has(faces[j].id.split('/')[0])) continue
    if (!bounds[i].intersectsBox(bounds[j])) continue
    if (++checks > 200000) throw new Error('Intersection check budget exceeded; candidate remains unverified')
    if (facesCross(faces[i], faces[j])) errors.push(`Paper intersection: ${faces[i].id} / ${faces[j].id}`)
    if (errors.length >= 8) return errors
  }
  return errors
}

/** 接着以外の面が接近し始める区間を、確定時の追加サンプリングへ渡す。 */
export function nearbyPaperPairs(result: PaperEvaluation, affected: Set<string>, distance = .025): string {
  const faces = result.faces, bounds = faces.map((face) => new Box3().setFromPoints(polygon(face)))
  const attached = new Set(result.connections.map((edge) => [edge.parentFace, edge.childFace].sort().join('|')))
  const near: string[] = []
  const approaches = (a: PaperFace, b: PaperFace) => {
    const normal = b.u.clone().cross(b.v)
    return polygon(a).some((point) => {
      const gap = point.clone().sub(b.origin).dot(normal)
      return Math.abs(gap) > tolerance && Math.abs(gap) < distance && interior(b, point.addScaledVector(normal, -gap))
    })
  }
  for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
    const a = faces[i], b = faces[j], key = [a.id, b.id].sort().join('|')
    if (!affected.has(a.id.split('/')[0]) && !affected.has(b.id.split('/')[0])) continue
    if (attached.has(key) || a.surfaceStack?.base.id === b.id || b.surfaceStack?.base.id === a.id) continue
    if (!bounds[i].clone().expandByScalar(distance).intersectsBox(bounds[j])) continue
    if (approaches(a, b) || approaches(b, a)) near.push(key)
  }
  return near.sort().join(';')
}
