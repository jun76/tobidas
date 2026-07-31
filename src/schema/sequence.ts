import { z } from 'zod'

/**
 * 進行の重み (docs/005 §7)。
 * closeビートは存在しない。折り畳みはビートの区切りではなく
 * シート回転から導出する露出度に従う。
 */
export const spreadSequenceSchema = z.object({
  holdSeconds: z.number().positive(),
  turnSeconds: z.number().positive(),
})

export type BeatKind = 'cover-open' | 'hold' | 'turn' | 'back-cover-close'

export interface CompiledBeat {
  id: string
  kind: BeatKind
  spreadId?: string
  start: number
  end: number
  startSeconds: number
  endSeconds: number
}
