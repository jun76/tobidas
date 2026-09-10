import { create } from 'zustand'

/** 部品プレビューの一面選択。未確定のカーソル位置は部品へ保存しない。 */
export const usePartContentPlacementStore = create<{
  kind: 'decal' | 'fiction' | 'particle' | null; error: string
  start: (kind: 'decal' | 'fiction' | 'particle') => void; cancel: () => void
}>((set) => ({ kind: null, error: '', start: (kind) => set({ kind, error: '' }), cancel: () => set({ kind: null, error: '' }) }))
