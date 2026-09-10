import { Plane, Vector2, Vector3 } from 'three'
import { buildSparkleField } from '../runtime/visuals/sparkleField'
import type { EvaluatedContent } from './contents'
import { faceShape, pointOnFace } from './geometry'
import { clipDisplayPolygon, subtractPaper, type BookPaperSurface, type DisplayVertex } from './paperDisplay'
import { shapeTriangles } from './shape'

export function contentTriangles(content: EvaluatedContent, particles = false): DisplayVertex[][] {
  const { element, matrix } = content
  if (element.type === 'group') return []
  const ox = -element.pivot[0] * element.width, oy = -element.pivot[1] * element.height
  const rectangle = (x: number, y: number, w: number, h: number): DisplayVertex[][] => {
    const vertices = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => ({ uv: new Vector2(u, v),
      point: new Vector3(x + u * w, y + v * h, 0).applyMatrix4(matrix) }))
    return [[vertices[0], vertices[1], vertices[2]], [vertices[0], vertices[2], vertices[3]]]
  }
  if (!particles) return rectangle(ox, oy, element.width, element.height)
  const settings = element.particles
  const field = buildSparkleField(element.id, { width: element.width, height: element.height, count: settings.count })
  return Array.from({ length: field.rates.length }, (_, i) => {
    const time = content.time * Math.PI * 2 / settings.period * field.rates[i]
    const x = field.positions[i * 3] + Math.sin(time + field.phases[i * 3]) * settings.drift
    const y = field.positions[i * 3 + 1] + Math.sin(time + field.phases[i * 3 + 1]) * settings.drift
    return rectangle(ox + element.width / 2 + x - settings.size / 2, oy + element.height / 2 + y - settings.size / 2, settings.size, settings.size)
  }).flat()
}
/** 自由変換後の頂点にも紙と同じ有限遮蔽を使う。印刷は穴を除く実形状へ切り取る。 */
export function contentMeshData(content: EvaluatedContent, surfaces: BookPaperSurface[] = [], particles = false) {
  let polygons = content.visible ? contentTriangles(content, particles) : []
  if (content.element.presentation.kind === 'decal' && content.face) {
    const face = content.face, normal = face.u.clone().cross(face.v)
    const triangles = shapeTriangles(faceShape(face)).map((triangle) => triangle.map(([u, v]) => pointOnFace(face, u * face.width, v * face.height)))
    polygons = polygons.flatMap((polygon) => triangles.flatMap((triangle) => {
      let clipped = polygon
      const center = triangle.reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(1 / 3)
      for (let i = 0; i < 3; i++) {
        const a = triangle[i], edge = triangle[(i + 1) % 3].clone().sub(a)
        const plane = new Plane().setFromNormalAndCoplanarPoint(normal.clone().cross(edge).normalize(), a)
        if (plane.distanceToPoint(center) < 0) plane.negate()
        clipped = clipDisplayPolygon(clipped, plane, 1)
      }
      return clipped.length >= 3 ? [clipped] : []
    }))
  }
  for (const surface of surfaces) polygons = polygons.flatMap((polygon) => subtractPaper(polygon, surface.occluded))
  const positions: number[] = [], uvs: number[] = []
  for (const polygon of polygons) for (let i = 1; i + 1 < polygon.length; i++) for (const vertex of [polygon[0], polygon[i], polygon[i + 1]]) {
    positions.push(...vertex.point); uvs.push(vertex.uv.x, vertex.uv.y)
  }
  return { positions, uvs }
}
