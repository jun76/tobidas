import { create } from 'zustand'
import type { BookProject } from '../../schema/bookPackage'
import { planContentEdit, type ContentEditIntent } from '../../parts/contentEdit'
import { useBuilderStore } from '../store'
import { editConnectedContentCommand } from './contentCommands'

interface Session { source: BookProject; spreadId: string; elementId: string; preview: BookProject; intent?: ContentEditIntent }
export const useContentEditStore = create<{ session: Session | null; error: string; begin: (spread: string, id: string) => void;
  preview: (intent: ContentEditIntent) => void; finish: () => void; cancel: () => void }>((set, get) => ({
  session: null, error: '',
  begin: (spreadId, elementId) => { const source = useBuilderStore.getState().project; set({ session: { source, spreadId, elementId, preview: source }, error: '' }) },
  preview: (intent) => {
    const session = get().session; if (!session) return
    try { set({ session: { ...session, preview: planContentEdit(session.source, session.spreadId, session.elementId, intent, false), intent }, error: '' }) }
    catch (error) { set({ error: String(error instanceof Error ? error.message : error) }) }
  },
  finish: () => { const session = get().session; set({ session: null }); if (!session?.intent || session.source !== useBuilderStore.getState().project) return
    const result = editConnectedContentCommand({ spreadId: session.spreadId, elementId: session.elementId, intent: session.intent }); set({ error: result.ok ? '' : result.message }) },
  cancel: () => set({ session: null, error: '' }),
}))
const unsubscribe = useBuilderStore.subscribe((state, previous) => {
  if (state.project !== previous.project || state.selection !== previous.selection || state.mode !== previous.mode || state.previewProgress !== previous.previewProgress || state.gizmo !== previous.gizmo) useContentEditStore.getState().cancel()
})
if (import.meta.hot) import.meta.hot.dispose(unsubscribe)
