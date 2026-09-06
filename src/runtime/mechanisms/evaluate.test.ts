import { describe, expect, it } from 'vitest'
import { makeMechanism, mechanismSchema, mechanismSurfaceIds, type MechanismKind } from '../../schema/mechanism'
import { driverFromBridge, evaluateMechanism, surfaceFrame } from './evaluate'

const kinds: MechanismKind[] = ['panel', 'v-fold', 'beak', 'platform', 'box', 'accordion', 'curved-shell']
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((n, i) => n - b[i]))

describe('実接続から解く機構', () => {
  it('自由な空中rootと局所時期指定と複合部品の単面駆動を拒否する', () => {
    const base = makeMechanism('box')
    expect(mechanismSchema.safeParse({ ...base, mount: { type: 'space' } }).success).toBe(false)
    expect(mechanismSchema.safeParse({ ...base, deployment: { mode: 'virtual', start: .1, end: .9 } }).success).toBe(false)
    expect(() => makeMechanism('box', { mount: { type: 'surface', elementId: 'p', surfaceId: 'top', u: .5, v: .5, offset: 0 } })).toThrow()
    expect(() => makeMechanism('box', { staging: { openScale: 3 } })).toThrow()
  })

  it.each(kinds)('%sは実ページ上の6点を全区間で固定し有限な接続面を返す', (kind) => {
    const spec = makeMechanism(kind, { mount: { type: 'gutter' } })
    for (const opening of [true, false]) for (let i = 0; i <= 100; i++) {
      const open = i / 100, leftAngle = opening ? open * Math.PI : Math.PI, rightAngle = opening ? 0 : (1 - open) * Math.PI
      const result = evaluateMechanism(spec, { open, leftAngle, rightAngle })
      expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
      expect(result.surfaces.map((s) => s.id).sort()).toEqual(mechanismSurfaceIds(spec).sort())
      for (const anchor of result.anchors) {
        if (anchor.expected.type !== 'page') throw new Error('Expected a page attachment')
        const expected = anchor.expected, angle = expected.side === 'left' ? leftAngle : rightAngle
        expect(distance(anchor.position, [expected.distance * Math.cos(angle), expected.distance * Math.sin(angle), expected.z])).toBeLessThan(1e-9)
      }
      expect(result.rootTransform).toEqual({ position: [0, 0, 0], scale: 1 })
      if (!i) expect(result.drawn).toBe(false)
    }
  })

  it('箱の外壁と分割天板は剛体の距離を保つ', () => {
    const spec = makeMechanism('box')
    const full = evaluateMechanism(spec, { open: 1, leftAngle: Math.PI, rightAngle: 0 })
    for (const id of ['wall-left', 'wall-right', 'top-left', 'top-right']) {
      const reference = full.surfaces.find((s) => s.id === id)!
      for (const open of [0, .01, .15, .5, .85, 1]) {
        const current = evaluateMechanism(spec, { open, leftAngle: Math.PI, rightAngle: (1 - open) * Math.PI }).surfaces.find((s) => s.id === id)!
        for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) expect(distance(current.positions.slice(a * 3, a * 3 + 3), current.positions.slice(b * 3, b * 3 + 3))).toBeCloseTo(distance(reference.positions.slice(a * 3, a * 3 + 3), reference.positions.slice(b * 3, b * 3 + 3)), 9)
      }
    }
  })

  it('子の箱はglobal openではなく親の現在の二面形状で折れる', () => {
    const parent = evaluateMechanism(makeMechanism('box', { parameters: { width: 6, depth: 4, height: 1 } }), { open: .4, leftAngle: Math.PI, rightAngle: Math.PI * .6 })
    const spec = makeMechanism('box', { mount: { type: 'bridge', elementId: 'parent', bridgeId: 'deck', v: .5 }, parameters: { width: 3, depth: 2, height: .7 } })
    const driver = driverFromBridge(parent.bridges[0], spec, 'parent')
    const a = evaluateMechanism(spec, { open: 1, leftAngle: Math.PI, rightAngle: 0, driver })
    const b = evaluateMechanism(spec, { open: .2, leftAngle: Math.PI, rightAngle: .8 * Math.PI, driver })
    expect(a.surfaces).toEqual(b.surfaces)
    expect(a.openFactor).toBeCloseTo(.4, 9)
    expect(evaluateMechanism(spec, { open: 1 }).diagnostics[0].code).toBe('missing-driver')
  })

  it('親の小さい接着領域と大きいpayloadを明示的に分ける', () => {
    const spec = makeMechanism('box', { deployment: { mode: 'virtual' }, parameters: { width: 6, height: 1, depth: 2 }, staging: { openScale: 3 } })
    const result = evaluateMechanism(spec, { open: 1, leftAngle: Math.PI, rightAngle: 0 })
    expect(Math.max(...result.anchors.map((p) => p.position[0]))).toBe(3)
    const payload = result.surfaces.find((s) => s.id === 'base-right')!
    expect(Math.max(...payload.positions.filter((_, i) => i % 3 === 0))).toBe(9)
    const support = result.surfaces.find((s) => s.id === 'mount-right')!
    expect(support.vertexIds).toContain('anchor-rightBack')
    expect(support.vertexIds).toContain('base-rightBack')
  })

  it.each(['curved-shell', 'accordion'] as const)('%sの画像は複数面へ連続し、面上UVは局所のままにする', (kind) => {
    const result = evaluateMechanism(makeMechanism(kind), { open: .5 })
    const sides = result.surfaces.filter((s) => s.id.startsWith(kind === 'accordion' ? 'fold-' : 'shell-'))
    expect(sides[0].textureUvs![0]).toBe(0)
    expect(sides.at(-1)!.textureUvs![2]).toBe(1)
    for (let i = 0; i < sides.length; i++) {
      expect(sides[i].uvs).toEqual([0, 0, 1, 0, 1, 1, 0, 1])
      if (i) expect(sides[i - 1].textureUvs![2]).toBe(sides[i].textureUvs![0])
      expect(surfaceFrame(result, sides[i].id)!.position.every(Number.isFinite)).toBe(true)
    }
  })
})
