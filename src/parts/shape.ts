import { ShapeUtils, Vector2 } from 'three'
import { z } from 'zod'

const point = z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)])
const ring = z.array(point).min(3).max(256)
export const paperShapeSchema = z.object({ outer: ring, holes: z.array(ring).max(32) }).strict()
export type PaperShape = z.infer<typeof paperShapeSchema>
export type Point2 = [number, number]
export const rectangleShape = (): PaperShape => ({ outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [] })
export const shapeRings = (shape: PaperShape) => [shape.outer, ...shape.holes]
const epsilon = 1e-8
const cross = (a: Point2, b: Point2, c: Point2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
export function ringLocation(points: Point2[], p: Point2): 'inside' | 'outside' | 'boundary' {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i]
    if (Math.abs(cross(a, b, p)) < epsilon && (p[0] - a[0]) * (p[0] - b[0]) + (p[1] - a[1]) * (p[1] - b[1]) <= epsilon) return 'boundary'
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside ? 'inside' : 'outside'
}
export function shapeContains(shape: PaperShape, p: Point2): boolean {
  return ringLocation(shape.outer, p) !== 'outside' && shape.holes.every((hole) => ringLocation(hole, p) !== 'inside')
}
const segmentsMeet = (a: Point2, b: Point2, c: Point2, d: Point2) => {
  const signs = [cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)]
    .map(value => Math.abs(value) <= epsilon ? 0 : Math.sign(value))
  // 外積の積へ許容差を掛けると、小さな凹部の平行な辺まで交差と誤認する。
  return signs[0] * signs[1] <= 0 && signs[2] * signs[3] <= 0
    && Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) + epsilon
    && Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) + epsilon
}
/** 紙の輪郭は配置時に検証する。テクスチャの透明度から再生中に切り直さない。 */
export function inspectShape(shape: PaperShape): string[] {
  const parsed = paperShapeSchema.safeParse(shape)
  if (!parsed.success) return ['Invalid material shape coordinates']
  const rings = shapeRings(shape), errors: string[] = []
  for (const points of rings) {
    if (Math.abs(ShapeUtils.area(points.map(([x, y]) => new Vector2(x, y)))) < epsilon) errors.push('Paper outline has zero area')
    for (let i = 0; i < points.length; i++) {
      if (Math.hypot(points[i][0] - points[(i + 1) % points.length][0], points[i][1] - points[(i + 1) % points.length][1]) < epsilon) errors.push('Paper outline has a zero length edge')
      for (let j = i + 2; j < points.length; j++) if (!(i === 0 && j === points.length - 1)
        && segmentsMeet(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) errors.push('Paper outline intersects itself')
    }
  }
  for (let i = 0; i < rings.length; i++) for (let j = i + 1; j < rings.length; j++) {
    for (let a = 0; a < rings[i].length; a++) for (let b = 0; b < rings[j].length; b++) if (segmentsMeet(rings[i][a], rings[i][(a + 1) % rings[i].length], rings[j][b], rings[j][(b + 1) % rings[j].length])) errors.push('Paper shape boundaries intersect')
    if (i > 0 && (ringLocation(rings[i], rings[j][0]) !== 'outside' || ringLocation(rings[j], rings[i][0]) !== 'outside')) errors.push('Paper holes overlap')
  }
  if (shape.holes.some((hole) => ringLocation(shape.outer, hole[0]) !== 'inside')) errors.push('Paper hole lies outside its outline')
  return [...new Set(errors)]
}
export function shapeTriangles(shape: PaperShape): Point2[][] {
  const rings = shapeRings(shape).map((points) => points.map(([x, y]) => new Vector2(x, y)))
  const points = rings.flat()
  return ShapeUtils.triangulateShape(rings[0], rings.slice(1)).map((indices) => indices.map((index) => points[index].toArray() as Point2))
}
