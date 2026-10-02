import { describe, expect, it } from 'vitest'
import { createBookProject, createStageElement } from '../schema/bookDefaults'
import type { PartElement } from '../schema/stageElement'
import { evaluateBookParts, validateBookParts } from './book'
import { pointOnFace } from './geometry'
import { planPartPlacement } from './placement'
import { planSupportedPart, rehomeDependentParts, replanAutomaticSupports } from './supportPlanning'
import { applyBookEditPlan, bookEditScene } from './bookEdit'
import { describePartEdit, planPartEdit } from './edit'
import { partInstanceSchema } from './schema'
import { nearestContentSurface, clearFictionSupportCrossings, floatingFictionIds } from './contentPlacement'
import { connectedContentSchema } from '../schema/content'
import { contentAsStage, bindBookContents, evaluateContents } from './contents'
import { inspectContentIntersections } from './contentValidation'
import { faceContains } from './geometry'

function fixture() {
  const project = createBookProject(), spread = project.book.spreads[0]
  spread.elements = [{ ...createStageElement('part'), id: 'scenery', type: 'part', part: {
    definition: { builtin: 'backdrop', version: 2 }, mount: { type: 'output', nodeId: '$book', portId: 'gutter' },
    parameters: { width: 12, height: 3, offset: -1.5, splayAngle: 170 }, materials: {},
  } }]
  const card = { ...createStageElement('part'), id: 'new-card', type: 'part' as const, part: {
    definition: { builtin: 'upright', version: 1 }, mount: { type: 'output' as const, nodeId: '$book', portId: 'gutter' },
    parameters: { width: 2, height: 1.5 }, materials: {},
  } }
  return { project, spread, card }
}

