import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { createBook, createSpread, createStageElement } from '../../schema/bookDefaults'
import { makeMechanism, type MechanismKind } from '../../schema/mechanism'
import type { AssemblyElement } from '../../schema/stageElement'
import { evaluateAssemblyScene, type AssemblyScene } from './scene'

export function assembly(kind: MechanismKind, id: string, parent?: AssemblyElement): AssemblyElement {
  const e = createStageElement('assembly', parent ? { type: 'element', elementId: parent.id } : { type: 'right-page' }) as AssemblyElement
  e.id = id; e.name = id; e.baseTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
  e.mechanism = makeMechanism(kind, { mount: parent ? { type: 'bridge', elementId: parent.id, bridgeId: 'deck', v: .5 } : { type: 'gutter' } })
  return e
}
export function point(scene: AssemblyScene, elementId: string, surfaceId: string, vertexId: string) {
  const entry = scene.structuralSurfaces.find((s) => s.elementId === elementId && s.surface.id === surfaceId)!
  const i = entry.surface.vertexIds.indexOf(vertexId)
  expect(i).toBeGreaterThanOrEqual(0)
  return new Vector3(...entry.surface.positions.slice(i * 3, i * 3 + 3) as [number, number, number]).applyMatrix4(entry.matrix)
}
export function assertConnections(scene: AssemblyScene, leftAngle: number, rightAngle: number) {
  for (const connection of scene.connections) {
    const a = connection.actual, expected = connection.expected
    const actual = point(scene, a.elementId, a.surfaceId, a.vertexId), target = new Vector3()
    if (expected.type === 'page') {
      const angle = expected.side === 'left' ? leftAngle : rightAngle
      target.set(expected.distance * Math.cos(angle), expected.distance * Math.sin(angle), expected.z)
    } else for (const w of expected.weights) target.addScaledVector(point(scene, expected.elementId, expected.surfaceId, w.vertexId), w.weight)
    expect(actual.distanceTo(target)).toBeLessThan(1e-8)
  }
}

export const full = { open: 1, leftAngle: Math.PI, rightAngle: 0, spreadTime: 0, clock: 0 }
describe('実接続を保持する最終描画座標', () => {
  it.each(['box', 'v-fold'] as const)('箱の天板を切り出した小さい%sは親の二面へ全区間で接続する', (kind) => {
    const root = assembly('box', 'root'); root.mechanism.parameters = { ...root.mechanism.parameters, width: 6, height: 1, depth: 4 }
    const child = assembly(kind, 'child', root); child.mechanism.parameters = { ...child.mechanism.parameters, width: 3, height: .7, depth: 2 }
    const spread = createSpread('接続', { elements: [root, child] }), book = createBook({ spreads: [spread] })
    for (const opening of [true, false]) for (let i = 0; i <= 100; i++) {
      const open = i / 100, leftAngle = opening ? open * Math.PI : Math.PI, rightAngle = opening ? 0 : (1 - open) * Math.PI
      const scene = evaluateAssemblyScene(book, spread, { ...full, open, leftAngle, rightAngle })
      expect(scene.issues.filter((x) => x.severity === 'error')).toEqual([])
      expect(scene.connections).toHaveLength(12)
      assertConnections(scene, leftAngle, rightAngle)
      for (const entry of scene.structuralSurfaces) expect(entry.matrix.elements).toEqual(new Matrix4().elements)
      const lb = point(scene, 'root', 'top-left', 'top-leftBack'), cb = point(scene, 'root', 'top-left', 'top-creaseBack')
      const lf = point(scene, 'root', 'top-left', 'top-leftFront'), cf = point(scene, 'root', 'top-left', 'top-creaseFront')
      const expected = lb.lerp(cb, .5).lerp(lf.lerp(cf, .5), .25)
      expect(point(scene, 'child', 'mount-left', 'anchor-leftBack').distanceTo(expected)).toBeLessThan(1e-8)
    }
  })

  it('演出未指定のvirtualも実紙へ接続し、勝手な全体拡縮や退避をしない', () => {
    const physical = assembly('box', 'root'), virtual = structuredClone(physical)
    virtual.mechanism.deployment.mode = 'virtual'
    const build = (root: AssemblyElement) => { const spread = createSpread('比較', { elements: [root] }); return { spread, book: createBook({ spreads: [spread] }) } }
    const p = build(physical), v = build(virtual)
    for (const open of [.025, .2, .5, .8, 1]) {
      const input = { ...full, open, rightAngle: (1 - open) * Math.PI }
      const a = evaluateAssemblyScene(p.book, p.spread, input), b = evaluateAssemblyScene(v.book, v.spread, input)
      expect(a.structuralSurfaces.map((s) => s.surface)).toEqual(b.structuralSurfaces.map((s) => s.surface))
      assertConnections(b, input.leftAngle, input.rightAngle)
    }
  })

  it('支持を非表示にしても接続線を保持し、巨大演出は基部から支持面でつながる', () => {
    const root = assembly('box', 'root')
    root.mechanism = makeMechanism('box', { parameters: { width: 6, height: 1, depth: 2 }, deployment: { mode: 'virtual' }, staging: { openScale: 3 } })
    root.mechanism.surfaces['mount-left'] = { color: '#fff', visible: false }
    const spread = createSpread('巨大', { elements: [root] }), book = createBook({ spreads: [spread] })
    const scene = evaluateAssemblyScene(book, spread, full)
    expect(scene.surfaces.some((s) => s.surface.id === 'mount-left')).toBe(false)
    expect(scene.structuralSurfaces.some((s) => s.surface.id === 'mount-left')).toBe(true)
    assertConnections(scene, Math.PI, 0)
    expect(point(scene, 'root', 'base-right', 'base-rightBack').x).toBe(9)
    expect(point(scene, 'root', 'mount-right', 'anchor-rightBack').x).toBe(3)
  })
})
