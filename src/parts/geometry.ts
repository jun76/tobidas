import { Vector3 } from 'three'
import type { PartInput, PartMaterial } from './schema'
import type { ConnectedContent } from '../schema/content'
import type { TimelineTrack } from '../schema/timeline'
import { rectangleShape, shapeContains, shapeRings, type PaperShape } from './shape'

/** 寸法・輪郭は配置時の設計値。開閉中に変わるのはoriginと直交するu/vの姿勢だけ。 */
export interface PaperFace {
  id: string; origin: Vector3; u: Vector3; v: Vector3; width: number; height: number
  support: boolean; material: PartMaterial; outline?: [number, number][]; shape?: PaperShape
  /** 本の論理ページ。綴じ目の外側へ無限に延び、実紙の輪郭は描画・収納で別に扱う。 */
  infinitePage?: boolean
  /** 論理ページを延長した支持紙。見えない紙面の一部なので描かない。 */
  hidden?: boolean
  /** 一枚の絵を複数の剛体面へ分けるときの、画像横方向の担当範囲。 */
  artworkSpan?: [number, number]
  /** 仮想接続面を実際に覆う親面と支持紙。接着検査では空白を支持面とみなさない。 */
  contactRegions?: PaperFace[]
  /** 同一平面に重ねた紙の順序。接続の計算座標には紙厚を加えず、描画時だけ使う。 */
  surfaceStack?: { base: PaperFace; layers: string[] }
}
export interface FoldPair {
  kind: 'fold-pair'; a: PaperFace; b: PaperFace; origin: Vector3; axis: Vector3
  rayA: Vector3; rayB: Vector3; extentA: number; extentB: number; width: number; foldSign: 1 | -1
}
export type PartPort = { kind: 'surface'; face: PaperFace } | FoldPair
/** 世界座標で返す接着線は、親と子それぞれの材料座標で開閉中ずっと同じ位置を指す。 */
export interface PaperConnection {
  actual: Vector3[]; expected: Vector3[]; parentFace: string; childFace: string
}
export interface BoundPaperContent {
  id: string; ownerId: string; element: ConnectedContent; tracks: TimelineTrack[]
  face?: PaperFace; parentId?: string; unitScale: number
}
export const faceShape = (face: PaperFace): PaperShape => face.shape ?? { outer: face.outline ?? rectangleShape().outer, holes: [] }
export interface PaperEvaluation {
  deploymentScale?: number
  rootSupport?: 'pages' | 'independent'
  contents?: BoundPaperContent[]
  faces: PaperFace[]; ports: Record<string, PartPort>; connections: PaperConnection[]
  /** 編集ハンドルが参照する実入力。作品や交換形式には保存しない。 */
  inputPort?: PartPort
  nodes?: Record<string, PaperEvaluation>
  /** 親面と補完ブリッジが覆う接続領域。描画面とは分けて接着検査に使う。 */
  contactSurfaces?: PaperFace[]
}
export const EPSILON = 1e-7
export const pointOnFace = (face: PaperFace, u: number, v: number) => face.origin.clone().addScaledVector(face.u, u).addScaledVector(face.v, v)
/** 仮想接続面は層を引き継ぎ、貼り付ける紙・補完する支持紙は一層追加する。 */
export function stackOnSurface(parent: PaperFace, layerId?: string): NonNullable<PaperFace['surfaceStack']> {
  const stack = parent.surfaceStack ?? { base: parent, layers: [] }
  return { base: stack.base, layers: layerId ? [...stack.layers, layerId] : stack.layers }
}
export function openingAngle(pair: FoldPair): number {
  return Math.acos(Math.max(-1, Math.min(1, pair.rayA.dot(pair.rayB)))) * 180 / Math.PI
}
export function checkInput(input: PartInput, port: PartPort): void {
  if (input.kind !== port.kind) throw new Error(`Expected ${input.kind}, got ${port.kind}`)
  if (input.kind === 'fold-pair' && port.kind === 'fold-pair' && openingAngle(port) > input.maxOpeningAngleDeg + 1e-6) {
    throw new Error(`Opening angle ${openingAngle(port).toFixed(2)} exceeds ${input.maxOpeningAngleDeg}`)
  }
}
export function faceCorners(face: PaperFace): Vector3[] {
  return [[0, 0], [face.width, 0], [face.width, face.height], [0, face.height]].map(([u, v]) => pointOnFace(face, u, v))
}
export function faceContains(face: PaperFace, point: Vector3, epsilon = EPSILON): boolean {
  const delta = point.clone().sub(face.origin), u = delta.dot(face.u), v = delta.dot(face.v)
  if (face.infinitePage) return Math.abs(delta.dot(face.u.clone().cross(face.v))) <= epsilon && v >= -epsilon
  if (Math.abs(delta.dot(face.u.clone().cross(face.v))) > epsilon
    || u < -epsilon || u > face.width + epsilon || v < -epsilon || v > face.height + epsilon) return false
  if (face.contactRegions) return face.contactRegions.some((region) => faceContains(region, point, epsilon))
  if (!face.shape && !face.outline) return true
  return shapeContains(faceShape(face), [Math.max(0, Math.min(1, u / face.width)), Math.max(0, Math.min(1, v / face.height))])
}
/** 輪郭を横切る全区間を調べ、接着線の途中だけが切り落とされることも拒否する。 */
export function faceContainsLine(face: PaperFace, a: Vector3, b: Vector3): boolean {
  if (!faceContains(face, a) || !faceContains(face, b)) return false
  if (!face.outline && !face.shape && !face.contactRegions) return true
  const delta = b.clone().sub(a), cuts = [0, 1]
  const boundaries = (region: PaperFace) => {
    const origin = a.clone().sub(region.origin), ux = origin.dot(region.u), uy = origin.dot(region.v)
    const dx = delta.dot(region.u), dy = delta.dot(region.v)
    for (const ring of shapeRings(faceShape(region))) {
    const points = ring.map(([u, v]) => [u * region.width, v * region.height])
    for (let i = 0; i < points.length; i++) {
      const [ax, ay] = points[i], [bx, by] = points[(i + 1) % points.length], ex = bx - ax, ey = by - ay
      const denominator = dx * ey - dy * ex
      if (Math.abs(denominator) < EPSILON) continue
      const t = ((ax - ux) * ey - (ay - uy) * ex) / denominator
      const s = ((ax - ux) * dy - (ay - uy) * dx) / denominator
      if (t > 0 && t < 1 && s >= 0 && s <= 1) cuts.push(t)
    }
    }
    region.contactRegions?.forEach(boundaries)
  }
  boundaries(face)
  cuts.sort((x, y) => x - y)
  return cuts.slice(1).every((end, i) => faceContains(face, a.clone().addScaledVector(delta, (cuts[i] + end) / 2)))
}
export function makeFace(id: string, origin: Vector3, u: Vector3, v: Vector3, width: number, height: number, support = false): PaperFace {
  if (Math.abs(u.dot(v)) > 1e-6 || Math.abs(u.length() - 1) > 1e-6 || Math.abs(v.length() - 1) > 1e-6) throw new Error(`Non-rigid face: ${id}`)
  return { id, origin, u, v, width, height, support, material: { color: support ? '#d8c8a7' : '#e3b476' } }
}

