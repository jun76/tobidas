import { describe, expect, it } from 'vitest'
import { createBook, createSpread } from '../schema/bookDefaults'
import { currentSpreadIndex, pageTurnPlan, pageTurnTarget, spreadHoldEnd } from './pageTurn'
import { compileBookBeats } from './signals'

function bookWithSpreads(count: number) {
  const book = createBook()
  for (let index = 1; index < count; index++) book.spreads.push(createSpread(`見開き ${index + 1}`))
  return book
}

function beat(book: ReturnType<typeof bookWithSpreads>, kind: string, index: number) {
  const spread = book.spreads[index]
  return compileBookBeats(book).find((candidate) => candidate.kind === kind && candidate.spreadId === spread.id)!
}

describe('現在の見開き', () => {
  const book = bookWithSpreads(3)

  it('表紙を開いている間は -1、保持とその後のめくりを同じ見開きに数える', () => {
    expect(currentSpreadIndex(book, 0)).toBe(-1)
    expect(currentSpreadIndex(book, beat(book, 'hold', 0).start)).toBe(0)
    expect(currentSpreadIndex(book, beat(book, 'turn', 0).start + 0.01)).toBe(0)
    expect(currentSpreadIndex(book, beat(book, 'hold', 1).start)).toBe(1)
    expect(currentSpreadIndex(book, 1)).toBe(2)
  })

  it('保持の終端はその見開きに属する', () => {
    expect(currentSpreadIndex(book, spreadHoldEnd(book, 1)!)).toBe(1)
  })
})

describe('ページ送りの目的地', () => {
  const book = bookWithSpreads(3)
  const holdEnd = (index: number) => spreadHoldEnd(book, index)!

  it('表紙からの Next は最初の見開きの保持終端、Prev は無効', () => {
    expect(pageTurnTarget(book, 0, 1)).toBe(holdEnd(0))
    expect(pageTurnTarget(book, 0, -1)).toBeUndefined()
  })

  it('保持の終端からは前後の見開きの保持終端へ進む', () => {
    expect(pageTurnTarget(book, holdEnd(0), 1)).toBe(holdEnd(1))
    expect(pageTurnTarget(book, holdEnd(1), -1)).toBe(holdEnd(0))
    expect(pageTurnTarget(book, holdEnd(0), -1)).toBe(0)
  })

  it('保持の途中からも同じ目的地へ向かう', () => {
    const mid = (beat(book, 'hold', 1).start + holdEnd(1)) / 2
    expect(pageTurnTarget(book, mid, 1)).toBe(holdEnd(2))
    expect(pageTurnTarget(book, mid, -1)).toBe(holdEnd(0))
  })

  it('めくりの途中からの Prev はめくりかけた見開きの保持終端へ戻す', () => {
    const turning = (beat(book, 'turn', 1).start + beat(book, 'turn', 1).end) / 2
    expect(pageTurnTarget(book, turning, -1)).toBe(holdEnd(1))
    expect(pageTurnTarget(book, turning, 1)).toBe(holdEnd(2))
  })

  it('最後の見開きからの Next は末尾、末尾では Next が無効で Prev は最後の保持終端', () => {
    expect(pageTurnTarget(book, holdEnd(2), 1)).toBe(1)
    expect(pageTurnTarget(book, 1, 1)).toBeUndefined()
    expect(pageTurnTarget(book, 1, -1)).toBe(holdEnd(2))
  })
})

describe('ページ送りの計画', () => {
  const book = bookWithSpreads(3)
  const holdEnd = (index: number) => spreadHoldEnd(book, index)!

  it('保持の途中の Next は保持終端へ直ちに飛んでから次の保持終端へ進む', () => {
    const mid = (beat(book, 'hold', 1).start + holdEnd(1)) / 2
    expect(pageTurnPlan(book, mid, 1)).toEqual({ start: holdEnd(1), target: holdEnd(2) })
  })

  it('保持の途中の Prev は保持の始まりへ直ちに飛んでから前の保持終端へ戻る', () => {
    const mid = (beat(book, 'hold', 1).start + holdEnd(1)) / 2
    expect(pageTurnPlan(book, mid, -1)).toEqual({ start: beat(book, 'hold', 1).start, target: holdEnd(0) })
  })

  it('保持終端・めくりの途中・表紙からは飛ばずにその位置から進む', () => {
    expect(pageTurnPlan(book, holdEnd(0), 1)).toEqual({ start: holdEnd(0), target: holdEnd(1) })
    const turning = (beat(book, 'turn', 1).start + beat(book, 'turn', 1).end) / 2
    expect(pageTurnPlan(book, turning, 1)).toEqual({ start: turning, target: holdEnd(2) })
    expect(pageTurnPlan(book, turning, -1)).toEqual({ start: turning, target: holdEnd(1) })
    expect(pageTurnPlan(book, 0.01, 1)).toEqual({ start: 0.01, target: holdEnd(0) })
    expect(pageTurnPlan(book, 0, -1)).toBeUndefined()
    expect(pageTurnPlan(book, 1, 1)).toBeUndefined()
  })
})
