import type { Spread } from '../../schema/book'
import type { StageElement } from '../../schema/stageElement'
import type { EditorState } from './editorState'

type ProjectState = Pick<EditorState, 'project'>
type ActiveSpreadState = Pick<EditorState, 'project' | 'activeSpreadId'>
type SelectionState = Pick<EditorState, 'project' | 'selection'>

export const selectSpreadById = (state: ProjectState, spreadId: string): Spread | undefined =>
  state.project.book.spreads.find((spread) => spread.id === spreadId)

export const selectActiveSpread = (state: ActiveSpreadState): Spread | undefined =>
  selectSpreadById(state, state.activeSpreadId)

export const selectSelectedElement = (state: SelectionState): StageElement | undefined => {
  const selection = state.selection
  return selection.type === 'element'
    ? selectSpreadById(state, selection.spreadId)?.elements.find(
      (element) => element.id === selection.elementId,
    )
    : undefined
}
