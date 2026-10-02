import { create } from 'zustand'
import type { BookProject } from '../../schema/bookPackage'
import { planPartEdit, type PartEditIntent } from '../../parts/edit'
import { applyBookEditPlan, bookEditScene } from '../../parts/bookEdit'
import { useBuilderStore } from '../store'
import { editPlacedPartCommand } from './commands'

interface PartEditSession {
  source: BookProject; spreadId: string; elementId: string; preview: BookProject
  intent?: PartEditIntent; last?: PartEditIntent; error: string
}
interface EditState {
  session: PartEditSession | null; angleId: string; error: string
  begin: (spreadId: string, elementId: string) => void
  preview: (intent: PartEditIntent) => void
  finish: () => void; cancel: () => void; chooseAngle: (id: string) => void
}
export const usePartEditStore = create<EditState>((set, get) => ({
  session: null, angleId: '', error: '', chooseAngle: (angleId) => set({ angleId, session: null, error: '' }),
  begin: (spreadId, elementId) => {
    const source = useBuilderStore.getState().project
    set({ error: '', session: { source, spreadId, elementId, preview: source, error: '' } })
  },
  preview: (intent) => {
    const s = get().session
    if (!s || s.source !== useBuilderStore.getState().project) { set({ session: null }); return }
    const plan = planPartEdit(bookEditScene(s.source, s.spreadId), s.elementId, intent, false)
    set({ session: plan.ok ? { ...s, intent, last: intent, error: '', preview: applyBookEditPlan(s.source, s.spreadId, plan) }
      : { ...s, intent, error: plan.detail } })
  },
  finish: () => {
    const s = get().session
    set({ session: null })
    if (!s || !s.intent || s.source !== useBuilderStore.getState().project) return
    // 確定の共通コマンドが全角度の検査を行う。同じ検査を事前に重ねず、通らなければ最後に成立した姿勢で確定する
    const command = (intent: PartEditIntent) => editPlacedPartCommand({ spreadId: s.spreadId, elementId: s.elementId, intent })
    const result = command(s.intent)
    if (result.ok) { set({ error: '' }); return }
    const fallback = s.last && s.last !== s.intent ? command(s.last) : undefined
    set({ error: fallback && !fallback.ok ? fallback.message : result.message })
  },
  cancel: () => set({ session: null, error: '' }),
}))
const unsubscribe = useBuilderStore.subscribe((state, previous) => {
  if (state.project !== previous.project || state.selection !== previous.selection || state.mode !== previous.mode
    || state.previewProgress !== previous.previewProgress || state.gizmo !== previous.gizmo) usePartEditStore.getState().cancel()
})
if (import.meta.hot) import.meta.hot.dispose(unsubscribe)
