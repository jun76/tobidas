import { describe, expect, it } from 'vitest'
import { makeMechanism, mechanismSchema, mechanismSurfaceIds, type MechanismKind } from '../../schema/mechanism'
import { evaluateMechanism, inspectMechanism, surfaceFrame, type MechanismSurfaceGeometry } from './evaluate'

const kinds: MechanismKind[] = ['panel', 'v-fold', 'beak', 'platform', 'box', 'accordion', 'curved-shell']
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((n, i) => n - b[i]))
const point = (surface: MechanismSurfaceGeometry, index: number) => surface.positions.slice(index * 3, index * 3 + 3)
const intrinsicDistances = (surface: MechanismSurfaceGeometry) => {
  const output: number[] = []
  for (let i = 0; i < surface.vertexIds.length; i++) {
    for (let j = i + 1; j < surface.vertexIds.length; j++) output.push(distance(point(surface, i), point(surface, j)))
  }
  return output
}

describe('機構の保存契約', () => {
  it('不成立な実駆動と実アンカーを動かす演出を拒否する', () => {
    expect(() => makeMechanism('box', { mount: { type: 'space' }, deployment: { mode: 'page-constrained' } })).toThrow()
    expect(() => makeMechanism('curved-shell', { deployment: { mode: 'page-constrained' } })).toThrow()
    expect(() => makeMechanism('box', { deployment: { mode: 'page-constrained' }, staging: { closedScale: .5 } })).toThrow()
    expect(() => makeMechanism('panel', { deployment: { mode: 'page-constrained' }, staging: { floatAmplitude: [0, 1, 0] } })).toThrow()
    expect(() => makeMechanism('box', { deployment: { start: .8, end: .5 } })).toThrow()
    expect(() => makeMechanism('box', { parameters: { width: Infinity } })).toThrow()
  })

  it('保存は寸法と指定だけを保持し、描画頂点を複製しない', () => {
    const spec = makeMechanism('box', { parameters: { width: 9 }, surfaces: { 'top-left': { color: '#ffffff', visible: true, image: 'roof' } } })
    expect(mechanismSchema.parse(JSON.parse(JSON.stringify(spec)))).toEqual(spec)
    expect(Object.keys(spec)).not.toContain('vertices')
    expect(spec.parameters.height).toBe(2)
  })
})

