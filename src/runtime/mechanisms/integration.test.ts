import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createBook, createSpread, createStageElement } from '../../schema/bookDefaults'
import { makeMechanism, type MechanismKind } from '../../schema/mechanism'
import type { AssemblyElement, StageElement, VisualElement } from '../../schema/stageElement'
import { auditAssemblies } from './audit'
import { evaluateAssemblyScene } from './scene'

const full = { open: 1, leftAngle: Math.PI, rightAngle: 0, spreadTime: 0, clock: 0 }

function assembly(kind: MechanismKind, id: string, parent?: AssemblyElement, surfaceId = 'top'): AssemblyElement {
  const element = createStageElement('assembly', parent ? { type: 'element', elementId: parent.id } : { type: 'right-page' }) as AssemblyElement
  element.id = id; element.name = id
  element.mechanism = makeMechanism(kind, parent ? { mount: { type: 'surface', elementId: parent.id, surfaceId, u: .5, v: .5, offset: .01 } } : {})
  return element
}

function visual(id: string, parent: StageElement, surfaceId?: string): VisualElement {
  const element = createStageElement('visual', { type: 'element', elementId: parent.id }) as VisualElement
  element.id = id; element.name = id; element.width = .9; element.height = 1.5
  element.baseTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
  if (surfaceId) element.surfaceAttachment = { surfaceId, u: .5, v: .5, offset: .01 }
  return element
}

function fixture(elements: StageElement[]) {
  const spread = createSpread('機構の複合検証', { elements })
  return { spread, book: createBook({ spreads: [spread] }) }
}

