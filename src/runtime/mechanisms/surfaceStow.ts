import { Box3, Matrix4, Quaternion, Vector3 } from 'three'

export interface SurfaceStowInput {
  /** 親面アンカーを原点とする、子全体の現在境界。 */
  bounds: Box3
  /** 同じアンカー座標系の親面頂点。面の凸包の範囲へ収納する。 */
  surfacePoints: Vector3[]
  open: number
  /** 子機構が畳まれた面の法線。作者の回転まで適用したアンカー座標。 */
  foldNormal: Vector3
  /** 実駆動の祖先がある場合だけ指定する。仮想rootの楔収納とは重ねない。 */
  pageFrame?: { anchorMatrix: Matrix4; leftAngle: number; rightAngle: number }
}

const smooth = (value: number) => { const u = Math.max(0, Math.min(1, value)); return u * u * (3 - 2 * u) }
function corners(bounds: Box3): Vector3[] {
  return [bounds.min.x, bounds.max.x].flatMap((x) => [bounds.min.y, bounds.max.y].flatMap((y) =>
    [bounds.min.z, bounds.max.z].map((z) => new Vector3(x, y, z))))
}

type Point = { x: number; z: number }
/** 収納面の投影凸包。円形上面の角を矩形扱いしてはみ出させない。 */
function convexHull(points: Vector3[]): Point[] {
  const sorted = points.map(({ x, z }) => ({ x, z })).sort((a, b) => a.x - b.x || a.z - b.z)
    .filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.z - all[i - 1].z) > 1e-9)
  if (sorted.length <= 2) return sorted
  const turn = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
  const lower: Point[] = [], upper: Point[] = []
  for (const p of sorted) { while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-10) lower.pop(); lower.push(p) }
  for (const p of [...sorted].reverse()) { while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-10) upper.pop(); upper.push(p) }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** 親面のアンカーを固定したまま、子全体を寝かせて相似縮小する。 */
export function evaluateSurfaceStow(input: SurfaceStowInput): { matrix: Matrix4; scale: number; diagnostics: string[] } {
  const matrix = new Matrix4(), diagnostics: string[] = []
  if (input.bounds.isEmpty() || input.open >= 1) return { matrix, scale: 1, diagnostics }
  const normal = input.foldNormal.clone().normalize()
  const foldedRotation = new Quaternion().setFromUnitVectors(normal, new Vector3(0, 1, 0))
  const fold = 1 - smooth((input.open - .12) / .76)
  const rotation = new Quaternion().slerp(foldedRotation, fold)
  const rotated = corners(input.bounds).map((p) => p.applyQuaternion(rotation))
  const release = smooth((input.open - .4) / .6)
  let scale = 1
  const hull = convexHull(input.surfacePoints)
  if (hull.length >= 3) {
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length]
      // 反時計回りの輪郭の外向き法線。
      const nx = b.z - a.z, nz = a.x - b.x
      const boundary = Math.max(0, nx * a.x + nz * a.z)
      const maximum = Math.max(...rotated.map((p) => nx * p.x + nz * p.z))
      if (maximum > 1e-10) {
        const allowed = boundary + Math.max(0, maximum - boundary) * release
        scale = Math.min(scale, allowed / maximum)
      }
    }
  } else if (hull.length) {
    // 親面自体が線へ閉じた場合も、面外へ有限幅の子を残さない。
    scale = Math.min(scale, release)
  }
  if (input.pageFrame) {
    const { anchorMatrix, leftAngle, rightAngle } = input.pageFrame
    const anchor = new Vector3().applyMatrix4(anchorMatrix)
    for (const pageNormal of [new Vector3(Math.sin(leftAngle), -Math.cos(leftAngle), 0), new Vector3(-Math.sin(rightAngle), Math.cos(rightAngle), 0)]) {
      const anchorDistance = pageNormal.dot(anchor)
      const minimumDelta = Math.min(...rotated.map((p) => pageNormal.dot(p.clone().applyMatrix4(anchorMatrix).sub(anchor))))
      if (minimumDelta < -1e-10) scale = Math.min(scale, Math.max(0, anchorDistance) / -minimumDelta)
      if (anchorDistance < -1e-5) diagnostics.push('Surface attachment anchor lies behind a real page')
    }
  }
  scale = Math.max(0, Math.min(1, scale))
  matrix.makeRotationFromQuaternion(rotation).multiply(new Matrix4().makeScale(scale, scale, scale))
  return { matrix, scale, diagnostics }
}
