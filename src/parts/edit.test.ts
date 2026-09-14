import { describe, expect, it } from 'vitest'
import { createBookProject, createStageElement } from '../schema/bookDefaults'
import type { PartElement } from '../schema/stageElement'
import { bookEditScene, applyBookEditPlan } from './bookEdit'
import { describePartEdit, planPartEdit } from './edit'
import { evaluateBookParts, validateBookParts } from './book'
import { newPartDefinition, type PartInstance } from './schema'
import { Vector3 } from 'three'

const gutter = { type: 'output' as const, nodeId: '$book', portId: 'gutter' }
function projectWith(parts: Partial<PartInstance>[]) {
  const project = createBookProject()
  project.book.spreads[0].elements = parts.map((part, i) => ({ ...createStageElement('part'), id: `node${i}`,
    part: { definition: { builtin: 'flat', version: 1 }, mount: { type: 'output', nodeId: '$book', portId: 'right-page' },
      parameters: {}, materials: {}, ...part } })) as PartElement[]
  return project
}
function apply(project: ReturnType<typeof createBookProject>, id: string, intent: Parameters<typeof planPartEdit>[2]) {
  const spreadId = project.book.spreads[0].id, plan = planPartEdit(bookEditScene(project, spreadId), id, intent)
  expect(plan.ok, plan.ok ? '' : plan.detail).toBe(true)
  if (!plan.ok) throw new Error(plan.detail)
  const next = applyBookEditPlan(project, spreadId, plan)
  expect(validateBookParts(next)).toEqual([])
  return next
}
const center = (project: ReturnType<typeof createBookProject>, id = 'node0') => describePartEdit(bookEditScene(project, project.book.spreads[0].id), id).pivot
describe('接続を保つ部品の設計編集', () => {
  it('平積みの移動、回転、等比拡縮で素材と基準点を保つ', () => {
    const project = projectWith([{ parameters: { width: 1, height: .6, v: 2 }, materials: { '*': { color: '#ff0000' } } }])
    const p = center(project)
    const moved = apply(project, 'node0', { type: 'translate', delta: [1, .5] })
    expect(center(moved).distanceTo(p.clone().add(new Vector3(.5, 0, 1)))).toBeLessThan(1e-6)
    const rotated = apply(moved, 'node0', { type: 'rotate', handle: 'surface-angle', value: 35 })
    expect(center(rotated).distanceTo(center(moved))).toBeLessThan(1e-6)
    const scaled = apply(rotated, 'node0', { type: 'scale', value: 2 })
    expect(center(scaled).distanceTo(center(rotated))).toBeLessThan(1e-6)
    const face = evaluateBookParts(scaled, scaled.book.spreads[0], Math.PI, 0).faces[0]
    expect(face.width).toBeCloseTo(2); expect(face.height).toBeCloseTo(1.2)
    expect(face.material.color).toBe('#ff0000')
  })
  it('箱の拡縮は内部支持も相似にし、谷の基準点を保つ', () => {
    const project = projectWith([{ definition: { builtin: 'folding-box', version: 1 }, mount: gutter, parameters: { width: 1, height: 1, distance: .5, offset: .2 } }])
    const next = apply(project, 'node0', { type: 'scale', value: 2 })
    expect(center(next).distanceTo(center(project))).toBeLessThan(1e-6)
    for (const angle of [.1, .9, Math.PI]) {
      const a = evaluateBookParts(project, project.book.spreads[0], angle, 0).faces
      const b = evaluateBookParts(next, next.book.spreads[0], angle, 0).faces
      a.forEach((face, i) => { expect(b[i].width).toBeCloseTo(face.width * 2); expect(b[i].height).toBeCloseTo(face.height * 2) })
    }
  })
  it('縦置きは背景への接続を残して地面上を再配置する', () => {
    const project = projectWith([{ definition: { builtin: 'backdrop', version: 1 }, mount: gutter, parameters: { width: 3, height: 2, distance: .6 } },
      { definition: { builtin: 'upright', version: 1 }, mount: { type: 'output', nodeId: 'node0', portId: 'ground-backdrop' }, parameters: { width: .6, height: 1, supportHeight: .7, distance: .6 } }])
    const next = apply(project, 'node1', { type: 'translate', delta: [.4, .3] })
    expect(center(next, 'node1').distanceTo(center(project, 'node1'))).toBeCloseTo(.5)
    const node = (next.book.spreads[0].elements[1] as PartElement).part
    expect(node.mount.type === 'pair' && node.mount.b.nodeId).toBe('node0')
  })
  it('入れ子の定数寸法も拡縮し、定義を書き換えない', () => {
    const inner = newPartDefinition('貼り紙', { kind: 'surface' })
    inner.nodes = [{ id: 'paper', name: '紙', definition: { builtin: 'flat', version: 1 }, mount: { type: 'input' }, parameters: { width: 1, height: .5, v: 1 }, materials: {} }]
    const outer = newPartDefinition('複合', { kind: 'surface' })
    const innerHash = 'a'.repeat(64), outerHash = 'b'.repeat(64)
    outer.nodes = [{ id: 'nested', name: '内側', definition: { custom: innerHash }, mount: { type: 'input' }, parameters: {}, materials: {}, uniformScale: .5 }]
    const project = projectWith([{ definition: { custom: outerHash } }]); project.partDefinitions = { [innerHash]: inner, [outerHash]: outer }
    const next = apply(project, 'node0', { type: 'scale', value: 2 })
    const face = evaluateBookParts(next, next.book.spreads[0], Math.PI, 0).faces[0]
    expect(face.width).toBeCloseTo(1); expect(face.height).toBeCloseTo(.5)
    expect(next.partDefinitions).toEqual(project.partDefinitions)
  })
  it('紙面より大きい相似拡大を許可し、非対応軸は確定しない', () => {
    const project = projectWith([{ definition: { builtin: 'folding-box', version: 1 }, mount: gutter }])
    const scene = bookEditScene(project, project.book.spreads[0].id)
    expect(planPartEdit(scene, 'node0', { type: 'scale', value: 20 }).ok).toBe(true)
    expect(planPartEdit(scene, 'node0', { type: 'translate', delta: [0, 1] }).ok).toBe(false)
    expect((project.book.spreads[0].elements[0] as PartElement).part.uniformScale).toBeUndefined()
  })
  it('親屏風の角度変更後も後付けの子は二面へ接続し、寸法を保つ', () => {
    const project = projectWith([{ definition: { builtin: 'backdrop', version: 2 }, mount: gutter, parameters: { width: 8, height: 2, offset: -.5 } },
      { definition: { builtin: 'upright', version: 1 }, mount: { type: 'output', nodeId: 'node0', portId: 'ground-backdrop' }, parameters: { width: .6, height: 1, supportHeight: .5, distance: .7 } }])
    const changed = apply(project, 'node0', { type: 'rotate', handle: 'splayAngle', value: 130 })
    const next = apply(changed, 'node0', { type: 'scale', value: .8 })
    const result = evaluateBookParts(next, next.book.spreads[0], Math.PI, 0)
    expect(result.nodes.node1.faces.find((face) => face.id === 'node1/panel')!.width).toBeCloseTo(.6)
    expect((next.book.spreads[0].elements[1] as PartElement).part.mount.type).toBe('pair')
  })
  it('親の寸法を変えると貼り紙の材料点が追従し、子のサイズは変えない', () => {
    const project = projectWith([{ parameters: { width: 2, height: 2, v: 3 } },
      { mount: { type: 'output', nodeId: 'node0', portId: 'face' }, parameters: { width: .4, height: .3, u: .4, v: 1.3 } }])
    const next = apply(project, 'node0', { type: 'scale', value: 1.5 })
    const result = evaluateBookParts(next, next.book.spreads[0], Math.PI, 0)
    expect(result.nodes.node1.faces[0].width).toBeCloseTo(.4)
    expect(center(next, 'node1').distanceTo(center(next))).toBeCloseTo(.75)
  })
  it('接着と収納だけを満たしても親を貫通する傾きを拒否する', () => {
    const project = projectWith([{ definition: { builtin: 'backdrop', version: 1 }, mount: gutter, parameters: { width: 3, height: 2, distance: .6 } },
      { definition: { builtin: 'upright', version: 1 }, mount: { type: 'output', nodeId: 'node0', portId: 'ground-backdrop' }, parameters: { width: .6, height: 2, supportHeight: .2, distance: .3 } }])
    const plan = planPartEdit(bookEditScene(project, project.book.spreads[0].id), 'node1', { type: 'rotate', handle: 'tiltAngle', value: 120 })
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.detail).toContain('intersection')
  })
})
