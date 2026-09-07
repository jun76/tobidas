import { create } from 'zustand'
import { newPartDefinition, partDefinitionSchema, type PartBundle } from '../../parts/schema'
import { syncDefinitionRequirements, validatePartDefinition } from '../../parts/validate'
import { listLibraryParts, loadPartDraft, savePartDraft, type LibraryPart } from './repository'
import { t } from '../i18n'

type Screen = 'home' | 'book' | 'part' | 'settings'
export const useWorkspaceStore = create<{ screen: Screen; setScreen: (screen: Screen) => void }>((set) => ({
  screen: 'home', setScreen: (screen) => set({ screen }),
}))
interface PartEditorState {
  documentId: string; bundle: PartBundle; selectedId: string | null; undo: PartBundle[]; redo: PartBundle[]
  library: LibraryPart[]; booted: boolean; saveError: string; status: 'saved' | 'saving' | 'error'
  change: (mutate: (bundle: PartBundle) => void) => void
  open: (bundle: PartBundle) => void
  select: (id: string | null) => void
  undoEdit: () => void; redoEdit: () => void; refreshLibrary: () => Promise<void>; boot: () => Promise<void>
}
let saveChain: Promise<void> = Promise.resolve()
function autosave(documentId: string, bundle: PartBundle) {
  usePartEditorStore.setState({ status: 'saving', saveError: '' })
  saveChain = saveChain.catch(() => {}).then(() => savePartDraft({ documentId, bundle })).then(() => {
    if (usePartEditorStore.getState().bundle === bundle) usePartEditorStore.setState({ status: 'saved', saveError: '' })
  }).catch((error) => usePartEditorStore.setState({ status: 'error', saveError: String(error) }))
}
export const usePartEditorStore = create<PartEditorState>((set, get) => ({
  documentId: crypto.randomUUID(), bundle: { definition: newPartDefinition(t().parts.newPart), definitions: {}, assets: [] },
  selectedId: null, undo: [], redo: [], library: [], booted: false, status: 'saved', saveError: '',
  change: (mutate) => {
    const previous = get().bundle, next = structuredClone(previous)
    mutate(next); syncDefinitionRequirements(next.definition)
    next.definition = partDefinitionSchema.parse(next.definition)
    set({ bundle: next, undo: [...get().undo, previous].slice(-60), redo: [] })
    autosave(get().documentId, next)
  },
  open: (source) => {
    const bundle = structuredClone(source), documentId = crypto.randomUUID()
    set({ bundle, documentId, selectedId: null, undo: [], redo: [] })
    autosave(documentId, bundle)
  },
  select: (id) => set({ selectedId: id }),
  undoEdit: () => {
    const state = get(), bundle = state.undo.at(-1)
    if (!bundle) return
    set({ bundle, undo: state.undo.slice(0, -1), redo: [...state.redo, state.bundle], selectedId: null })
    autosave(state.documentId, bundle)
  },
  redoEdit: () => {
    const state = get(), bundle = state.redo.at(-1)
    if (!bundle) return
    set({ bundle, redo: state.redo.slice(0, -1), undo: [...state.undo, state.bundle], selectedId: null })
    autosave(state.documentId, bundle)
  },
  refreshLibrary: async () => set({ library: await listLibraryParts() }),
  boot: async () => {
    if (get().booted) return
    set({ booted: true })
    try {
      const [draft, library] = await Promise.all([loadPartDraft(), listLibraryParts()])
      set({ ...(draft ? { documentId: draft.documentId, bundle: draft.bundle } : {}), library, booted: true })
    } catch (error) { set({ booted: true, saveError: String(error), status: 'error' }) }
  },
}))
export const partEditorValidation = () => {
  const { bundle } = usePartEditorStore.getState()
  return validatePartDefinition(bundle.definition, bundle.definitions)
}
