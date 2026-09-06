import { Matrix4, Quaternion, Vector3 } from 'three'

/**
 * 面上の一枚板・その剛体子孫だけに使う固定ヒンジ。
 * 紙の半空間に対する頂点距離D+A cosθ+B sinθの最初の零点で回転を制限する。
 * 根元の移動や全体縮小を行わず、履歴と衝突後の経路切替を持たない。
 */
export function constrainSurfaceHinge(input: {
  parent: Matrix4; authored: Matrix4; points: Vector3[]; open: number; leftAngle: number; rightAngle: number
}): { matrix: Matrix4; amount: number; invalidBase: boolean } {
  const position = new Vector3(), target = new Quaternion(), scale = new Vector3()
  input.authored.decompose(position, target, scale)
  const closed = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2)
  const relative = closed.clone().invert().multiply(target)
  if (relative.w < 0) relative.set(-relative.x, -relative.y, -relative.z, -relative.w)
  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, relative.w)))
  const axis = new Vector3(relative.x, relative.y, relative.z).normalize()
  const origin = position.clone().applyMatrix4(input.parent)
  const linear = new Matrix4().copy(input.parent).setPosition(0, 0, 0)
    .multiply(new Matrix4().makeRotationFromQuaternion(closed))
  const normals = [new Vector3(Math.sin(input.leftAngle), -Math.cos(input.leftAngle), 0), new Vector3(-Math.sin(input.rightAngle), Math.cos(input.rightAngle), 0)]
  let limit = angle * Math.max(0, Math.min(1, input.open)), invalidBase = false
  if (angle > 1e-10) for (const source of input.points) {
    const p = source.clone().multiply(scale), parallel = axis.clone().multiplyScalar(axis.dot(p))
    const perpendicular = p.clone().sub(parallel), cross = new Vector3().crossVectors(axis, p)
    parallel.applyMatrix4(linear); perpendicular.applyMatrix4(linear); cross.applyMatrix4(linear)
    for (const normal of normals) {
      const d = normal.dot(origin.clone().add(parallel)), a = normal.dot(perpendicular), b = normal.dot(cross)
      if (d + a < -1e-7) { invalidBase = true; continue }
      const radius = Math.hypot(a, b)
      if (radius < 1e-12 || -d / radius < -1 || -d / radius > 1) continue
      const phase = Math.atan2(b, a), delta = Math.acos(Math.max(-1, Math.min(1, -d / radius)))
      for (const sign of [-1, 1]) for (let turn = -1; turn <= 1; turn++) {
        const root = phase + sign * delta + turn * Math.PI * 2
        if (root < -1e-9 || root > limit + 1e-9) continue
        const derivative = -a * Math.sin(root) + b * Math.cos(root)
        if (derivative < -1e-10) limit = Math.max(0, Math.min(limit, root))
      }
    }
  }
  const amount = angle > 1e-10 ? limit / angle : input.open
  return { matrix: input.parent.clone().multiply(new Matrix4().compose(position, closed.clone().slerp(target, amount), scale)), amount, invalidBase }
}
