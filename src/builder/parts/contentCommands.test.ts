import { beforeEach, describe, expect, it } from 'vitest'
import { createBookProject } from '../../schema/bookDefaults'
import { validateBookParts } from '../../parts/book'
import { placePartCommand, editPlacedPartCommand } from './commands'
import { editConnectedContentCommand, newConnectedContent, placeContentCommand } from './contentCommands'
import { useBuilderStore } from '../store'
import { useContentEditStore } from './contentEditState'
import { addTimelineKeyCommand, updateTimelineKeyCommand } from '../operations/commands'

beforeEach(() => { useBuilderStore.getState().setProject(createBookProject('022編集'), 'import'); useBuilderStore.getState().setMode('edit'); useContentEditStore.getState().cancel() })
function fixture() {
  const spreadId = useBuilderStore.getState().project.book.spreads[0].id
  const result = placePartCommand({ spreadId, name: '台紙', definition: { builtin: 'flat', version: 1 }, mount: { type: 'output', nodeId: '$book', portId: 'right-page' }, parameters: { width: 3, height: 3, v: 3 } })
  if (!result.ok) throw new Error(result.message)
  const parent = result.target!.id, element = newConnectedContent('fiction', { type: 'surface', surface: { nodeId: parent, portId: 'face' }, point: [1.5, 1.5], side: 'front' })
  if (element.type === 'visual') { element.width = element.height = .4; element.motion = [{ type: 'spin', axis: 'z', speed: .8 }] }
  const added = placeContentCommand({ spreadId, element }); expect(added.ok, added.message).toBe(true)
  return { spreadId, parent, id: element.id }
}
describe('紙に接続する演出の編集', () => {
  it('基準点のドラッグはキーを書き換えず、確定だけを一回でUndoする', () => {
    const { spreadId, id } = fixture()
    expect(addTimelineKeyCommand({ spreadId, target: { type: 'element', elementId: id }, property: 'position.x', time: 0, value: .1 }).ok).toBe(true)
    const source = useBuilderStore.getState().project, track = source.book.spreads[0].timeline.tracks, undo = useBuilderStore.getState().undoStack.length
    useContentEditStore.getState().begin(spreadId, id)
    for (const x of [1.6, 1.7, 1.8]) useContentEditStore.getState().preview({ type: 'anchor', point: [x, 1.5] })
    expect(useBuilderStore.getState().project).toBe(source)
    useContentEditStore.getState().finish()
    expect(useBuilderStore.getState().project.book.spreads[0].timeline.tracks).toEqual(track)
    expect(useBuilderStore.getState().undoStack).toHaveLength(undo + 1)
    useBuilderStore.getState().undo(); expect(useBuilderStore.getState().project).toEqual(source)
  })
  it('参照点を失う親の縮小と、紙を貫くキーを成功扱いにしない', () => {
    const { spreadId, parent, id } = fixture(), source = useBuilderStore.getState().project
    expect(editPlacedPartCommand({ spreadId, elementId: parent, intent: { type: 'scale', value: .2 } }).ok).toBe(false)
    expect(useBuilderStore.getState().project).toBe(source)
    expect(editConnectedContentCommand({ spreadId, elementId: id, intent: { type: 'anchor', point: [4, 4] } }).ok).toBe(false)
    expect(addTimelineKeyCommand({ spreadId, target: { type: 'element', elementId: id }, property: 'rotation.x', time: 0, value: 0 }).ok).toBe(true)
    const spread = useBuilderStore.getState().project.book.spreads[0], track = spread.timeline.tracks.at(-1)!
    const before = useBuilderStore.getState().project
    expect(updateTimelineKeyCommand({ spreadId, trackId: track.id, keyId: track.keys[0].id, value: 90 }).ok).toBe(false)
    expect(useBuilderStore.getState().project).toBe(before)
  })
  it('複製で面参照を書き換え、親削除とUndoに演出とキーも含める', () => {
    const { spreadId, parent, id } = fixture()
    addTimelineKeyCommand({ spreadId, target: { type: 'element', elementId: id }, property: 'opacity', time: 0, value: .8 })
    useBuilderStore.getState().duplicateSpread(spreadId)
    const copy = useBuilderStore.getState().project.book.spreads[1], child = copy.elements.find((e) => e.attachment)!
    expect(child.attachment?.type === 'surface' && child.attachment.surface.nodeId).not.toBe(parent)
    expect(validateBookParts(useBuilderStore.getState().project)).toEqual([])
    const before = useBuilderStore.getState().project
    useBuilderStore.getState().removeElement(spreadId, parent)
    const first = useBuilderStore.getState().project.book.spreads[0]
    expect(first.elements).toHaveLength(0); expect(first.timeline.tracks).toHaveLength(0)
    useBuilderStore.getState().undo(); expect(useBuilderStore.getState().project).toEqual(before)
  })
  it('キャンセルと選択変更ではプレビューを保存しない', () => {
    const { spreadId, id } = fixture(), before = useBuilderStore.getState().project
    useContentEditStore.getState().begin(spreadId, id); useContentEditStore.getState().preview({ type: 'scale', value: [1.2, 1.2, 1.2] })
    useContentEditStore.getState().cancel(); useContentEditStore.getState().finish()
    expect(useBuilderStore.getState().project).toBe(before)
    useContentEditStore.getState().begin(spreadId, id)
    useBuilderStore.getState().select({ type: 'spread', spreadId })
    expect(useContentEditStore.getState().session).toBeNull()
  })
})
