import { create } from 'zustand'
import type { BuilderCommandResult } from './types'

interface OperationResultState {
  result: BuilderCommandResult | null
  version: number
  publish: (result: BuilderCommandResult) => void
}

/**
 * 共通操作の直前結果だけを保持する編集セッション用store。
 * 作品データ、undo、自動保存、書き出しには含めない。
 */
export const useOperationResultStore = create<OperationResultState>((set) => ({
  result: null,
  version: 0,
  publish: (result) => set((state) => ({ result, version: state.version + 1 })),
}))

export function publishOperationResult(result: BuilderCommandResult): BuilderCommandResult {
  useOperationResultStore.getState().publish(result)
  return result
}
