import { create } from 'zustand'
import type { PartReference } from '../../parts/schema'
import type { PlacementFailure, SurfacePick } from '../../parts/placement'
import { useBuilderStore } from '../store'
import { useWorkspaceStore } from './store'
import { placementProject, referenceDefinition } from './commands'
import { t } from '../i18n'

interface PlacementState {
  tool: { reference?: PartReference; content?: 'decal' | 'fiction' | 'particle'; name: string; faces: 1 | 2 } | null
  first: SurfacePick | null
  hover: string | null
  reason: PlacementFailure | null
  error: string
  start(reference: PartReference): void
  startContent(kind: 'decal' | 'fiction' | 'particle'): void
  cancel(): void
  chooseFirst(first: SurfacePick): void
  back(): void
  showHover(hover: string | null, reason: PlacementFailure | null): void
}
const empty = { tool: null, first: null, hover: null, reason: null, error: '' }
export const usePartPlacementStore = create<PlacementState>((set, get) => ({
  ...empty,
  start: (reference) => {
    if (JSON.stringify(get().tool?.reference) === JSON.stringify(reference)) { set(empty); return }
    const state = useBuilderStore.getState()
    if (state.mode !== 'edit') return
    const project = placementProject(), definition = referenceDefinition(reference, project.partDefinitions ?? {})
    // 面を選ぶ間は対象の見開きを全開に固定する。作品には操作中の状態を保存しない。
    state.setActiveSpread(state.activeSpreadId); state.setPlacement(null)
    const name = 'builtin' in reference ? t().parts.names[reference.builtin as keyof ReturnType<typeof t>['parts']['names']] : project.partDefinitions![reference.custom].name
    set({ ...empty, tool: { reference, name, faces: definition.input.kind === 'surface' ? 1 : 2 } })
  },
  startContent: (kind) => {
    if (get().tool?.content === kind) { set(empty); return }
    const state = useBuilderStore.getState(); if (state.mode !== 'edit') return
    state.setActiveSpread(state.activeSpreadId); state.setPlacement(null)
    set({ ...empty, tool: { content: kind, name: t().parts.content[kind], faces: 1 } })
  },
  cancel: () => set(empty),
  chooseFirst: (first) => set({ first, hover: null, reason: null, error: '' }),
  back: () => set({ first: null, hover: null, reason: null, error: '' }),
  showHover: (hover, reason) => {
    if (get().hover !== hover || get().reason !== reason) set({ hover, reason, error: '' })
  },
}))
const unsubscribeBuilder = useBuilderStore.subscribe((state, previous) => {
  if (state.project !== previous.project || state.activeSpreadId !== previous.activeSpreadId || state.mode !== previous.mode
    || state.placement !== previous.placement || state.previewProgress !== previous.previewProgress || state.hidden !== previous.hidden) usePartPlacementStore.getState().cancel()
})
const unsubscribeWorkspace = useWorkspaceStore.subscribe((state, previous) => { if (state.screen !== previous.screen) usePartPlacementStore.getState().cancel() })
if (import.meta.hot) import.meta.hot.dispose(() => { unsubscribeBuilder(); unsubscribeWorkspace() })
