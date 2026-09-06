import { describe, expect, it } from 'vitest'
import { Box3, Matrix4, Vector3 } from 'three'
import { evaluateSurfaceStow } from './surfaceStow'

const rectangle = [new Vector3(-1, 0, -1.5), new Vector3(1, 0, -1.5), new Vector3(1, 0, 1.5), new Vector3(-1, 0, 1.5)]
const bounds = new Box3(new Vector3(0, 0, -2), new Vector3(0, 4, 2))
const input = { bounds, surfacePoints: rectangle, foldNormal: new Vector3(1, 0, 0) }

describe('面上の子機構の収納', () => {
  it('全開の巨大な子を補正せず、収納時だけ親面へ寝かせて縮める', () => {
    expect(evaluateSurfaceStow({ ...input, open: 1 }).matrix.elements).toEqual(new Matrix4().elements)
    const result = evaluateSurfaceStow({ ...input, open: .1 })
    const folded = bounds.clone().applyMatrix4(result.matrix)
    expect(folded.min.x).toBeGreaterThanOrEqual(-1.000001)
    expect(folded.max.x).toBeLessThanOrEqual(1.000001)
    expect(folded.min.z).toBeGreaterThanOrEqual(-1.500001)
    expect(folded.max.z).toBeLessThanOrEqual(1.500001)
    expect(folded.getSize(new Vector3()).y).toBeLessThan(1e-8)
    expect(result.scale).toBeGreaterThan(0)
  })

  it('全区間で親面アンカーを固定し、子の接続を一様な距離比で保つ', () => {
    const a = new Vector3(0, 1, -.5), b = new Vector3(0, 3, .8)
    for (let i = 0; i <= 100; i++) {
      const result = evaluateSurfaceStow({ ...input, open: i / 100 })
      expect(new Vector3().applyMatrix4(result.matrix).length()).toBe(0)
      expect(a.clone().applyMatrix4(result.matrix).distanceTo(b.clone().applyMatrix4(result.matrix))).toBeCloseTo(a.distanceTo(b) * result.scale, 9)
      expect(result.matrix.elements.every(Number.isFinite)).toBe(true)
    }
  })

  it('円形の親面の角を矩形として扱わず、輪郭内へ収める', () => {
    const surfacePoints = Array.from({ length: 24 }, (_, i) => new Vector3(Math.cos(i / 24 * Math.PI * 2), 0, Math.sin(i / 24 * Math.PI * 2)))
    const result = evaluateSurfaceStow({ ...input, open: .1, surfacePoints })
    const folded = bounds.clone().applyMatrix4(result.matrix)
    for (const x of [folded.min.x, folded.max.x]) for (const z of [folded.min.z, folded.max.z]) {
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(1.000001)
    }
  })

  it('実ページが近づいてもアンカーを動かさず紙の内側へ収める', () => {
    const anchorMatrix = new Matrix4().makeTranslation(0, .2, 0)
    const result = evaluateSurfaceStow({ ...input, open: .2, pageFrame: { anchorMatrix, leftAngle: Math.PI * .6, rightAngle: Math.PI * .4 } })
    const matrix = anchorMatrix.clone().multiply(result.matrix)
    for (const y of [0, 4]) for (const z of [-2, 2]) {
      const p = new Vector3(0, y, z).applyMatrix4(matrix)
      expect(Math.sin(Math.PI * .6) * p.x - Math.cos(Math.PI * .6) * p.y).toBeGreaterThanOrEqual(-1e-8)
      expect(-Math.sin(Math.PI * .4) * p.x + Math.cos(Math.PI * .4) * p.y).toBeGreaterThanOrEqual(-1e-8)
    }
  })

  it('参照状態を持たず逆順でも一致し、収納開始で姿勢を飛ばさない', () => {
    const phases = [0, .1, .3, .6, .9, 1]
    const at = (open: number) => evaluateSurfaceStow({ ...input, open }).matrix.elements
    expect(phases.map(at)).toEqual([...phases].reverse().map(at).reverse())
    const a = new Vector3(0, 4, 2).applyMatrix4(evaluateSurfaceStow({ ...input, open: 1 - 1e-7 }).matrix)
    expect(a.distanceTo(new Vector3(0, 4, 2))).toBeLessThan(1e-5)
  })
})
