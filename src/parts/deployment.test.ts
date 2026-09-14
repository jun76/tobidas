import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createBookProject, createStageElement } from '../schema/bookDefaults'
import type { PartElement } from '../schema/stageElement'
import { evaluateBookParts, deployBookParts, validateBookParts } from './book'
import { faceCorners, logicalPagePorts, pagePorts, pointOnFace, faceContains } from './geometry'
import { createPaperMotionInspector, inspectClosedLayout } from './validate'
import { planSupportedPart } from './supportPlanning'
import { bookEditScene, applyBookEditPlan } from './bookEdit'
import { planPartEdit } from './edit'
import { planPartPlacement } from './placement'
import { connectedContentSchema } from '../schema/content'
import { bindBookContents, contentAsStage, evaluateContents } from './contents'
import { rootPanelShape } from './rootUpright'

const standing = (id: string, width = 2, height = 2): PartElement => ({ ...createStageElement('part'), id, type: 'part', part: {
  definition: { builtin: 'upright', version: 1 }, mount: { type: 'output', nodeId: '$book', portId: 'gutter' },
  parameters: { width, height }, materials: {},
} })
const empty = () => { const project = createBookProject(); project.book.spreads[0].elements = []; return project }

describe('無限紙面の機構と収納時の相似縮小', () => {
  it('二つ折りの左右で同じ絵と材料輪郭を分担し、折り線を切る穴を隠さない', () => {
    const shape = { outer: [[0, 0], [1, 0], [.8, 1], [.2, 1]] as [number, number][], holes: [] }
    expect(rootPanelShape(shape, [.5, 1]).outer).toEqual([[0, 0], [1, 0], [.6000000000000001, 1], [0, 1]])
    expect(() => rootPanelShape({ ...shape, holes: [[[.4, .4], [.6, .4], [.6, .6], [.4, .6]]] }, [.5, 1])).toThrow('folding attachment')
    const project = empty(), spread = project.book.spreads[0], rear = standing('rear')
    rear.part.materials = { panel: { color: '#abcdef', text: 'one image' } }
    spread.elements.push(planSupportedPart(project, spread, rear, { position: [0, 0, -1] }))
    const panels = evaluateBookParts(project, spread, Math.PI, 0).faces.filter(face => !face.support)
    expect(panels.map(face => face.artworkSpan)).toEqual([[.5, 1], [0, .5]])
    expect(panels.every(face => face.material.text === 'one image')).toBe(true)
  })
  it('部品に貼られた内容とその演出の子も、収納縮小を一度だけ受け取る', () => {
    const project = empty(), spread = project.book.spreads[0]
    spread.elements.push(planSupportedPart(project, spread, standing('rear', 4, 10), { position: [4, 0, -10] }))
    for (const [id, type, attachment, presentation] of [
      ['print', 'visual', { type: 'surface', surface: { nodeId: 'rear', portId: 'panel' }, point: [2, 2], side: 'front' }, { kind: 'decal' }],
      ['group', 'group', { type: 'surface', surface: { nodeId: 'rear', portId: 'panel' }, point: [2, 4], side: 'front' }, { kind: 'fiction', closing: 'shrink-to-anchor' }],
      ['child', 'visual', { type: 'visual', elementId: 'group' }, { kind: 'fiction', closing: 'shrink-to-anchor' }],
    ] as const) spread.elements.push(contentAsStage(connectedContentSchema.parse({ ...createStageElement(type), id, type, attachment, presentation,
      width: 1, height: 1, billboard: false, motion: [], baseTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } })))
    const raw = evaluateBookParts(project, spread, Math.PI / 2, 0), drawn = deployBookParts(project, spread, raw, Math.PI / 2, 0)
    const context = { openingAngleDeg: 90, maxOpeningAngleDeg: 180, holdTime: 0, clock: () => 0 }
    const before = evaluateContents(bindBookContents(project, spread, raw, Math.PI / 2, 0), context)
    const after = evaluateContents(bindBookContents(project, spread, drawn, Math.PI / 2, 0), context)
    for (let i = 0; i < before.length; i++) {
      expect(after[i].unitScale).toBe(drawn.deploymentScale)
      expect(new Vector3().setFromMatrixScale(after[i].matrix).x / new Vector3().setFromMatrixScale(before[i].matrix).x).toBeCloseTo(drawn.deploymentScale!)
    }
  })
  it('論理ページだけが綴じ目の外側へ延び、実紙と親の切り抜きを広げない', () => {
    const logical = logicalPagePorts(8, 6.4, Math.PI, 0)['right-page']
    const finite = pagePorts(8, 6.4, Math.PI, 0)['right-page']
    if (logical.kind !== 'surface' || finite.kind !== 'surface') throw new Error('surface')
    expect(faceContains(logical.face, new Vector3(70, 0, -200))).toBe(true)
    expect(faceContains(logical.face, new Vector3(-1, 0, -200))).toBe(false)
    expect(faceContains(finite.face, new Vector3(70, 0, -200))).toBe(false)
  })
  it('遠方の巨大な紙も全開時の位置を変えず、子と支持を接続したまま両側へ収納する', () => {
    const project = empty(), spread = project.book.spreads[0]
    const root = planSupportedPart(project, spread, standing('far', 12, 18), { position: [0, 0, -12] })
    expect(root.part.definition).toEqual({ builtin: 'root-upright', version: 1 })
    spread.elements.push(root)
    const child = planSupportedPart(project, spread, standing('child'), { position: [2, 0, -8] })
    expect(child.part.mount.type).toBe('pair')
    spread.elements.push(child)
    const opened = evaluateBookParts(project, spread, Math.PI, 0)
    const panel = opened.nodes.far.ports.panel
    if (panel.kind !== 'surface') throw new Error('panel')
    expect(panel.face.height).toBe(18)
    expect(Math.max(...opened.nodes.far.faces.flatMap(faceCorners).map(p => p.x))).toBeCloseTo(6)
    expect(Math.min(...opened.nodes.far.faces.flatMap(faceCorners).map(p => p.x))).toBeCloseTo(-6)
    expect(pointOnFace(panel.face, 0, 0).toArray()).toEqual([0, 0, -12])
    expect(opened.nodes.far.rootSupport).toBe('independent')
    expect(deployBookParts(project, spread, opened, Math.PI, 0)).toBe(opened)
    for (const side of ['left', 'right']) {
      const inspect = createPaperMotionInspector()
      for (const angle of [180, 90, 15, 0, 15, 90, 180]) {
        const left = side === 'left' ? angle * Math.PI / 180 : Math.PI, right = side === 'right' ? (180 - angle) * Math.PI / 180 : 0
        const raw = evaluateBookParts(project, spread, left, right), input = logicalPagePorts(8, 6.4, left, right).gutter
        expect(inspect(raw, [input])).toEqual([])
        const drawn = deployBookParts(project, spread, raw, left, right)
        for (const edge of drawn.connections) expect(Math.max(...edge.actual.map((p, i) => p.distanceTo(edge.expected[i])))).toBeLessThan(1e-6)
        const again = deployBookParts(project, spread, evaluateBookParts(project, spread, left, right), left, right)
        expect(again.faces.flatMap(faceCorners)).toEqual(drawn.faces.flatMap(faceCorners))
        if (angle === 0) {
          expect(drawn.deploymentScale).toBeLessThan(1)
          expect(inspectClosedLayout(drawn, 8, 6.4, new Vector3(side === 'left' ? 1 : -1, 0, 0))).toEqual([])
        }
      }
    }
    expect(validateBookParts(project)).toEqual([])
  })
  it('最奥でも実ページ内なら左右へ接地し、全開まで寸法と接着を保つ', () => {
    for (const x of [0, 2, -2]) {
      const project = empty(), spread = project.book.spreads[0]
      spread.elements.push(planSupportedPart(project, spread, standing('rear'), { position: [x, 0, -1.5] }))
      const result = evaluateBookParts(project, spread, Math.PI, 0)
      const parents = result.connections.map(c => c.parentFace)
      expect(parents).toContain('$book/right'); expect(parents).toContain('$book/left')
      expect(validateBookParts(project)).toEqual([])
    }
  })
  it('背後が空なら側方の紙へ連結し、さらに手前では背後への支持を優先する', () => {
    const project = empty(), spread = project.book.spreads[0]
    spread.elements.push(planSupportedPart(project, spread, standing('rear'), { position: [1.5, 0, -10] }))
    const lateral = planSupportedPart(project, spread, standing('side', 1), { position: [4, 0, -10] })
    expect(lateral.part.definition).toEqual({ builtin: 'side-upright', version: 1 })
    spread.elements.push(lateral)
    const child = planSupportedPart(project, spread, standing('front', 1), { position: [1.5, 0, -8] })
    expect(child.part.definition).toEqual({ builtin: 'upright', version: 1 })
    spread.elements.push(child)
    expect(validateBookParts(project)).toEqual([])
  })
  it('標準配置で奥の紙面外を選べ、ギズモでさらに移動・拡大しても収納できる', () => {
    const project = empty(), spread = project.book.spreads[0]
    const placed = planPartPlacement(project, spread.id, { builtin: 'upright', version: 1 }, { surface: { nodeId: '$book', portId: 'right-page' }, point: [-10, 2] })
    expect(placed.ok, JSON.stringify(placed)).toBe(true)
    if (!placed.ok) return
    spread.elements.push({ ...standing('placed'), part: placed.instance })
    const move = planPartEdit(bookEditScene(project, spread.id), 'placed', { type: 'translate', delta: [-5, 2] })
    expect(move.ok, JSON.stringify(move)).toBe(true)
    if (!move.ok) return
    const moved = applyBookEditPlan(project, spread.id, move)
    const scale = planPartEdit(bookEditScene(moved, spread.id), 'placed', { type: 'scale', value: 8 })
    expect(scale.ok, JSON.stringify(scale)).toBe(true)
    if (scale.ok) expect(validateBookParts(applyBookEditPlan(moved, spread.id, scale))).toEqual([])
  })
})
