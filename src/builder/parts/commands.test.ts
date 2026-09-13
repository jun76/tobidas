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
import { createPartDraftCommand, addPartNodeCommand, exposePartEditHandleCommand, editPartNodeCommand, editPlacedPartCommand, placePartCommand, placePartOnSurfacesCommand, updatePlacedPartCommand } from './commands'
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
  it('補完した支持紙に貼った子を、役割の同じ面へ追従させる', () => {
    const background = placed('backdrop', gutter, { width: 1, height: 2 })
    const result = placePartOnSurfacesCommand({ spreadId: spread().id, name: '張り出す看板', definition: { builtin: 'upright', version: 1 },
      first: { surface: { nodeId: '$book', portId: 'right-page' }, point: [5.2, 2] }, second: { surface: { nodeId: background, portId: 'panel' }, point: [.5, 1] } })
    expect(result.ok, result.message).toBe(true)
    if (!result.ok) return
    const parent = result.target!.id
    const face = evaluateBookParts(useBuilderStore.getState().project, spread(), Math.PI, 0).nodes[parent].faces.find((face) => face.id.includes('/mount/b/'))!
    expect(face).toBeDefined()
    const portId = `face:${face.id.slice(parent.length + 1)}`
    const child = placed('flat', { type: 'output', nodeId: parent, portId }, { width: .05, height: .05, v: face.height / 2 })
    const moved = editPlacedPartCommand({ spreadId: spread().id, elementId: parent, intent: { type: 'translate', delta: [.1, 0] } })
    expect(moved.ok, moved.message).toBe(true)
    const mount = elements().find((e) => e.id === child)!.part.mount
    expect(mount.type === 'output' && mount.portId).toBe(portId)
    expect(validateBookParts(useBuilderStore.getState().project)).toEqual([])
  })
  it('内部の公開角度を編集しても結び付けを保ち、一回のUndoで戻す', () => {
    createPartDraftCommand({ name: '角度付き小物', input: { kind: 'fold-pair', maxOpeningAngleDeg: 90 } })
    const result = addPartNodeCommand({ ...node('upright'), parameters: { width: 1, height: 1, distance: 1, supportHeight: .6 } })
    expect(result.ok).toBe(true)
    expect(exposePartEditHandleCommand({ name: 'lean', label: '傾き', nodeId: 'body', operation: 'tiltAngle' }).ok).toBe(true)
    const before = usePartEditorStore.getState().bundle
    const changed = editPartNodeCommand({ nodeId: 'body', intent: { type: 'rotate', handle: 'tiltAngle', value: 75 } })
    expect(changed.ok, changed.message).toBe(true)
    const bundle = usePartEditorStore.getState().bundle
    expect(bundle.definition.nodes[0].parameters.tiltAngle).toEqual({ parameter: 'lean' })
    expect(bundle.definition.parameters.lean.default).toBeCloseTo(75)
    usePartEditorStore.getState().undoEdit()
    expect(usePartEditorStore.getState().bundle).toEqual(before)
  })
  it('寸法フォームによる親の更新でも下流の再接続を一緒に保存する', () => {
    const parent = placed('flat', { type: 'output', nodeId: '$book', portId: 'right-page' }, { width: 2, height: 2, v: 3 })
    const child = placed('flat', { type: 'output', nodeId: parent, portId: 'face' }, { width: .4, height: .3, u: .4, v: 1.3 })
    const before = useBuilderStore.getState().project
    const changed = updatePlacedPartCommand({ spreadId: spread().id, elementId: parent, changes: { parameters: { width: 3 } } })
    expect(changed.ok, changed.message).toBe(true)
    const attached = elements().find((element) => element.id === child)!
    expect(attached.part.mount.type === 'output' && attached.part.mount.frame).toBeDefined()
    expect(validateBookParts(useBuilderStore.getState().project)).toEqual([])
    useBuilderStore.getState().undo(); expect(useBuilderStore.getState().project).toEqual(before)
  })
  it('クリック配置の不適合では変更せず、自動支持紙を含む一操作をundoとredoできる', () => {
    const background = placed('backdrop', gutter, { width: 1, height: 2 })
    const before = useBuilderStore.getState().project, history = useBuilderStore.getState().undoStack.length
    const input = { spreadId: spread().id, name: '横へ張り出す看板', definition: { builtin: 'upright', version: 1 },
      first: { surface: { nodeId: '$book', portId: 'right-page' }, point: [5.2, 2] as [number, number] } }
    expect(placePartOnSurfacesCommand({ ...input, second: input.first }).ok).toBe(false)
    expect(useBuilderStore.getState().project).toBe(before)
    expect(useBuilderStore.getState().undoStack).toHaveLength(history)
    const added = placePartOnSurfacesCommand({ ...input, second: { surface: { nodeId: background, portId: 'panel' }, point: [.5, 1] } })
    expect(added.ok, added.message).toBe(true)
    const instance = elements()[1].part
    expect(instance.mount.type === 'pair' && instance.mount.extensions?.b?.panels?.length).toBeGreaterThan(0)
    expect(useBuilderStore.getState().undoStack).toHaveLength(history + 1)
    useBuilderStore.getState().undo(); expect(useBuilderStore.getState().project).toEqual(before)
    useBuilderStore.getState().redo(); expect(elements()[1].part).toEqual(instance)
    expect(validateBookParts(useBuilderStore.getState().project)).toEqual([])
  })
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
