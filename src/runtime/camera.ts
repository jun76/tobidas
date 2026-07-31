import type { Book } from '../schema/book'
import { evaluateBookSignals } from './signals'
import {
  blendCamera,
  blendEnvironment,
  evaluateSpreadCamera,
  evaluateSpreadEnvironment,
  type CameraPose,
  type EnvironmentState,
} from './timeline/evaluate'

export type { CameraPose, EnvironmentState }

export function evaluateTimelineCamera(book: Book, progress: number): CameraPose {
  const signals = evaluateBookSignals(book, progress)
  const spread = book.spreads[signals.activeSpreadIndex]
  if (signals.beat.kind === 'turn' && signals.activeSpreadIndex + 1 < book.spreads.length) {
    const next = book.spreads[signals.activeSpreadIndex + 1]
    return blendCamera(
      evaluateSpreadCamera(spread, spread.sequence.holdSeconds, book.camera),
      evaluateSpreadCamera(next, 0, book.camera),
      signals.beatProgress,
    )
  }
  const time = signals.beat.kind === 'cover-open' ? 0
    : signals.beat.kind === 'back-cover-close' ? spread.sequence.holdSeconds
      : signals.spreadTimes[signals.activeSpreadIndex]
  return evaluateSpreadCamera(spread, time, book.camera)
}

export function evaluateTimelineEnvironment(book: Book, progress: number): EnvironmentState {
  const signals = evaluateBookSignals(book, progress)
  const spread = book.spreads[signals.activeSpreadIndex]
  if (signals.beat.kind === 'turn' && signals.activeSpreadIndex + 1 < book.spreads.length) {
    const next = book.spreads[signals.activeSpreadIndex + 1]
    return blendEnvironment(
      evaluateSpreadEnvironment(spread, spread.sequence.holdSeconds, book.appearance.background, book.lights),
      evaluateSpreadEnvironment(next, 0, book.appearance.background, book.lights),
      signals.beatProgress,
    )
  }
  const time = signals.beat.kind === 'cover-open' ? 0
    : signals.beat.kind === 'back-cover-close' ? spread.sequence.holdSeconds
      : signals.spreadTimes[signals.activeSpreadIndex]
  return evaluateSpreadEnvironment(spread, time, book.appearance.background, book.lights)
}

export function activeSpreadHasCameraTracks(book: Book, progress: number): boolean {
  const signals = evaluateBookSignals(book, progress)
  const indexes = signals.beat.kind === 'turn'
    ? [signals.activeSpreadIndex, Math.min(book.spreads.length - 1, signals.activeSpreadIndex + 1)]
    : [signals.activeSpreadIndex]
  return indexes.some((index) => book.spreads[index].timeline.tracks.some((track) => track.target.type === 'camera'))
}
