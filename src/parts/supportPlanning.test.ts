import { describe, expect, it } from 'vitest'
import { createBookProject, createStageElement } from '../schema/bookDefaults'
import type { PartElement } from '../schema/stageElement'
import { evaluateBookParts, validateBookParts } from './book'
import { pointOnFace } from './geometry'
import { planPartPlacement } from './placement'
import { planSupportedPart, replanAutomaticSupports } from './supportPlanning'
import { applyBookEditPlan, bookEditScene } from './bookEdit'
import { planPartEdit } from './edit'
import { partInstanceSchema } from './schema'
import { nearestContentSurface, clearFictionSupportCrossings } from './contentPlacement'
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