describe('配置時に設計する共通の支持紙', () => {
  it('面のクリックと自動の親選択で同じ支持紙になり、IDを変えても接着位置は変わらない', () => {
    const { project, spread, card } = fixture()
    const position: [number, number, number] = [2, 0, .6]
    const generated = planSupportedPart(project, spread, card, { position })
    const clicked = planPartPlacement(project, spread.id, card.part.definition,
      { surface: { nodeId: '$book', portId: 'right-page' }, point: [3.8, 2] },
      { surface: { nodeId: 'scenery', portId: 'panel' }, point: [2, 1] })
    expect(clicked.ok, JSON.stringify(clicked)).toBe(true)
    if (!clicked.ok) return
    for (const [key, value] of Object.entries(clicked.instance.parameters)) expect(value).toBeCloseTo(generated.part.parameters[key])
    expect(clicked.instance.mount).toEqual(generated.part.mount)
    expect(generated.part.parameters.supportHeight).toBe(.75)
    expect(generated.part.supportDesign).toBe('automatic')
    spread.elements[0].id = 'a-completely-different-id'
    expect(planSupportedPart(project, spread, { ...card, id: 'another-card' }, { position }).part.parameters).toEqual(generated.part.parameters)
  })

  it('高い部品は親の高さに収め、低い前景の実部品も親として利用する', () => {
    const { project, spread, card } = fixture()
    card.part.parameters.height = 1
    const parent = planSupportedPart(project, spread, { ...card, id: 'house' }, { position: [2, 0, -.1] })
    spread.elements.push(parent)
    card.part.parameters.height = 1.2
    const child = planSupportedPart(project, spread, card, { position: [2, 0, 1] })
    expect(child.part.mount.type === 'pair' && child.part.mount.b.nodeId).toBe('house')
    expect(child.part.parameters.supportHeight).toBe(.6)
    card.part.parameters.height = 2.2
    const tall = planSupportedPart(project, spread, card, { position: [2, 0, .6], surfaces: [{ nodeId: '$book', portId: 'right-page' }, { nodeId: 'house', portId: 'panel' }] })
    expect(tall.part.parameters.supportHeight).toBe(.97)
  })

  it('背後の紙の幅の外では、最奥の起立部品が成立しないときに延長した支持紙で立てる', () => {
    const { project, spread, card } = fixture()
    spread.elements[0].type === 'part' && Object.assign(spread.elements[0].part.parameters, { width: 6 })
    // 左右の縁の中ほどを切り欠き、綴じ目からの橋渡し紙を接着できない輪郭にする
    const notched = { ...card, part: { ...card.part, shapes: { panel: { outer: [[0, 0], [1, 0], [1, .3], [.8, .3], [.8, .7], [1, .7], [1, 1], [0, 1], [0, .7], [.2, .7], [.2, .3], [0, .3]] as [number, number][], holes: [] } } } }
    const planned = planSupportedPart(project, spread, notched, { position: [-5.5, 0, .6] })
    expect(planned.part.definition).toEqual({ builtin: 'upright', version: 1 })
    expect(planned.part.mount.type === 'pair' && planned.part.mount.b.nodeId).toBe('scenery')
    expect(validateBookParts({ ...project, book: { ...project.book, spreads: [{ ...spread, elements: [...spread.elements, planned] }] } })).toEqual([])
  })

  it('輪郭の穴を避け、再生中の収納で紙の寸法を変更しない', () => {
    const { project, spread, card } = fixture()
    const shaped: PartElement = { ...card, part: { ...card.part, shapes: { panel: {
      outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [[[.4, .35], [.4, .65], [.6, .65], [.6, .35]]],
    } } } }
    const result = planSupportedPart(project, spread, shaped, { position: [2, 0, .6] })
    expect(Math.abs(result.part.parameters.supportOffset)).toBeGreaterThan(.2)
    expect(result.part.parameters.supportHeight).toBe(.75)
    spread.elements.push(result)
    expect(validateBookParts(project)).toEqual([])
    const lengths = (angle: number) => evaluateBookParts(project, spread, angle, 0).nodes[result.id].faces.map(face => [face.width, face.height])
    expect(lengths(0)).toEqual(lengths(Math.PI))
    expect(partInstanceSchema.parse(JSON.parse(JSON.stringify(result.part)))).toEqual(JSON.parse(JSON.stringify(result.part)))
  })

  it('寸法変更後も足元と親を保ち、高さ50%で支持を再設計する', () => {
    const { project, spread, card } = fixture()
    const placed = planSupportedPart(project, spread, card, { position: [2, 0, .6] })
    spread.elements.push(placed)
    const edit = planPartEdit(bookEditScene(project, spread.id), card.id, { type: 'parameters', values: { height: 2 } })
    expect(edit.ok, JSON.stringify(edit)).toBe(true)
    if (!edit.ok) return
    const next = applyBookEditPlan(project, spread.id, edit), target = next.book.spreads[0]
    const actual = target.elements.find(e => e.id === card.id) as PartElement
    expect(actual.part.parameters.supportHeight).toBe(1)
    const panel = evaluateBookParts(next, target, Math.PI, 0).nodes[card.id].ports.panel
    expect(panel.kind === 'surface' && pointOnFace(panel.face, panel.face.width / 2, 0).z).toBeCloseTo(.6)
    replanAutomaticSupports(next, target)
    expect(validateBookParts(next)).toEqual([])
  })

  it('演出の基準点を切り抜きの縁から離し、小さな調整で穴へ落とさない', () => {
    const { project, spread, card } = fixture()
    const shaped: PartElement = { ...card, part: { ...card.part, shapes: { panel: {
      outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [[[.2, .2], [.2, .8], [.8, .8], [.8, .2]]],
    } } } }
    spread.elements.push(planSupportedPart(project, spread, shaped, { position: [2, 0, .6] }))
    const paper = evaluateBookParts(project, spread, Math.PI, 0), anchor = nearestContentSurface(paper, [2, .5, .6])!
    for (const shift of [-.002, 0, .002]) expect(faceContains(anchor.face, pointOnFace(anchor.face, anchor.point[0] + shift, anchor.point[1]))).toBe(true)
  })

  it('支持を貫く浮遊演出だけを配置時に移し、キーの変位と支持紙の寸法を保つ', () => {
    const { project, spread, card } = fixture()
    spread.elements.push(planSupportedPart(project, spread, card, { position: [2, 0, .6] }))
    const float = contentAsStage(connectedContentSchema.parse({ ...createStageElement('visual'), id: 'floating-decoration', width: 2, height: 2, pivot: [.5, 0],
      attachment: { type: 'surface', surface: { nodeId: 'scenery', portId: 'panel' }, point: [2, .01], side: 'front' },
      presentation: { kind: 'fiction', closing: 'shrink-to-anchor' }, baseTransform: { position: [0, .25, 1], rotation: [0, 0, 0], scale: [1, 1, 1] },
      motion: [{ type: 'sway', amplitude: 1, period: 5, phase: 0 }],
    }))
    spread.elements.push(float)
    const supports = evaluateBookParts(project, spread, Math.PI, 0).faces.filter(f => f.support)
    const before = supports.map(f => [f.width, f.height])
    const moved = clearFictionSupportCrossings(project, spread, new Set([float.id]))
    expect(moved).toEqual([float.id])
    expect(float.baseTransform.position[1]).toBeGreaterThan(.5)
    const paper = evaluateBookParts(project, spread, Math.PI, 0)
    const contents = evaluateContents(bindBookContents(project, spread, paper, Math.PI, 0), { openingAngleDeg: 180, maxOpeningAngleDeg: 180, holdTime: 1, clock: () => 1 })
    expect(inspectContentIntersections(contents, supports, true)).toEqual([])
    expect(paper.faces.filter(f => f.support).map(f => [f.width, f.height])).toEqual(before)
    float.baseTransform.position[1] = .015
    const grounded = structuredClone(float.baseTransform)
    expect(clearFictionSupportCrossings(project, spread, new Set([float.id]))).toEqual([])
    expect(float.baseTransform).toEqual(grounded)
  })
})

