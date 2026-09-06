import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createBook, createSpread, createStageElement } from '../../schema/bookDefaults'
import { makeMechanism, type MechanismKind } from '../../schema/mechanism'
import type { AssemblyElement, StageElement, VisualElement } from '../../schema/stageElement'
import { evaluateAssemblyScene } from './scene'
import { auditAssemblies } from './audit'

const full = { open: 1, leftAngle: Math.PI, rightAngle: 0, spreadTime: 0, clock: 0 }
function assembly(kind: MechanismKind, id: string, parent?: AssemblyElement): AssemblyElement {
  const e = createStageElement('assembly', parent ? { type: 'element', elementId: parent.id } : { type: 'right-page' }) as AssemblyElement
  e.id = id; e.name = id; e.baseTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
  e.mechanism = makeMechanism(kind, { mount: parent ? { type: 'bridge', elementId: parent.id, bridgeId: 'deck', v: .5 } : { type: 'gutter' }, parameters: { width: 4, height: 1, depth: 3 } })
  return e
}
function fixture(elements: StageElement[]) { const spread = createSpread('複合接続', { elements }); return { spread, book: createBook({ spreads: [spread] }) } }

describe('実ページからつながる複合機構の監査', () => {
  it.each<MechanismKind>(['panel', 'v-fold', 'beak', 'platform', 'box', 'accordion', 'curved-shell'])('箱のbridgeに接続した%sは紙を貫通せず接着を保つ', (kind) => {
    const root = assembly('box', 'root'), child = assembly(kind, 'child', root)
    child.mechanism.parameters = { ...child.mechanism.parameters, width: 2, height: .7, depth: 1.5 }
    const { book, spread } = fixture([root, child])
    const report = auditAssemblies(book, spread)
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    const closed = evaluateAssemblyScene(book, spread, { ...full, open: 0, rightAngle: Math.PI })
    expect(closed.surfaces).toEqual([])
    expect(closed.connections).toHaveLength(12)
  })

  it('三段曲面と明示拡大を基部・親deckの接続鎖で維持する', () => {
    const lower = assembly('curved-shell', 'lower')
    lower.mechanism = makeMechanism('curved-shell', { parameters: { width: 6, depth: 5, height: .8 }, deployment: { mode: 'virtual' }, staging: { openScale: 2 } })
    const middle = assembly('curved-shell', 'middle', lower)
    middle.mechanism.parameters = { ...middle.mechanism.parameters, width: 6, depth: 4.8, height: .65 }
    const upper = assembly('curved-shell', 'upper', middle)
    upper.mechanism.parameters = { ...upper.mechanism.parameters, width: 3, depth: 2.4, height: .6 }
    const { book, spread } = fixture([lower, middle, upper])
    const report = auditAssemblies(book, spread)
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    for (const open of [.05, .3, .5, .8, 1]) {
      const scene = evaluateAssemblyScene(book, spread, { ...full, open, rightAngle: (1 - open) * Math.PI })
      expect(scene.connections).toHaveLength(18)
      expect(new Set(scene.surfaces.map((s) => s.rootId))).toEqual(new Set(['lower']))
    }
  })

  it('面上の起立人物は根元を動かさず、実紙が許すヒンジ角まで寝る', () => {
    const root = assembly('box', 'root')
    root.mechanism.parameters = { ...root.mechanism.parameters, width: 6, depth: 4, height: .4 }
    const person = createStageElement('visual', { type: 'element', elementId: root.id }) as VisualElement
    person.id = 'person'; person.width = 1.4; person.height = 2
    person.baseTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    person.surfaceAttachment = { surfaceId: 'top-left', u: .5, v: .6, offset: .01 }
    const { book, spread } = fixture([root, person])
    const report = auditAssemblies(book, spread)
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    for (const opening of [true, false]) for (let i = 1; i <= 100; i++) {
      const open = i / 100, leftAngle = opening ? Math.PI * open : Math.PI, rightAngle = opening ? 0 : (1 - open) * Math.PI
      const scene = evaluateAssemblyScene(book, spread, { ...full, open, leftAngle, rightAngle })
      if (!scene.visuals.length) continue
      const matrix = scene.visuals[0].matrix
      new Vector3().setFromMatrixScale(matrix).toArray().forEach((value) => expect(value).toBeCloseTo(1, 10))
      const surface = scene.structuralSurfaces.find((entry) => entry.elementId === root.id && entry.surface.id === 'top-left')!.surface
      const p = (index: number) => new Vector3(...surface.positions.slice(index * 3, index * 3 + 3) as [number, number, number])
      const target = p(0).multiplyScalar(.5 * .4).addScaledVector(p(1), .5 * .4).addScaledVector(p(2), .5 * .6).addScaledVector(p(3), .5 * .6)
      const normal = new Vector3().crossVectors(p(3).sub(p(0)), p(1).sub(p(0))).normalize()
      target.addScaledVector(normal, .01)
      expect(new Vector3().setFromMatrixPosition(matrix).distanceTo(target)).toBeLessThan(1e-9)
    }
  })

  it('通常groupの子孫も同じ固定ヒンジと不透明度を引き継ぐ', () => {
    const root = assembly('platform', 'root')
    const group = createStageElement('group', { type: 'element', elementId: root.id }); group.opacity = .4
    group.baseTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    group.surfaceAttachment = { surfaceId: 'top', u: .25, v: .6, offset: .01 }
    const person = createStageElement('visual', { type: 'element', elementId: group.id }) as VisualElement; person.width = .7; person.height = 1
    person.baseTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    const { book, spread } = fixture([root, group, person])
    expect(auditAssemblies(book, spread).issues.filter((issue) => issue.severity === 'error')).toEqual([])
    const scene = evaluateAssemblyScene(book, spread, full)
    expect(scene.visuals[0].opacity).toBeCloseTo(.4)
    expect(scene.visuals[0].rootId).toBe(root.id)
    expect(evaluateAssemblyScene(book, spread, { ...full, open: 0, rightAngle: Math.PI }).visuals).toEqual([])
  })

  it.each<[MechanismKind, string]>([['box', 'wall-left'], ['v-fold', 'wing-left'], ['accordion', 'fold-0'], ['curved-shell', 'shell-0']])(
    '%sの%s上のパネルは親全幅ではなく実際の面U長からヒンジ幅を決める', (kind, surfaceId) => {
      const root = assembly(kind, 'root'), child = assembly('panel', 'child', root)
      child.mechanism = makeMechanism('panel', { mount: { type: 'surface', elementId: root.id, surfaceId, u: .5, v: .5, offset: 0 }, parameters: { width: .2, height: .2, depth: .2 } })
      const { book, spread } = fixture([root, child]), scene = evaluateAssemblyScene(book, spread, full)
      expect(scene.issues.filter((issue) => issue.severity === 'error')).toEqual([])
      const panel = scene.structuralSurfaces.find((entry) => entry.elementId === child.id && entry.surface.id === 'panel')!.surface
      const point = (id: string) => { const i = panel.vertexIds.indexOf(id); return new Vector3(...panel.positions.slice(i * 3, i * 3 + 3) as [number, number, number]) }
      expect(point('hinge-left').distanceTo(point('hinge-right'))).toBeCloseTo(.2, 9)
    })
})