/** 実見開きと検証台の両方が使う二面。左と右の実角度をそのまま渡す。 */
export function pagePorts(width: number, depth: number, leftAngle: number, rightAngle: number): Record<string, PartPort> {
  const axis = new Vector3(0, 0, 1), origin = new Vector3(0, 0, -depth / 2)
  const right = new Vector3(Math.cos(rightAngle), Math.sin(rightAngle), 0)
  const left = new Vector3(Math.cos(leftAngle), Math.sin(leftAngle), 0)
  const a = makeFace('$book/right', origin, axis, right, depth, width)
  const b = makeFace('$book/left', origin, axis, left, depth, width)
  return { 'right-page': { kind: 'surface', face: a }, 'left-page': { kind: 'surface', face: b },
    gutter: { kind: 'fold-pair', a, b, origin: new Vector3(), axis, rayA: right, rayB: left, extentA: width, extentB: width, width: depth, foldSign: 1 } }
}

/** ページの材料原点は有限ページと同じ。紙部品だけが無限の配置領域を使う。 */
export function logicalPagePorts(width: number, depth: number, leftAngle: number, rightAngle: number): Record<string, PartPort> {
  const ports = pagePorts(width, depth, leftAngle, rightAngle)
  for (const port of Object.values(ports)) if (port.kind === 'surface') port.face.infinitePage = true
  const gutter = ports.gutter as FoldPair
  gutter.width = gutter.extentA = gutter.extentB = Infinity
  return ports
}
