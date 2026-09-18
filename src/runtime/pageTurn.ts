import type { Book } from '../schema/book'
import { clamp01, compileBookBeats } from './signals'

/**
 * 手動のページ送り。
 *
 * 自動再生はシームレスに進むが、再生画面の見開きボタンは見開き単位で止まる。
 * 止まる位置は必ず「保持区間の終端」(次のめくりが始まる直前、演出を終えた姿勢) とし、
 * どの位置からでも同じ目的地へ向かう。姿勢の評価には関わらず、進行値の目的地を
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

/** 見開きへのジャンプの計画。start へ直ちに飛び、そこから target まで作者の速度で進める */
export interface PageTurnPlan {
  start: number
  target: number
}

/**
 * 見開き index へのジャンプ。動けないときは undefined (ボタンを無効にする)。
 *
 * どの位置からでも、その見開きのめくりが始まるフレーム (前の見開きの保持終端、最初の見開きなら閉じた表紙)
 * へ直ちに飛び、めくりと演出を作者の速度で進めて保持終端で止まる。順番に押しても、離れた見開きへ
 * 飛んでも、同じ見え方で同じ位置に止まる。同じ見開きを押し直すと、その見開きをもう一度めくる。
 */
export function spreadJumpPlan(book: Book, index: number): PageTurnPlan | undefined {
  const target = spreadHoldEnd(book, index)
  if (target === undefined) return undefined
  const start = index === 0 ? 0 : spreadHoldEnd(book, index - 1)!
  return { start, target }
}
