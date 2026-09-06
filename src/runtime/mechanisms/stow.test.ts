import { describe, expect, it } from 'vitest'
import { Box3, Matrix4, Vector3 } from 'three'
import { compileVirtualStow, evaluateVirtualStow, type VirtualStowPlan } from './stow'

function box(min: [number, number, number], max: [number, number, number]) {
  return new Box3(new Vector3(...min), new Vector3(...max))
}
function corners(bounds: Box3) {
  return [bounds.min.x, bounds.max.x].flatMap((x) => [bounds.min.y, bounds.max.y].flatMap((y) =>
    [bounds.min.z, bounds.max.z].map((z) => new Vector3(x, y, z))))
}
const options = { pageWidth: 8, pageAspect: 1.25 }
function evaluate(plan: VirtualStowPlan, bounds: Box3, open: number, phase: 'opening' | 'closing' = 'closing') {
  return evaluateVirtualStow(plan, { bounds, open,
    leftAngle: phase === 'opening' ? open * Math.PI : Math.PI,
    rightAngle: phase === 'opening' ? 0 : (1 - open) * Math.PI })
}

describe('自由な複合部品の解析的な収納', () => {
  it('巨大で偏った全開構図へ位置・寸法の補正を掛けない', () => {
    const bounds = box([20, 0, -40], [80, 70, 30])
    const plan = compileVirtualStow(bounds, options)
    const result = evaluate(plan, bounds, 1)
    expect(result.matrix.elements).toEqual(new Matrix4().elements)
    expect(result.scale).toBe(1)
    expect(result.bounds.equals(bounds)).toBe(true)
    expect(result.withinPage).toBe(false)
    expect(result.contained).toBe(true)
  })

  it.each([
    ['巨大な木', box([-35, 0, -8], [30, 65, 9])],
    ['右へ偏った舞台', box([20, .1, -20], [55, 30, 40])],
    ['左へ偏った鳥', box([-60, .2, 15], [-30, 45, 32])],
    ['小さな中央の箱', box([-1, 0, -.5], [1, 2, .5])],
  ] as const)('%sの全グループは開閉双方で実ページを貫通しない', (_name, bounds) => {
    const plan = compileVirtualStow(bounds, options)
    for (const phase of ['opening', 'closing'] as const) for (let step = 0; step <= 200; step++) {
      const open = step / 200, result = evaluate(plan, bounds, open, phase)
      const left = phase === 'opening' ? open * Math.PI : Math.PI
      const right = phase === 'opening' ? 0 : (1 - open) * Math.PI
      for (const p of corners(bounds).map((p) => p.applyMatrix4(result.matrix))) {
        // 左右の実ページから独立に内向き法線を作って判定する。
        expect(p.x * Math.sin(left) - p.y * Math.cos(left)).toBeGreaterThanOrEqual(-1e-7)
        expect(-p.x * Math.sin(right) + p.y * Math.cos(right)).toBeGreaterThanOrEqual(-1e-7)
        if (open <= plan.containedBelow) {
          expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(options.pageWidth + 1e-7)
          expect(Math.abs(p.z)).toBeLessThanOrEqual(options.pageWidth / options.pageAspect / 2 + 1e-7)
        }
      }
      expect(result.contained).toBe(true)
      if (open <= plan.containedBelow) expect(result.withinPage).toBe(true)
      expect(result.diagnostics).toEqual([])
    }
  })

  it('全子へ適用する一つの行列は距離比と接続を保つ', () => {
    const bounds = box([-15, 0, -8], [25, 18, 12]), plan = compileVirtualStow(bounds, options)
    const a = new Vector3(-12, 2, 3), b = new Vector3(20, 16, 8)
    for (const open of [.02, .15, .5, .8, 1]) {
      const result = evaluate(plan, bounds, open)
      const transformedA = a.clone().applyMatrix4(result.matrix), transformedB = b.clone().applyMatrix4(result.matrix)
      expect(transformedA.distanceTo(transformedB)).toBeCloseTo(a.distanceTo(b) * result.scale, 9)
      const childAnchor = a.clone().applyMatrix4(result.matrix)
      expect(transformedA.distanceTo(childAnchor)).toBe(0)
      const x = new Vector3(1, 0, 0).transformDirection(result.matrix)
      const y = new Vector3(0, 1, 0).transformDirection(result.matrix)
      expect(x.dot(y)).toBeCloseTo(0, 9)
    }
  })

  it('同じ入力の逆再生・ランダムアクセスは同じ収納経路を返す', () => {
    const bounds = box([-15, 0, -8], [25, 18, 12]), plan = compileVirtualStow(bounds, options)
    const frames = [0, .02, .15, .35, .55, .8, 1]
    const forward = frames.map((open) => evaluate(plan, bounds, open).matrix.elements)
    expect([...frames].reverse().map((open) => evaluate(plan, bounds, open).matrix.elements).reverse()).toEqual(forward)
    expect(evaluate(plan, bounds, .35).matrix.elements).toEqual(forward[3])
  })

  it('全開、有限領域への移行点、収納終端に位置の飛びを作らない', () => {
    const bounds = box([20, 0, -40], [80, 70, 30]), plan = compileVirtualStow(bounds, options)
    const epsilon = 1e-7
    for (const at of [0, .05, .55, .75, 1]) {
      const before = evaluate(plan, bounds, Math.max(0, at - epsilon))
      const after = evaluate(plan, bounds, Math.min(1, at + epsilon))
      for (const p of corners(bounds)) {
        expect(p.clone().applyMatrix4(before.matrix).distanceTo(p.clone().applyMatrix4(after.matrix))).toBeLessThan(.001)
      }
    }
  })

  it('子がせり上がって現在境界が全開境界を越えても有限領域を保証する', () => {
    const plan = compileVirtualStow(box([-2, 0, -1], [2, 3, 1]), options)
    const expanded = box([-20, -8, -15], [12, 40, 10])
    for (const open of [.05, .2, .55]) {
      const result = evaluate(plan, expanded, open)
      expect(result.contained).toBe(true)
      expect(result.withinPage).toBe(true)
    }
  })

  it('空境界と一点境界を有限な値で処理する', () => {
    for (const bounds of [new Box3(), box([0, 0, 0], [0, 0, 0])]) {
      const plan = compileVirtualStow(bounds, options)
      for (const open of [0, .5, 1]) {
        expect(evaluate(plan, bounds, open).matrix.elements.every(Number.isFinite)).toBe(true)
      }
    }
  })

  it('指定進行値と実ページ角がずれても実際の隙間へ収める', () => {
    const bounds = box([20, 0, -40], [80, 70, 30]), plan = compileVirtualStow(bounds, options)
    const tight = evaluateVirtualStow(plan, { bounds, open: .9, leftAngle: Math.PI / 8, rightAngle: 0 })
    expect(tight.contained).toBe(true)
    expect(tight.withinPage).toBe(true)
    const early = evaluateVirtualStow(plan, { bounds, open: .4, leftAngle: Math.PI, rightAngle: 0 })
    expect(early.contained).toBe(true)
    expect(early.withinPage).toBe(true)
  })

  it('全開で紙面下へはみ出す作者配置は隠さず診断する', () => {
    const bounds = box([-1, -2, -1], [1, 2, 1]), plan = compileVirtualStow(bounds, options)
    const result = evaluate(plan, bounds, 1)
    expect(result.matrix.elements).toEqual(new Matrix4().elements)
    expect(result.contained).toBe(false)
    expect(result.diagnostics).toContain('Open composition extends below the page wedge; raise the authored composition before playback')
  })

  it('無効な境界や紙寸法を黙って有限値へ置き換えない', () => {
    expect(() => compileVirtualStow(box([0, 0, 0], [1, 1, 1]), { ...options, pageWidth: 0 })).toThrow()
    expect(() => compileVirtualStow(box([0, 0, 0], [Infinity, 1, 1]), options)).toThrow()
  })
})