describe('動かした紙に当たる浮遊演出', () => {
  it('部品の移動を止めず、確定時に演出を紙の枠から押し出す', () => {
    const { project, spread, card } = fixture()
    spread.elements.push(planSupportedPart(project, spread, card, { position: [2, 0, .6] }))
    // 背景に貼った浮遊する花びら。カードの少し右で揺れている
    const petal = contentAsStage(connectedContentSchema.parse({ ...createStageElement('visual'), id: 'petal', width: .3, height: .3, pivot: [.5, .5],
      attachment: { type: 'surface', surface: { nodeId: 'scenery', portId: 'panel' }, point: [3.25, .01], side: 'front' },
      presentation: { kind: 'fiction', closing: 'shrink-to-anchor' }, baseTransform: { position: [0, .8, 2.35], rotation: [0, 0, 0], scale: [1, 1, 1] },
      motion: [{ type: 'drift', amplitude: [.1, .1, .1], period: 5, phase: 0 }],
    }))
    spread.elements.push(petal)
    expect(validateBookParts(project)).toEqual([])
    expect(floatingFictionIds(spread)).toEqual(new Set(['petal']))
    const scene = bookEditScene(project, spread.id)
    const plan = planPartEdit(scene, 'new-card', { type: 'translate', delta: [.6, 0] })
    expect(plan.ok, plan.ok ? '' : plan.detail).toBe(true)
    if (!plan.ok) return
    const next = applyBookEditPlan(project, spread.id, plan)
    const moved = next.book.spreads[0].elements.find((item) => item.id === 'petal')!
    expect(moved.baseTransform.position).not.toEqual(petal.baseTransform.position)
    expect(validateBookParts(next)).toEqual([])
  })
})

