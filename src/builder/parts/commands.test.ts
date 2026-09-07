import { beforeEach, describe, expect, it } from 'vitest'
import { createBookProject } from '../../schema/bookDefaults'
import type { PartElement } from '../../schema/stageElement'
import { newPartDefinition, type PartBinding, type PartNode } from '../../parts/schema'
import { snapshotPartBundle } from '../../parts/package'
import { evaluateBookParts, validateBookParts } from '../../parts/book'
import { faceCorners } from '../../parts/geometry'
import { spreadCameraBounds } from '../../runtime/camera/bounds'
import { useBuilderStore } from '../store'
import { usePartEditorStore } from './store'
import { placePartCommand, updatePlacedPartCommand } from './commands'
import { addTimelineKeyCommand, moveElementCommand } from '../operations/commands'

const gutter: PartBinding = { type: 'output', nodeId: '$book', portId: 'gutter' }
const node = (builtin = 'backdrop'): PartNode => ({ id: 'body', name: '本体', definition: { builtin, version: 1 }, mount: { type: 'input' }, parameters: {}, materials: {} })
const spread = () => useBuilderStore.getState().project.book.spreads[0]
const elements = () => spread().elements as PartElement[]
function placed(builtin: string, mount: PartBinding, parameters = {}) {
  const result = placePartCommand({ spreadId: spread().id, name: builtin, definition: { builtin, version: 1 }, mount, parameters })
  expect(result.ok, result.message).toBe(true)
  return result.ok ? result.target!.id : ''
}
beforeEach(() => { useBuilderStore.getState().setProject(createBookProject('020検証'), 'import'); useBuilderStore.getState().setMode('edit'); usePartEditorStore.setState({ library: [] }) })
describe('基本・カスタム部品の共通編集', () => {
  it('接続と実開口角を検査してから一操作で追加し、undoで戻す', () => {
    const background = placed('backdrop', gutter)
    const before = useBuilderStore.getState().project, history = useBuilderStore.getState().undoStack.length
    const invalid = placePartCommand({ spreadId: spread().id, name: '自立禁止', definition: { builtin: 'upright', version: 1 }, mount: gutter })
    expect(invalid.ok).toBe(false)
    expect(useBuilderStore.getState().project).toBe(before)
    const child = placed('upright', { type: 'output', nodeId: background, portId: 'ground-backdrop' }, { width: 1, height: 1, supportHeight: .5 })
    expect(useBuilderStore.getState().undoStack).toHaveLength(history + 1)
    expect(elements().find((element) => element.id === child)?.parent).toEqual({ type: 'element', elementId: background })
    expect(validateBookParts(useBuilderStore.getState().project)).toEqual([])
    useBuilderStore.getState().undo(); expect(elements()).toHaveLength(1)
    useBuilderStore.getState().redo(); expect(elements()).toHaveLength(2)
  })
  it('二面それぞれの参照を複製し、第二の面を削除しても従属部品を残さない', () => {
    const a = placed('flat', { type: 'output', nodeId: '$book', portId: 'right-page' }, { width: 2, height: 2, v: 1 })
    const b = placed('flat', { type: 'output', nodeId: '$book', portId: 'left-page' }, { width: 2, height: 2, v: 1 })
    const mount: PartBinding = { type: 'pair', a: { nodeId: a, portId: 'face' }, b: { nodeId: b, portId: 'face' },
      hingeA: [[0, 0], [2, 0]], hingeB: [[0, 0], [2, 0]], directionA: 'positive', directionB: 'positive', foldSign: 1 }
    const child = placed('v-fold', mount, { width: 1, height: .5, distance: .5 })
    useBuilderStore.getState().duplicateSpread(spread().id)
    const copy = useBuilderStore.getState().project.book.spreads[1], copyChild = copy.elements.find((element) => element.name === 'v-fold') as PartElement
    expect(copyChild.part.mount.type).toBe('pair')
    if (copyChild.part.mount.type === 'pair') {
      expect(copyChild.part.mount.a.nodeId).not.toBe(a); expect(copyChild.part.mount.b.nodeId).not.toBe(b)
    }
    expect(validateBookParts(useBuilderStore.getState().project)).toEqual([])
    useBuilderStore.getState().removeElement(spread().id, b)
    expect(elements().some((element) => element.id === child)).toBe(false)
    expect(elements().some((element) => element.id === a)).toBe(true)
    useBuilderStore.getState().undo(); expect(elements()).toHaveLength(3)
  })
  it('埋め込んだ改訂はライブラリ更新で変わらず、明示した新版だけを適用する', async () => {
    const definition = newPartDefinition('家'), body = node()
    definition.nodes = [body]
    const first = await snapshotPartBundle({ definition, definitions: {}, assets: [] })
    usePartEditorStore.setState({ library: [{ hash: first.hash, bundle: first, savedAt: '2026-09-07' }] })
    const result = placePartCommand({ spreadId: spread().id, name: '家', definition: { custom: first.hash }, mount: gutter })
    expect(result.ok).toBe(true)
    definition.revision = 2; body.materials.panel = { color: '#00aa99' }
    const second = await snapshotPartBundle({ definition, definitions: {}, assets: [] })
    usePartEditorStore.setState({ library: [{ hash: second.hash, bundle: second, savedAt: '2026-09-07' }] })
    expect(elements()[0].part.definition).toEqual({ custom: first.hash })
    const updated = updatePlacedPartCommand({ spreadId: spread().id, elementId: elements()[0].id, changes: { definition: { custom: second.hash } } })
    expect(updated.ok).toBe(true)
    expect(elements()[0].part.definition).toEqual({ custom: second.hash })
    useBuilderStore.getState().undo(); expect(elements()[0].part.definition).toEqual({ custom: first.hash })
  })
  it('新部品をカメラ境界に含め、姿勢トラックと従来の親変更を拒否する', () => {
    const id = placed('backdrop', gutter, { height: 5, distance: 1, width: 3 })
    const project = useBuilderStore.getState().project, bounds = spreadCameraBounds(project.book, spread(), project.partDefinitions)
    const faces = evaluateBookParts(project, spread(), Math.PI, 0).faces
    expect(faces.flatMap(faceCorners).every((point) => bounds.containsPoint(point))).toBe(true)
    expect(bounds.max.y).toBeGreaterThan(4.9)
    expect(moveElementCommand(spread().id, id, { type: 'left-page' }).ok).toBe(false)
    expect(addTimelineKeyCommand({ spreadId: spread().id, target: { type: 'element', elementId: id }, property: 'position.y', time: 0, value: 2 }).ok).toBe(false)
    expect(addTimelineKeyCommand({ spreadId: spread().id, target: { type: 'element', elementId: id }, property: 'opacity', time: 0, value: .5 }).ok).toBe(true)
  })
  it('150度対応の部品は180度の本の谷へ置けず、90度の背景接続口へ置ける', async () => {
    const definition = newPartDefinition('150度の箱', { kind: 'fold-pair', maxOpeningAngleDeg: 150 })
    definition.nodes = [node('folding-box')]
    const snapshot = await snapshotPartBundle({ definition, definitions: {}, assets: [] })
    usePartEditorStore.setState({ library: [{ hash: snapshot.hash, bundle: snapshot, savedAt: '2026-09-07' }] })
    const before = useBuilderStore.getState().project
    const invalid = placePartCommand({ spreadId: spread().id, name: '150度の箱', definition: { custom: snapshot.hash }, mount: gutter })
    expect(invalid.ok).toBe(false)
    expect(invalid.message).toContain('exceeds 150')
    expect(useBuilderStore.getState().project).toBe(before)
    const background = placed('backdrop', gutter, { width: 4, height: 3, distance: 1 })
    const valid = placePartCommand({ spreadId: spread().id, name: '150度の箱', definition: { custom: snapshot.hash },
      mount: { type: 'output', nodeId: background, portId: 'ground-backdrop' } })
    expect(valid.ok, valid.message).toBe(true)
  })
})
