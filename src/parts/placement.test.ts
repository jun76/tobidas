import { describe, expect, it } from 'vitest'
import { createBookProject, createStageElement } from '../schema/bookDefaults'
import type { BookProject } from '../schema/bookPackage'
import type { PartElement } from '../schema/stageElement'
import { evaluateBookParts, validateBookParts } from './book'
import { createPaperMotionInspector, inspectPaper, syncDefinitionRequirements } from './validate'
import { faceContains, faceCorners } from './geometry'
import { planPartPlacement, type SurfacePick } from './placement'
import { newPartDefinition, partInstanceSchema, type PartInstance } from './schema'

const pick = (nodeId: string, portId: string, u: number, v: number): SurfacePick => ({ surface: { nodeId, portId }, point: [u, v] })
const builtin = (id: string) => ({ builtin: id, version: 1 })
function add(project: BookProject, id: string, instance: PartInstance) {
  project.book.spreads[0].elements.push({ ...createStageElement('part'), id, part: instance } as PartElement)
}
describe('本の上で面を選ぶ部品配置', () => {
  it('一面のクリック位置をテキストの中心にし、二面部品は左右どちらからでも接続する', () => {
    const project = createBookProject(), spread = project.book.spreads[0]
    const text = planPartPlacement(project, spread.id, builtin('text'), pick('$book', 'right-page', 4, 3))
    expect(text.ok, JSON.stringify(text)).toBe(true)
    if (text.ok) {
      add(project, 'text', text.instance)
      const face = evaluateBookParts(project, spread, Math.PI, 0).nodes.text.faces[0]
      const center = face.origin.clone().addScaledVector(face.u, face.width / 2).addScaledVector(face.v, face.height / 2)
      expect(center.x).toBeCloseTo(3); expect(center.y).toBeCloseTo(0); expect(center.z).toBeCloseTo(.8)
    }
    for (const sides of [['right-page', 'left-page'], ['left-page', 'right-page']]) {
      const result = planPartPlacement(project, spread.id, builtin('backdrop'), pick('$book', sides[0], 3.2, 1), pick('$book', sides[1], 3.2, 1))
      expect(result.ok, JSON.stringify(result)).toBe(true)
      if (result.ok) expect(result.bridgeCount).toBe(0)
    }
  })
  it('同じ面と駆動しない二面、部品の最大開口角を越える接続先を拒否する', () => {
    const project = createBookProject(), spread = project.book.spreads[0], a = pick('$book', 'right-page', 3.2, 1)
    expect(planPartPlacement(project, spread.id, builtin('backdrop'), a, a)).toMatchObject({ ok: false, reason: 'sameFace' })
    expect(planPartPlacement(project, spread.id, builtin('upright'), a, pick('$book', 'left-page', 3.2, 1))).toMatchObject({ ok: false, reason: 'angleLimit' })
    add(project, 'flat', { definition: builtin('flat'), mount: { type: 'output', nodeId: '$book', portId: 'right-page' }, parameters: {}, materials: {} })
    expect(planPartPlacement(project, spread.id, builtin('backdrop'), a, pick('flat', 'face', 1, .5))).toMatchObject({ ok: false, reason: 'noHinge' })
  })
  it('背景パネルは紙端を指定しても位置と寸法を保ち、収納だけを縮小で収める', () => {
    for (const sides of [['right-page', 'left-page'], ['left-page', 'right-page']]) {
      for (const [u, v] of [[.02, .02], [6.38, 7.98], [3.2, 7.5], [6.2, 4], [.2, 4], [3.2, 4]]) {
        const project = createBookProject(), spread = project.book.spreads[0]
        const result = planPartPlacement(project, spread.id, builtin('backdrop'), pick('$book', sides[0], u, v), pick('$book', sides[1], 5.8, 7))
        expect(result.ok, JSON.stringify({ sides, u, v, result })).toBe(true)
        if (!result.ok) continue
        expect(result.bridgeCount).toBe(0)
        add(project, 'background', result.instance)
        const geometry = evaluateBookParts(project, spread, Math.PI, 0)
        const face = geometry.nodes.background.ports.panel
        expect(face.kind === 'surface' && [face.face.width, face.face.height]).toEqual([2, 1.5])
        expect(validateBookParts(project)).toEqual([])
        expect(result.instance.parameters.distance).toBeCloseTo(Math.max(.05, v))
      }
    }
  })
  it('背景と地面に接続し、背景幅を越す位置には支持紙を自動補完する', () => {
    const project = createBookProject(), spread = project.book.spreads[0]
    add(project, 'background', { definition: builtin('backdrop'), mount: { type: 'output', nodeId: '$book', portId: 'gutter' }, parameters: { width: 1, height: 2 }, materials: {} })
    const result = planPartPlacement(project, spread.id, builtin('upright'), pick('$book', 'right-page', 5.2, 2), pick('background', 'panel', .5, 1))
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) return
    expect(result.bridgeCount).toBeGreaterThan(0)
    add(project, 'upright', result.instance)
    expect(validateBookParts(project)).toEqual([])
    const dimensions = new Map(evaluateBookParts(project, spread, Math.PI, 0).nodes.upright.faces.map((face) => [face.id, [face.width, face.height]]))
    const bridges = evaluateBookParts(project, spread, Math.PI, 0).nodes.upright.faces.filter((face) => face.id.includes('/mount/'))
    expect(bridges.every((face) => face.support && face.height < .2)).toBe(true)
    const inspectMotion = createPaperMotionInspector()
    for (const side of ['left', 'right']) for (const angle of [180, 0, 1, 45, 90, 135, 180]) {
      const geometry = evaluateBookParts(project, spread, side === 'left' ? angle * Math.PI / 180 : Math.PI, side === 'right' ? (180 - angle) * Math.PI / 180 : 0)
      expect(inspectMotion(geometry)).toEqual([])
      for (const face of geometry.nodes.upright.faces) expect([face.width, face.height]).toEqual(dimensions.get(face.id))
    }
    const saved = JSON.parse(JSON.stringify(project)) as BookProject
    expect(validateBookParts(saved)).toEqual([])
  })
  it('一面カスタム部品の相対配置を保ち、クリック位置へ配置して支持紙だけを作品側に保存する', () => {
    const project = createBookProject(), spread = project.book.spreads[0], hash = 'a'.repeat(64)
    const definition = newPartDefinition('二枚の札', { kind: 'surface' })
    definition.nodes = [-.6, .6].map((u, i) => ({ id: `label${i}`, name: '札', definition: builtin('flat'), mount: { type: 'input' },
      parameters: { width: .8, height: .4, u, v: 1 }, materials: {} }))
    syncDefinitionRequirements(definition)
    project.partDefinitions = { [hash]: definition }
    add(project, 'small', { definition: builtin('flat'), mount: { type: 'output', nodeId: '$book', portId: 'right-page' }, parameters: { width: .6, height: .6, v: 2 }, materials: {} })
    const original = JSON.stringify(definition)
    const result = planPartPlacement(project, spread.id, { custom: hash }, pick('small', 'face', .3, .3))
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) return
    expect(result.bridgeCount).toBe(2)
    expect(partInstanceSchema.parse(JSON.parse(JSON.stringify(result.instance)))).toEqual(result.instance)
    add(project, 'custom', result.instance)
    const geometry = evaluateBookParts(project, spread, Math.PI, 0)
    const customFaces = geometry.nodes.custom.faces.filter((face) => !face.support)
    for (const bridge of geometry.nodes.custom.faces.filter((face) => face.support)) {
      expect(faceCorners(bridge).every((point) => customFaces.some((face) => faceContains(face, point)))).toBe(true)
    }
    const centers = geometry.nodes.custom.faces.filter((face) => !face.support).map((face) => faceCorners(face).reduce((sum, p) => sum.add(p)).multiplyScalar(.25))
    expect(centers[0].distanceTo(centers[1])).toBeCloseTo(1.2)
    const center = centers[0].clone().add(centers[1]).multiplyScalar(.5)
    expect(center.x).toBeCloseTo(2); expect(center.z).toBeCloseTo(0)
    expect(validateBookParts(project)).toEqual([])
    expect(JSON.stringify(definition)).toBe(original)
  })
  it('実部品への貼付は支持紙で延長し、論理ページの紙端は配置を制限しない', () => {
    const project = createBookProject(), spread = project.book.spreads[0]
    add(project, 'flat', { definition: builtin('flat'), mount: { type: 'output', nodeId: '$book', portId: 'right-page' }, parameters: { width: .6, height: .6, v: 2 }, materials: {} })
    const result = planPartPlacement(project, spread.id, builtin('text'), pick('flat', 'face', .3, .3))
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (result.ok) expect(result.bridgeCount).toBe(2)
    expect(planPartPlacement(project, spread.id, builtin('text'), pick('$book', 'right-page', .01, 7.9))).toMatchObject({ ok: true, bridgeCount: 0 })
  })
  it('平積みとテキストを四隅に貼っても、支持紙が外周の縁としてはみ出さない', () => {
    for (const id of ['flat', 'text']) for (const [u, v] of [[.05, .05], [1.9, .05], [.05, 1.4], [1.9, 1.4]]) {
      const project = createBookProject(), spread = project.book.spreads[0]
      add(project, 'parent', { definition: builtin('flat'), mount: { type: 'output', nodeId: '$book', portId: 'right-page' },
        parameters: { width: 2, height: 1.5, v: 3 }, materials: {} })
      const plan = planPartPlacement(project, spread.id, builtin(id), pick('parent', 'face', u, v))
      expect(plan.ok, JSON.stringify(plan)).toBe(true)
      if (!plan.ok) continue
      expect(plan.bridgeCount).toBeGreaterThan(0)
      add(project, 'child', plan.instance)
      for (const angle of [0, 30, 90, 180]) {
        const graph = evaluateBookParts(project, spread, angle * Math.PI / 180, 0), child = graph.nodes.child
        const sheet = child.faces.find((face) => !face.support)!
        for (const bridge of child.faces.filter((face) => face.support)) {
          expect(faceCorners(bridge).every((point) => faceContains(sheet, point))).toBe(true)
        }
        expect(inspectPaper(graph)).toEqual([])
      }
      expect(validateBookParts(project)).toEqual([])
    }
  })
})
