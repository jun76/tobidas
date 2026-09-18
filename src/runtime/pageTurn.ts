import type { Book } from '../schema/book'
import { clamp01, compileBookBeats } from './signals'

/**
 * 手動のページ送り。
 *
 * 自動再生はシームレスに進むが、再生画面の Prev・Next は見開き単位で止まる。
 * 止まる位置は必ず「保持区間の終端」(次のめくりが始まる直前、演出を終えた姿勢) とし、
 * 途中で止めた位置からでも同じ目的地へ向かう。姿勢の評価には関わらず、進行値の目的地を
 * 決めるだけの純関数である。
 */

/**
 * 進行値が属する現在の見開きの添字。
 * 保持区間とその後のめくりを同じ見開きに数える。表紙を開いている間は -1。
 */
export function currentSpreadIndex(book: Book, rawProgress: number): number {
  const progress = clamp01(rawProgress)
  const beats = compileBookBeats(book)
  // 区間の境界 (保持の終端など) は次の区間へ入ったとみなし、末尾だけ最後の区間に含める
  const beat = beats.find((candidate) => progress < candidate.end) ?? beats[beats.length - 1]
  if (!beat.spreadId) return -1
  return book.spreads.findIndex((spread) => spread.id === beat.spreadId)
}

/** 見開きの保持区間の終端の進行値 */
export function spreadHoldEnd(book: Book, index: number): number | undefined {
  return spreadHold(book, index)?.end
}

function spreadHold(book: Book, index: number) {
  const spread = book.spreads[index]
  if (!spread) return undefined
  return compileBookBeats(book).find((beat) => beat.kind === 'hold' && beat.spreadId === spread.id)
}

/** ページ送りの計画。start へ直ちに飛び、そこから target まで作者の速度で進める */
export interface PageTurnPlan {
  start: number
  target: number
}

/**
 * Prev・Next の計画。動けないときは undefined (ボタンを無効にする)。
 *
 * 保持区間の途中で押されたときは、残りの演出を待たずにめくりが始まるフレームへ直ちに飛ぶ。
 * Next なら現在の見開きの保持終端、Prev なら保持の始まり (逆再生のめくりが始まる位置) が start になる。
 * めくりの途中や表紙を開いている途中は、その位置からそのまま進める。
 */
export function pageTurnPlan(book: Book, rawProgress: number, direction: 1 | -1): PageTurnPlan | undefined {
  const progress = clamp01(rawProgress)
  const target = pageTurnTarget(book, progress, direction)
  if (target === undefined) return undefined
  const hold = spreadHold(book, currentSpreadIndex(book, progress))
  let start = progress
  if (hold && progress > hold.start && progress < hold.end) start = direction > 0 ? hold.end : hold.start
  return { start, target }
}

/**
 * Prev・Next の目的地。動けないときは undefined (ボタンを無効にする)。
 * Next は次の見開きの保持終端、最後の見開きからは末尾。Prev は前の見開きの保持終端、
 * 最初の見開きからは先頭 (閉じた表紙)。表紙を開いている間は Next だけが効く。
 */
export function pageTurnTarget(book: Book, rawProgress: number, direction: 1 | -1): number | undefined {
  const progress = clamp01(rawProgress)
  const index = currentSpreadIndex(book, progress)
  if (direction > 0) {
    if (progress >= 1) return undefined
    const next = index + 1
    return next < book.spreads.length ? spreadHoldEnd(book, next) : 1
  }
  if (index < 0) return undefined
  // めくりの途中 (末尾で閉じた裏表紙も含む) からは、まずめくりかけた見開きの保持終端へ戻す
  const holdEnd = spreadHoldEnd(book, index)
  if (holdEnd !== undefined && progress > holdEnd) return holdEnd
  return index === 0 ? 0 : spreadHoldEnd(book, index - 1)
}
