import { beforeEach, describe, expect, it } from 'vitest'
import { createBookProject } from '../../schema/bookDefaults'
import { useBuilderStore } from '../store'
import { placePartCommand } from './commands'
import { usePartEditStore } from './editState'

beforeEach(() => { useBuilderStore.getState().setProject(createBookProject(), 'import'); useBuilderStore.getState().setMode('edit'); usePartEditStore.getState().cancel() })
function fixture() {
  const spreadId = useBuilderStore.getState().project.book.spreads[0].id
  const result = placePartCommand({ spreadId, name: '貼り紙', definition: { builtin: 'flat', version: 1 }, mount: { type: 'output', nodeId: '$book', portId: 'right-page' }, parameters: { width: 1, height: .5, v: 2 } })
  if (!result.ok) throw new Error(result.message)
  return { spreadId, id: result.target!.id }
}
describe('部品ギズモの編集セッション', () => {
  it('プレビューは保存状態を変えず、一回の確定を一回で取り消せる', () => {
    const { spreadId, id } = fixture(), before = useBuilderStore.getState().project, undo = useBuilderStore.getState().undoStack.length
    usePartEditStore.getState().begin(spreadId, id)
    for (const x of [.1, .3, .5]) usePartEditStore.getState().preview({ type: 'translate', delta: [x, .1] })
    expect(useBuilderStore.getState().project).toBe(before)
    expect(usePartEditStore.getState().session!.preview).not.toEqual(before)
    usePartEditStore.getState().finish()
    expect(useBuilderStore.getState().undoStack).toHaveLength(undo + 1)
    const after = useBuilderStore.getState().project
    useBuilderStore.getState().undo(); expect(useBuilderStore.getState().project).toEqual(before)
    useBuilderStore.getState().redo(); expect(useBuilderStore.getState().project).toEqual(after)
  })
  it('Esc相当の中止と外部更新はプレビューを捨てる', () => {
    const { spreadId, id } = fixture(), before = useBuilderStore.getState().project
    usePartEditStore.getState().begin(spreadId, id); usePartEditStore.getState().preview({ type: 'scale', value: 1.2 })
    usePartEditStore.getState().cancel(); usePartEditStore.getState().finish()
    expect(useBuilderStore.getState().project).toBe(before)
    usePartEditStore.getState().begin(spreadId, id); usePartEditStore.getState().preview({ type: 'scale', value: 1.4 })
    useBuilderStore.getState().undo()
    expect(usePartEditStore.getState().session).toBeNull()
    usePartEditStore.getState().finish()
    expect(useBuilderStore.getState().project.book.spreads[0].elements).toHaveLength(0)
  })
  it('不成立候補を放しても最後に全開閉の検査を通った値を使う', () => {
    const { spreadId, id } = fixture()
    usePartEditStore.getState().begin(spreadId, id); usePartEditStore.getState().preview({ type: 'scale', value: 1.1 })
    usePartEditStore.getState().preview({ type: 'scale', value: 100 })
    expect(usePartEditStore.getState().session!.error).not.toBe('')
    usePartEditStore.getState().finish()
    const element = useBuilderStore.getState().project.book.spreads[0].elements[0]
    expect(element.type === 'part' && element.part.uniformScale).toBe(1.1)
  })
})