describe('連続した紙機構と安定した役割', () => {
  it.each(kinds)('%sは全開から収納まで有限な面と共有頂点を返す', (kind) => {
    const spec = makeMechanism(kind)
    for (let i = 0; i <= 100; i++) {
      const evaluated = evaluateMechanism(spec, { open: i / 100, clock: 4.2 })
      expect(evaluated.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      expect(evaluated.surfaces.map((s) => s.id).sort()).toEqual(mechanismSurfaceIds(spec).sort())
      expect(evaluated.surfaces.every((surface) => surface.positions.every(Number.isFinite))).toBe(true)
      if (i === 0) expect(evaluated.drawn).toBe(false)
      if (i === 100) expect(evaluated.rootTransform.scale).toBe(1)
    }
  })

  it.each(kinds)('%sの剛体面は対角線を含む全ての頂点間距離を保つ', (kind) => {
    const spec = makeMechanism(kind, { deployment: { start: 0, end: 1 } })
    const reference = evaluateMechanism(spec, { open: 1 })
    for (const surface of reference.surfaces.filter((s) => s.rigidity === 'rigid')) {
      const expected = intrinsicDistances(surface)
      for (let i = 0; i <= 20; i++) {
        const current = evaluateMechanism(spec, { open: i / 20 }).surfaces.find((s) => s.id === surface.id)!
        intrinsicDistances(current).forEach((d, n) => expect(d).toBeCloseTo(expected[n], 9))
      }
    }
  })

  it('箱の端面の変形を剛体として扱わず、支持を隠しても機構を維持する', () => {
    const spec = makeMechanism('box', { deployment: { mode: 'page-constrained' }, surfaces: { 'wall-left': { color: '#fff', visible: false } } })
    const result = evaluateMechanism(spec, { open: .45 })
    expect(result.surfaces.find((s) => s.id === 'front-left')!.rigidity).toBe('deformable')
    expect(result.diagnostics.map((d) => d.code)).toContain('deformable-endcaps')
    expect(result.surfaces.find((s) => s.id === 'wall-left')!.positions).toHaveLength(12)
    expect(result.anchors).toHaveLength(4)
  })

  it('曲面胴は上面との継ぎ目を保ち、側面の縦辺を寝かせながらレンズ形へ閉じる', () => {
    const spec = makeMechanism('curved-shell', { parameters: { width: 5, depth: 4, height: 3 }, deployment: { start: 0, end: 1 } })
    for (const open of [0, .15, .5, .85, 1]) {
      const result = evaluateMechanism(spec, { open })
      for (const shell of result.surfaces.filter((s) => s.id.startsWith('shell-'))) {
        expect(distance(point(shell, 0), point(shell, 3))).toBeCloseTo(3, 9)
      }
      const top = result.surfaces.find((s) => s.id === 'top')!
      expect(top.vertexIds).toContain('rim-0')
      if (open > 0 && open < 1) {
        expect(point(top, 0)[0]).toBeGreaterThan(0)
        expect(point(top, 0)[1]).toBeGreaterThan(0)
      }
    }
  })

  it('曲面画像は胴の一周へ連続し、面上取り付けには各面のUVを維持する', () => {
    const result = evaluateMechanism(makeMechanism('curved-shell'), { open: .5 })
    const shells = result.surfaces.filter((surface) => surface.id.startsWith('shell-'))
    expect(shells[0].textureUvs![0]).toBe(0)
    expect(shells[shells.length - 1].textureUvs![2]).toBe(1)
    for (let i = 0; i < shells.length; i++) {
      expect(shells[i].uvs).toEqual([0, 0, 1, 0, 1, 1, 0, 1])
      if (i + 1 < shells.length) expect(shells[i].textureUvs![2]).toBe(shells[i + 1].textureUvs![0])
      const frame = surfaceFrame(result, shells[i].id, .5, .5)!
      expect(frame.position.every(Number.isFinite)).toBe(true)
    }
  })
})

describe('実ページ、仮想支持面、面上取り付け', () => {
  it.each(['box', 'platform', 'v-fold'] as const)('%sは両方の紙の実角度からアンカーへ接続する', (kind) => {
    const spec = makeMechanism(kind, { parameters: { width: 4, depth: 3 }, deployment: { mode: 'page-constrained' } })
    for (let i = 0; i <= 100; i++) {
      const open = i / 100
      for (const phase of ['opening', 'closing'] as const) {
        const leftAngle = phase === 'opening' ? open * Math.PI : Math.PI
        const rightAngle = phase === 'opening' ? 0 : (1 - open) * Math.PI
        const result = evaluateMechanism(spec, { open, leftAngle, rightAngle })
        for (const anchor of result.anchors) {
          const angle = anchor.page === 'left' ? leftAngle : rightAngle
          expect(anchor.position[0]).toBeCloseTo(2 * Math.cos(angle), 9)
          expect(anchor.position[1]).toBeCloseTo(2 * Math.sin(angle), 9)
          expect(distance(anchor.position, anchor.target)).toBeLessThan(1e-9)
        }
        expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      }
    }
    const mismatch = evaluateMechanism(spec, { open: .8, leftAngle: Math.PI / 2, rightAngle: 0 })
    expect(mismatch.openFactor).toBe(.5)
  })

  it('実駆動と仮想駆動が同じ内部解法を共有する', () => {
    const real = makeMechanism('box', { deployment: { mode: 'page-constrained' } })
    const virtual = makeMechanism('box', { deployment: { start: 0, end: 1 }, staging: { closedScale: 1 } })
    for (const open of [0, .2, .5, .8, 1]) {
      const u = open * open * (3 - 2 * open)
      expect(evaluateMechanism(virtual, { open }).surfaces).toEqual(evaluateMechanism(real, { open: u }).surfaces)
    }
  })

  it('天板の子は面内位置を維持し、法線に沿って離れる', () => {
    const spec = makeMechanism('platform', { parameters: { width: 4, height: 3, depth: 2 }, deployment: { start: 0, end: 1 } })
    const open = evaluateMechanism(spec, { open: 1 })
    const frame = surfaceFrame(open, 'top', .75, .5, .2)!
    expect(frame.position[0]).toBeCloseTo(1)
    expect(frame.position[1]).toBeCloseTo(3.2)
    expect(frame.position[2]).toBeCloseTo(0)
    expect(frame.yAxis[1]).toBeCloseTo(1)
    const half = evaluateMechanism(spec, { open: .5 })
    const halfFrame = surfaceFrame(half, 'top', .75, .5)!
    const top = half.surfaces.find((s) => s.id === 'top')!
    expect(halfFrame.position[0]).toBeCloseTo((point(top, 1)[0] + point(top, 2)[0]) / 2)
    expect(halfFrame.position[1]).toBeCloseTo((point(top, 1)[1] + point(top, 2)[1]) / 2)
    expect(surfaceFrame(half, 'missing')).toBeUndefined()
  })

  it('変形と浮遊は明示した時計だけで決まり、ランダムアクセスで一致する', () => {
    const spec = makeMechanism('box', { staging: { closedScale: .1, closedPosition: [2, -3, 1], floatAmplitude: [.4, .8, .2] } })
    const at = (open: number) => evaluateMechanism(spec, { open, clock: 3.7 })
    const forward = [0, .15, .5, .8, 1].map(at)
    expect([1, .8, .5, .15, 0].map(at).reverse()).toEqual(forward)
    expect(at(0).rootTransform).toEqual({ position: [2, -3, 1], scale: .1 })
    expect(at(1).rootTransform.scale).toBe(1)
    expect(at(.5).rootTransform.scale).toBeGreaterThan(.1)
  })

  it('検査は実際に切れた継ぎ目とずれた接着点を検出する', () => {
    const result = evaluateMechanism(makeMechanism('box'), { open: .5 })
    result.surfaces[0].positions[0] += .2
    result.anchors[0].position = [42, 0, 0]
    const codes = inspectMechanism(result).map((d) => d.code)
    expect(codes).toContain('broken-seam')
    expect(codes).toContain('broken-anchor')
  })
})