describe('接続先を失った起立の繋ぎ直し', () => {
  /** 奥に幅広の背景、その手前に幅の狭い背景。手前の背景へ起立を乗せる */
  function stacked() {
    const project = createBookProject(), spread = project.book.spreads[0]
    const root = (id: string, width: number, offset: number): PartElement => ({ ...createStageElement('part'), id, type: 'part', part: {
      definition: { builtin: 'root-upright', version: 1 }, mount: { type: 'output', nodeId: '$book', portId: 'gutter' },
      parameters: { width, height: 3, centerX: 2, offset }, materials: {} } })
    spread.elements = [root('far', 10, -5), root('near', 3, -3)]
    const card: PartElement = { ...createStageElement('part'), id: 'card', type: 'part', part: {
      definition: { builtin: 'upright', version: 1 }, mount: { type: 'output', nodeId: '$book', portId: 'gutter' },
      parameters: { width: 1.5, height: 1.2 }, materials: {} } }
    spread.elements.push(planSupportedPart(project, spread, card, { position: [2, 0, -2], surfaces: [{ nodeId: '$book', portId: 'right-page' }, { nodeId: 'near', portId: 'panel' }] }))
    expect(validateBookParts(project)).toEqual([])
    return { project, spread }
  }
  const parentOf = (spread: { elements: { id: string }[] }, id: string) => {
    const element = spread.elements.find((item) => item.id === id) as PartElement
    const mount = element.part.mount
    return mount.type === 'pair' ? mount.b.nodeId : mount.type === 'output' ? mount.nodeId : '$input'
  }

  it('乗っていた部品を外すと、その奥にある紙へ同じ足元のまま掛け替える', () => {
    const { project, spread } = stacked()
    const before = evaluateBookParts(project, spread, Math.PI, 0).nodes.card.ports.panel
    const after = rehomeDependentParts(project, spread, 'near')
    expect(after.elements.map((item) => item.id)).toEqual(['far', 'card'])
    expect(parentOf(after, 'card')).toBe('far')
    const panel = evaluateBookParts(project, after, Math.PI, 0).nodes.card.ports.panel
    if (before.kind !== 'surface' || panel.kind !== 'surface') throw new Error('panel missing')
    expect(pointOnFace(panel.face, panel.face.width / 2, 0).distanceTo(pointOnFace(before.face, before.face.width / 2, 0))).toBeLessThan(1e-6)
    expect(validateBookParts({ ...project, book: { ...project.book, spreads: [after] } })).toEqual([])
  })

  it('奥に紙が無ければ紙面へ孤立して立て、起立でない従属部品は残さない', () => {
    const { project, spread } = stacked()
    spread.elements = spread.elements.filter((item) => item.id !== 'far')
    const fold: PartElement = { ...createStageElement('part'), id: 'fold', type: 'part', part: {
      definition: { builtin: 'flat', version: 1 }, mount: { type: 'output', nodeId: 'near', portId: 'panel' }, parameters: { width: 1, height: 1, u: 1, v: 1 }, materials: {} } }
    spread.elements.push(fold)
    const after = rehomeDependentParts(project, spread, 'near')
    expect(after.elements.map((item) => item.id)).toEqual(['card'])
    const card = after.elements[0] as PartElement
    expect(card.part.definition).toEqual({ builtin: 'root-upright', version: 1 })
    expect(card.part.parameters.centerX).toBeCloseTo(2); expect(card.part.parameters.offset).toBeCloseTo(-2)
    expect(validateBookParts({ ...project, book: { ...project.book, spreads: [after] } })).toEqual([])
  })

  it('移動で今の接続先に届かなくなった起立は、移動先の奥にある紙へ乗り換える', () => {
    const { project, spread } = stacked()
    const foot = evaluateBookParts(project, spread, Math.PI, 0).nodes.card.ports.panel
    if (foot.kind !== 'surface') throw new Error('panel missing')
    const scene = bookEditScene(project, spread.id), input = describePartEdit(scene, 'card').input
    if (input.kind !== 'fold-pair') throw new Error('expected a two-surface mount')
    const plan = planPartEdit(scene, 'card', { type: 'translate', delta: [0, -1.5] })
    expect(plan.ok, plan.ok ? '' : plan.detail).toBe(true)
    if (!plan.ok) return
    const moved = plan.nodes.find((node) => node.id === 'card')!
    expect(moved.mount.type === 'pair' && moved.mount.b.nodeId).toBe('far')
    const next = applyBookEditPlan(project, spread.id, plan)
    expect(validateBookParts(next)).toEqual([])
    const panel = evaluateBookParts(next, next.book.spreads[0], Math.PI, 0).nodes.card.ports.panel
    if (panel.kind !== 'surface') throw new Error('panel missing')
    // 足元は元の折り線に沿って手前 (奥) へ 1.5 だけ動く
    const expected = pointOnFace(foot.face, foot.face.width / 2, 0).addScaledVector(input.rayA, -1.5)
    expect(pointOnFace(panel.face, panel.face.width / 2, 0).distanceTo(expected)).toBeLessThan(1e-6)
  })
})
