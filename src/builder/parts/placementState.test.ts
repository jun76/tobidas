import { beforeEach, describe, expect, it } from 'vitest'
import { createBookProject } from '../../schema/bookDefaults'
import { useBuilderStore } from '../store'
import { useWorkspaceStore } from './store'
import { usePartPlacementStore } from './placementState'

const ref = { builtin: 'backdrop', version: 1 }
beforeEach(() => { useBuilderStore.getState().setProject(createBookProject(), 'import'); useBuilderStore.getState().setMode('edit'); usePartPlacementStore.getState().cancel() })
describe('接続面の選択セッション', () => {
  it('作品と履歴を変えずに面を選び、選び直しと中止ができる', () => {
    const before = useBuilderStore.getState().project, history = useBuilderStore.getState().undoStack
    usePartPlacementStore.getState().start(ref)
    expect(usePartPlacementStore.getState().tool?.faces).toBe(2)
    usePartPlacementStore.getState().chooseFirst({ surface: { nodeId: '$book', portId: 'right-page' }, point: [3, 1] })
    usePartPlacementStore.getState().back(); expect(usePartPlacementStore.getState().first).toBeNull()
    usePartPlacementStore.getState().start(ref); expect(usePartPlacementStore.getState().tool).toBeNull()
    expect(useBuilderStore.getState().project).toBe(before); expect(useBuilderStore.getState().undoStack).toBe(history)
  })
  it('再生・作品切替・時間移動・別画面への遷移で選択を持ち越さない', () => {
    for (const transition of [
      () => useBuilderStore.getState().setMode('play'),
      () => useBuilderStore.getState().setProject(createBookProject(), 'import'),
      () => useBuilderStore.getState().setPreviewProgress(.2),
      () => useWorkspaceStore.getState().setScreen('settings'),
    ]) {
      useBuilderStore.getState().setMode('edit'); useWorkspaceStore.getState().setScreen('book')
      usePartPlacementStore.getState().start(ref); transition()
      expect(usePartPlacementStore.getState().tool).toBeNull()
    }
    useBuilderStore.getState().setMode('play'); usePartPlacementStore.getState().start(ref)
    expect(usePartPlacementStore.getState().tool).toBeNull()
  })
})
