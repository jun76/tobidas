import { Box3, Matrix4, Vector3 } from 'three'
import type { ConnectedContent } from '../schema/content'
import type { EvaluatedContent } from './contents'
import { contentSurfaceFrame } from './contents'
import { contentTriangles } from './contentDisplay'
import type { DisplayVertex } from './paperDisplay'

type Interval = [number, number]
type Transform = { m: Interval[][]; p: Interval[] }
const point = (n: number): Interval => [n, n]
const add = (a: Interval, b: Interval): Interval => [a[0] + b[0], a[1] + b[1]]
const mul = (a: Interval, b: Interval): Interval => {
  const ns = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]]
  return [Math.min(...ns), Math.max(...ns)]
}
const trig = (range: Interval, cosine = false): Interval => {
  const [a, b] = range.map((v) => v * Math.PI / 180 + (cosine ? Math.PI / 2 : 0))
  if (b - a >= Math.PI * 2) return [-1, 1]
  const ns = [Math.sin(a), Math.sin(b)]
  for (let k = Math.ceil((a - Math.PI / 2) / Math.PI); k <= Math.floor((b - Math.PI / 2) / Math.PI); k++) ns.push(k % 2 ? -1 : 1)
  return [Math.min(...ns), Math.max(...ns)]
}
const mm = (a: Interval[][], b: Interval[][]) => a.map((row) => b[0].map((_, j) => row.reduce((sum, x, k) => add(sum, mul(x, b[k][j])), point(0))))
const mv = (a: Interval[][], b: Interval[]) => a.map((row) => row.reduce((sum, x, i) => add(sum, mul(x, b[i])), point(0)))
const identity = (): Interval[][] => [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((row) => row.map(point))
function transform(e: ConnectedContent, ratio: number, g: number): Transform {
  const positions = e.baseTransform.position.map(point), rotations = e.baseTransform.rotation.map(point)
  let scale: Interval = [ratio * g, ratio * g]
  const widen = (a: Interval, amplitude: number): Interval => [a[0] - Math.abs(amplitude), a[1] + Math.abs(amplitude)]
  for (const motion of e.motion) {
    if (motion.type === 'bob') { const i = motion.axis === 'x' ? 0 : motion.axis === 'z' ? 2 : 1; positions[i] = widen(positions[i], motion.amplitude) }
    if (motion.type === 'drift') motion.amplitude.forEach((n, i) => { positions[i] = widen(positions[i], n) })
    if (motion.type === 'sway') rotations[2] = widen(rotations[2], motion.amplitude)
    if (motion.type === 'spin' && motion.speed !== 0) rotations['xyz'.indexOf(motion.axis)] = [-180, 180]
    if (motion.type === 'pulse') scale = mul(scale, [1 - Math.abs(motion.amplitude), 1 + Math.abs(motion.amplitude)])
  }
  if (e.type !== 'group' && e.billboard) rotations.forEach((_, i) => { rotations[i] = [-180, 180] })
  let m = identity()
  for (let axis = 0; axis < 3; axis++) {
    const r = identity(), c = trig(rotations[axis], true), s = trig(rotations[axis]), i = (axis + 1) % 3, j = (axis + 2) % 3
    r[i][i] = r[j][j] = c; r[j][i] = s; r[i][j] = mul(s, [-1, -1]); m = mm(m, r)
  }
  m = m.map((row) => row.map((n, i) => mul(n, mul(scale, point(e.baseTransform.scale[i])))))
  return { m, p: positions.map((v) => mul(v, point(ratio * g))) }
}
/** 各周期を独立な区間として合成する。周期の公倍数やランダム位相の一致に頼らない。 */
export function contentMotionEnvelopes(contents: EvaluatedContent[]): { id: string; triangles: DisplayVertex[][]; volume?: { inverse: Matrix4; bounds: Box3 } }[] {
  const byId = new Map(contents.map((item) => [item.id, item])), states = new Map<string, { t: Transform; anchor: Matrix4; animated: boolean }>()
  const state = (item: EvaluatedContent): { t: Transform; anchor: Matrix4; animated: boolean } => {
    const saved = states.get(item.id); if (saved) return saved
    const at = item.element.attachment
    // 評価済みIDから親を解決する。カスタム内部は同じ名前空間へ束縛済み。
    const parent = item.parentId ? byId.get(item.parentId) : undefined
    const own = transform(item.element, parent ? item.unitScale / parent.unitScale : item.unitScale, parent ? 1 : item.exitScale)
    const host = parent && state(parent)
    const animated = item.element.motion.length > 0 || (item.element.type !== 'group' && item.element.billboard) || Boolean(host?.animated)
    const result = host ? { anchor: host.anchor, animated, t: { m: mm(host.t.m, own.m), p: mv(host.t.m, own.p).map((v, i) => add(v, host.t.p[i])) } }
      : { anchor: at.type === 'surface' && item.face ? contentSurfaceFrame(item.face, at.point.map((n) => n * item.unitScale) as [number, number], at.side) : item.anchor, t: own, animated }
    states.set(item.id, result); return result
  }
  return contents.flatMap((item) => {
    if (!item.visible || item.element.type === 'group' || item.element.presentation.kind === 'decal') return []
    const e = item.element, { t, anchor, animated } = state(item)
    // 揺れも回転もしない内容は、回転を区間で包んだ箱ではなく実際の矩形そのもので検査する。
    // 斜めに置いた面の箱は実体より大きく、隣の紙との偽の交差を生む。
    if (!animated && e.type !== 'particle' && !e.particles.enabled) return [{ id: item.id, triangles: contentTriangles(item) }]
    const particles = e.type === 'particle' || e.particles.enabled
    const pad = particles ? e.particles.drift + e.particles.size / 2 : 0
    const bounds = [
      [-e.width * e.pivot[0] - pad, e.width * (1 - e.pivot[0]) + pad],
      [-e.height * e.pivot[1] - pad, e.height * (1 - e.pivot[1]) + pad], [0, 0],
    ] as Interval[]
    const box = mv(t.m, bounds).map((v, i) => add(v, t.p[i]))
    const min = new Vector3(...box.map((v) => v[0])), max = new Vector3(...box.map((v) => v[1]))
    const size = new Box3(min, max).getSize(new Vector3()), center = min.clone().add(max).multiplyScalar(.5)
    const triangles: DisplayVertex[][] = []
    for (let normal = 0; normal < 3; normal++) {
      const i = (normal + 1) % 3, j = (normal + 2) % 3
      if (size.getComponent(i) < 1e-8 || size.getComponent(j) < 1e-8) continue
      for (const sign of size.getComponent(normal) < 1e-8 ? [0] : [-1, 1]) {
        const u = new Vector3().setComponent(i, 1), v = new Vector3().setComponent(j, 1), n = u.clone().cross(v)
        const matrix = anchor.clone().multiply(new Matrix4().makeBasis(u, v, n).setPosition(center.clone().addScaledVector(n, sign * size.getComponent(normal) / 2)))
        triangles.push(...contentTriangles({ ...item, matrix, element: { ...e, width: size.getComponent(i), height: size.getComponent(j), pivot: [.5, .5] } }))
      }
    }
    const volume = Math.min(size.x, size.y, size.z) > 1e-7
      ? { inverse: anchor.clone().invert(), bounds: new Box3(min.clone(), max.clone()).expandByScalar(-1e-8) } : undefined
    return [{ id: item.id, triangles, volume }]
  })
}
