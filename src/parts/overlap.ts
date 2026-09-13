import { Box3, Vector2 } from 'three'
import { faceShape, pointOnFace, type PaperFace } from './geometry'
import { shapeTriangles } from './shape'

const cross = (a: Vector2, b: Vector2) => a.x * b.y - a.y * b.x
const area = (points: Vector2[]) => Math.abs(points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length]), 0)) / 2

/** 共面の重複を面積で調べる。通常の貫通検査とは分け、閉じて重なった紙を禁止しない。 */
export function coplanarOverlapArea(a: PaperFace, b: PaperFace, gap = .0001): number {
  const na = a.u.clone().cross(a.v).normalize(), nb = b.u.clone().cross(b.v).normalize()
  if (na.clone().cross(nb).lengthSq() > 1e-10) return 0
  const corners = (face: PaperFace) => faceShape(face).outer.map(([u, v]) => pointOnFace(face, u * face.width, v * face.height))
  const ca = corners(a), cb = corners(b)
  if (cb.some(p => Math.abs(p.clone().sub(a.origin).dot(na)) > gap)) return 0
  if (!new Box3().setFromPoints(ca).expandByScalar(gap).intersectsBox(new Box3().setFromPoints(cb))) return 0
  const triangles = (face: PaperFace) => shapeTriangles(faceShape(face)).map(triangle => triangle.map(([u, v]) => {
    const p = pointOnFace(face, u * face.width, v * face.height).sub(a.origin)
    return new Vector2(p.dot(a.u), p.dot(a.v))
  }))
  let total = 0
  const aTriangles = triangles(a), bTriangles = triangles(b)
  for (const ta of aTriangles) for (const tb of bTriangles) {
    let clipped = ta
    const sign = Math.sign(cross(tb[1].clone().sub(tb[0]), tb[2].clone().sub(tb[0])))
    for (let i = 0; i < 3 && clipped.length; i++) {
      const start = tb[i], edge = tb[(i + 1) % 3].clone().sub(start), next: Vector2[] = []
      const distance = (p: Vector2) => sign * cross(edge, p.clone().sub(start))
      for (let j = 0; j < clipped.length; j++) {
        const p = clipped[j], q = clipped[(j + 1) % clipped.length], dp = distance(p), dq = distance(q)
        if (dp >= 0) next.push(p)
        if (dp * dq < 0) next.push(p.clone().lerp(q, dp / (dp - dq)))
      }
      clipped = next
    }
    if (clipped.length >= 3) total += area(clipped)
  }
  return total
}