describe('新機構の複合配置と収納の結合検証', () => {
  it('実ページの箱に人物と屋根を載せ、両方向のページ送りで収納する', () => {
    const root = assembly('box', 'real-box')
    root.mechanism = makeMechanism('box', { parameters: { width: 4, height: 1.5, depth: 3 }, deployment: { mode: 'page-constrained' } })
    const person = visual('person', root, 'top-left')
    const roof = assembly('v-fold', 'roof', root, 'top-right')
    roof.mechanism.parameters = { ...roof.mechanism.parameters, width: 2, height: 1, depth: 2 }
    const { book, spread } = fixture([root, person, roof])
    const violations: Array<{ open: number; minimumDistance: number }> = []
    for (let i = 1; i <= 40; i++) {
      const open = i / 40, rightAngle = Math.PI * (1 - open)
      const scene = evaluateAssemblyScene(book, spread, { ...full, open, rightAngle })
      let minimumDistance = 0
      for (const entry of scene.surfaces.filter((entry) => entry.elementId === roof.id)) {
        for (let vertex = 0; vertex < entry.surface.positions.length; vertex += 3) {
          const p = new Vector3(...entry.surface.positions.slice(vertex, vertex + 3) as [number, number, number]).applyMatrix4(entry.matrix)
          minimumDistance = Math.min(minimumDistance, p.y, -Math.sin(rightAngle) * p.x + Math.cos(rightAngle) * p.y)
        }
      }
      if (minimumDistance < -1e-4) violations.push({ open, minimumDistance: Math.round(minimumDistance * 1e4) / 1e4 })
    }
    expect(violations).toEqual([])
    const report = auditAssemblies(book, spread)
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(report.surfaces).toBe(10)
    const scene = evaluateAssemblyScene(book, spread, full)
    expect(new Vector3().setFromMatrixPosition(scene.visuals[0].matrix).y).toBeCloseTo(1.51)
  })

  it('浮遊する曲面三段と全装飾を一つの収納グループへまとめる', () => {
    const bottom = assembly('curved-shell', 'bottom')
    bottom.baseTransform.position = [8, 2, -4]
    bottom.mechanism.parameters = { ...bottom.mechanism.parameters, width: 12, height: 3, depth: 9 }
    bottom.mechanism.staging.floatAmplitude = [.5, .8, .3]
    const middle = assembly('curved-shell', 'middle', bottom)
    middle.mechanism.parameters = { ...middle.mechanism.parameters, width: 8, height: 2, depth: 6 }
    const upper = assembly('curved-shell', 'upper', middle)
    upper.mechanism.parameters = { ...upper.mechanism.parameters, width: 5, height: 2, depth: 4 }
    const topper = visual('topper', upper, 'top')
    const { book, spread } = fixture([bottom, middle, upper, topper])
    expect(auditAssemblies(book, spread).issues.filter((issue) => issue.severity === 'error')).toEqual([])
    for (const clock of [0, 1.37, 3.1, 8.8]) for (const open of [.035, .075, .17, .38, .61, .84, .975, 1]) {
      const leftAngle = Math.PI * open, rightAngle = 0
      const scene = evaluateAssemblyScene(book, spread, { ...full, open, leftAngle, rightAngle, clock })
      expect([...scene.surfaces, ...scene.visuals].every((entry) => entry.rootId === bottom.id)).toBe(true)
      for (const entry of scene.surfaces) for (let i = 0; i < entry.surface.positions.length; i += 3) {
        const p = new Vector3(...entry.surface.positions.slice(i, i + 3) as [number, number, number]).applyMatrix4(entry.matrix)
        expect(p.x * Math.sin(leftAngle) - p.y * Math.cos(leftAngle)).toBeGreaterThanOrEqual(-1e-5)
        expect(p.y).toBeGreaterThanOrEqual(-1e-5)
      }
    }
  })

  it('面へ載せた通常groupの孫まで、接続と不透明度と収納を継承する', () => {
    const platform = assembly('platform', 'platform')
    const group = createStageElement('group', { type: 'element', elementId: platform.id })
    group.id = 'group'; group.opacity = .6
    group.baseTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    group.surfaceAttachment = { surfaceId: 'top', u: .5, v: .5, offset: .01 }
    const subgroup = createStageElement('group', { type: 'element', elementId: group.id })
    subgroup.id = 'subgroup'; subgroup.opacity = .5
    subgroup.baseTransform = { position: [.2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    const person = visual('group-person', subgroup)
    const { book, spread } = fixture([platform, group, subgroup, person])
    const scene = evaluateAssemblyScene(book, spread, full)
    expect(scene.visuals).toHaveLength(1)
    expect(scene.visuals[0].opacity).toBeCloseTo(.3)
    expect(scene.visuals[0].rootId).toBe(platform.id)
    expect(new Vector3().setFromMatrixPosition(scene.visuals[0].matrix).x).toBeCloseTo(.2)
    expect(auditAssemblies(book, spread).issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(evaluateAssemblyScene(book, spread, { ...full, open: 0, rightAngle: Math.PI }).visuals).toEqual([])
  })

  it('実ページ箱の面へ載せた巨大な通常groupも、子孫をまとめて収納する', () => {
    const root = assembly('box', 'real-box')
    root.mechanism = makeMechanism('box', { deployment: { mode: 'page-constrained' } })
    const group = createStageElement('group', { type: 'element', elementId: root.id })
    group.id = 'crowd'; group.baseTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    group.surfaceAttachment = { surfaceId: 'top-left', u: .5, v: .5, offset: .01 }
    const person = visual('giant', group)
    person.width = 20; person.height = 30
    const { book, spread } = fixture([root, group, person])
    expect(auditAssemblies(book, spread).issues.filter((issue) => issue.severity === 'error')).toEqual([])
    const scene = evaluateAssemblyScene(book, spread, full)
    expect(new Vector3().setFromMatrixScale(scene.visuals[0].matrix).toArray()).toEqual([1, 1, 1])
  })

  it.each<MechanismKind>(['panel', 'v-fold', 'beak', 'platform', 'box', 'accordion', 'curved-shell'])(
    '実ページ箱の上の%sは、向きを変えても収納時の紙面接続を守る', (kind) => {
      for (const yaw of [0, 90]) {
        const root = assembly('box', 'real-box')
        root.mechanism = makeMechanism('box', { deployment: { mode: 'page-constrained' } })
        const child = assembly(kind, 'attachment', root, 'top-right')
        child.baseTransform.rotation[1] = yaw
        const { book, spread } = fixture([root, child])
        expect(auditAssemblies(book, spread).issues.filter((issue) => issue.severity === 'error')).toEqual([])
      }
    })
})
