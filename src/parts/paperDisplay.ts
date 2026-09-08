import { Plane, ShapeUtils, Vector2, Vector3 } from 'three'
import { PAPER_SURFACE_LIFT, pageLeafRestHeight } from '../runtime/pageStack'
import type { PaperFace } from './geometry'

const CONTACT_LIFT = .001
export interface BookPaperSurface {
  normal: Vector3
  plane: Plane
  /** 紙の裏側に当たる、紙幅と奥行きで囲った領域。各平面の正側が領域内。 */
  occluded: Plane[]
}
export interface BookPaperDisplay { hingeY: number; surfaces: BookPaperSurface[] }

/** PaperSlabと同じ蝶番高・紙厚から、この見開きの内側の実紙面を求める。 */
export function bookPaperDisplay({ width, depth, thickness, index, count, leftAngle, rightAngle, frontCoverY }: {
  width: number; depth: number; thickness: number; index: number; count: number
  leftAngle: number; rightAngle: number; frontCoverY: number
}): BookPaperDisplay {
  const hingeY = pageLeafRestHeight(thickness)
  const surface = (angle: number, side: 'left' | 'right', height: number, inset: number): BookPaperSurface => {
    const ray = new Vector3(Math.cos(angle), Math.sin(angle), 0)
    const normal = new Vector3(-ray.y, ray.x, 0).multiplyScalar(side === 'right' ? 1 : -1)
    const origin = new Vector3(0, height, 0).addScaledVector(normal, inset + PAPER_SURFACE_LIFT)
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, origin)
    return { normal, plane, occluded: [plane.clone().negate(),
      new Plane().setFromNormalAndCoplanarPoint(ray, origin),
      new Plane().setFromNormalAndCoplanarPoint(ray.clone().negate(), origin.clone().addScaledVector(ray, width)),
      new Plane(new Vector3(0, 0, 1), depth / 2), new Plane(new Vector3(0, 0, -1), depth / 2),
    ] }
  }
  return { hingeY, surfaces: [
    surface(leftAngle, 'left', index === 0 ? frontCoverY : hingeY, index === 0 ? 0 : thickness / 2),
    surface(rightAngle, 'right', index === count - 1 ? 0 : hingeY, index === count - 1 ? thickness : thickness / 2),
  ] }
}

/** 紙に貼られた面だけを、その紙の内向き法線へ載せる。開閉の評価結果は変更しない。 */
export function paperDisplayFace(face: PaperFace, display: BookPaperDisplay): PaperFace {
  const origin = face.origin.clone().add(new Vector3(0, display.hingeY, 0))
  const center = origin.clone().addScaledVector(face.u, face.width / 2).addScaledVector(face.v, face.height / 2)
  // 全開時は左右が同じ平面になるため、実際の紙幅内にある側を選ぶ。
  const attached = display.surfaces.find(({ normal, occluded }) => Math.abs(normal.dot(face.u)) < 1e-9
    && Math.abs(normal.dot(face.v)) < 1e-9 && Math.abs(normal.dot(face.origin)) < 1e-9
    && occluded.slice(1).every((boundary) => boundary.distanceToPoint(center) >= -1e-9))
  if (attached) origin.addScaledVector(attached.normal, CONTACT_LIFT - attached.plane.distanceToPoint(origin))
  return { ...face, origin }
}

interface Vertex { point: Vector3; uv: Vector2 }
function clip(polygon: Vertex[], plane: Plane, sign: 1 | -1): Vertex[] {
  const result: Vertex[] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]
    const da = sign * plane.distanceToPoint(a.point), db = sign * plane.distanceToPoint(b.point)
    if (da >= 0) result.push(a)
    if ((da >= 0) !== (db >= 0)) {
      const ratio = da / (da - db)
      result.push({ point: a.point.clone().lerp(b.point, ratio), uv: a.uv.clone().lerp(b.uv, ratio) })
    }
  }
  return result
}

/** 紙の幅から外れる部分は残し、実紙面の裏へ入った部分だけを遮る。 */
function subtractPaper(polygon: Vertex[], volume: Plane[]): Vertex[][] {
  let inside = polygon
  const outside: Vertex[][] = []
  for (const boundary of volume) {
    const remainder = clip(inside, boundary, -1)
    if (remainder.length >= 3) outside.push(remainder)
    inside = clip(inside, boundary, 1)
    if (inside.length < 3) break
  }
  return outside
}

/** 本体・裏面・文字・影に同じ描画頂点を渡す。切断点のUVは元の材料座標を補間する。 */
export function paperMeshData(face: PaperFace, surfaces: BookPaperSurface[] = []): { positions: number[]; uvs: number[] } {
  const outline = (face.outline ?? [[0, 0], [1, 0], [1, 1], [0, 1]]).map(([u, v]) => new Vector2(u, v))
  const vertices: Vertex[] = outline.map((uv) => ({ uv, point: face.origin.clone()
    .addScaledVector(face.u, uv.x * face.width).addScaledVector(face.v, uv.y * face.height) }))
  let polygons = ShapeUtils.triangulateShape(outline, []).map((triangle) => triangle.map((index) => vertices[index]))
  for (const surface of surfaces) polygons = polygons.flatMap((polygon) => subtractPaper(polygon, surface.occluded))
  const positions: number[] = [], uvs: number[] = []
  for (const polygon of polygons) for (let i = 1; i + 1 < polygon.length; i++) {
    const triangle = [polygon[0], polygon[i], polygon[i + 1]]
    if (Math.abs(triangle[1].uv.clone().sub(triangle[0].uv).cross(triangle[2].uv.clone().sub(triangle[0].uv))) < 1e-12) continue
    for (const { uv } of triangle) {
      positions.push(uv.x * face.width, uv.y * face.height, 0)
      const [start, end] = face.artworkSpan ?? [0, 1]
      uvs.push(start + uv.x * (end - start), uv.y)
    }
  }
  return { positions, uvs }
}
