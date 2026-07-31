import type { Book } from '../schema/book'
import type { CompiledBeat } from '../schema/sequence'
import { spreadDihedrals } from './stow/dihedral'

/**
 * Book進行値 → 蝶番角 → 見開き二面角の導出 (docs/005 §5, docs/006 §4)。
 *
 * 本の状態はシート(表紙、紙葉、裏表紙)の蝶番角の列がすべてであり、
 * ビートは蝶番角を動かすだけのペーシング層である。
 * 部品の運動は二面角だけで駆動され (docs/006)、Visibility Gateも
 * 同じ二面角を閾値判定に使う。露出度ランプは存在しない。
 */

interface BookSignals {
  progress: number
  bookTime: number
  beat: CompiledBeat
  beatProgress: number
  /** カメラと音声の基準となる見開き。要素評価では参照しない */
  activeSpreadIndex: number
  /** シートs(0=表表紙 .. S=裏表紙)の蝶番角。πに対する割合 0..1 */
  sheetAngles: number[]
  /** 見開きkの二面角 (ラジアン)。0で閉、πで完全展開 */
  dihedrals: number[]
  /** 各見開きの決定的な保持時刻。保持前は0、保持後はholdSeconds */
  spreadTimes: number[]
}

export function compileBookBeats(book: Book): CompiledBeat[] {
  const spreadCount = book.spreads.length
  const timed: Array<{ id: string; kind: CompiledBeat['kind']; spreadId?: string; seconds: number }> = [
    { id: 'cover-open', kind: 'cover-open', seconds: book.sequence.coverOpenSeconds },
  ]
  for (const [index, spread] of book.spreads.entries()) {
    timed.push({ id: `${spread.id}:hold`, kind: 'hold', spreadId: spread.id, seconds: spread.sequence.holdSeconds })
    timed.push(
      index < spreadCount - 1
        ? { id: `${spread.id}:turn`, kind: 'turn', spreadId: spread.id, seconds: spread.sequence.turnSeconds }
        : { id: 'back-cover-close', kind: 'back-cover-close', spreadId: spread.id, seconds: spread.sequence.turnSeconds },
    )
  }
  const total = timed.reduce((sum, beat) => sum + beat.seconds, 0)
  let cursor = 0
  return timed.map((beat, index) => {
    const startSeconds = cursor
    const start = cursor / total
    cursor += beat.seconds
    return {
      id: beat.id,
      kind: beat.kind,
      spreadId: beat.spreadId,
      start,
      end: index === timed.length - 1 ? 1 : cursor / total,
      startSeconds,
      endSeconds: cursor,
    }
  })
}

/**
 * シートsを駆動するビート:
 * シート0 = cover-open、シートs(1..S-1) = 見開きs-1のturn、シートS = back-cover-close。
 * ビート前は0、ビート後は1、ビート中はeaseInOutで単調に進む。
 */
export function evaluateSheetAngles(book: Book, beats: CompiledBeat[], progress: number): number[] {
  const spreadCount = book.spreads.length
  const angles: number[] = []
  for (let sheet = 0; sheet <= spreadCount; sheet++) {
    const beat = sheet === 0
      ? beats.find((b) => b.kind === 'cover-open')!
      : sheet < spreadCount
        ? beats.find((b) => b.kind === 'turn' && b.spreadId === book.spreads[sheet - 1].id)!
        : beats.find((b) => b.kind === 'back-cover-close')!
    if (progress <= beat.start) angles.push(0)
    else if (progress >= beat.end) angles.push(1)
    else angles.push(easeInOut((progress - beat.start) / Math.max(Number.EPSILON, beat.end - beat.start)))
  }
  return angles
}

export function evaluateBookSignals(book: Book, rawProgress: number): BookSignals {
  const progress = clamp01(rawProgress)
  const beats = compileBookBeats(book)
  const totalSeconds = playbackDurationSeconds(book)
  const bookTime = progress * totalSeconds
  const beat = beats.find((candidate) => progress <= candidate.end + Number.EPSILON) ?? beats[beats.length - 1]
  const beatProgress = clamp01((progress - beat.start) / Math.max(Number.EPSILON, beat.end - beat.start))
  const sheetAngles = evaluateSheetAngles(book, beats, progress)
  const dihedrals = spreadDihedrals(sheetAngles)
  const activeSpreadIndex = beat.spreadId
    ? Math.max(0, book.spreads.findIndex((spread) => spread.id === beat.spreadId))
    : beat.kind === 'cover-open' ? 0 : book.spreads.length - 1
  const spreadTimes = book.spreads.map((spread) => {
    const hold = beats.find((candidate) => candidate.kind === 'hold' && candidate.spreadId === spread.id)!
    return Math.min(spread.sequence.holdSeconds, Math.max(0, bookTime - hold.startSeconds))
  })
  return { progress, bookTime, beat, beatProgress, activeSpreadIndex, sheetAngles, dihedrals, spreadTimes }
}

/** 進行重みを秒として扱った、作品全体の等速再生時間。 */
export function playbackDurationSeconds(book: Book): number {
  return book.sequence.coverOpenSeconds + book.spreads.reduce(
    (total, spread) => total + spread.sequence.holdSeconds + spread.sequence.turnSeconds,
    0,
  )
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function easeInOut(value: number): number {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

