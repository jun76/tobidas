import { describe, expect, it } from 'vitest'
import { createBook, createSpread } from '../schema/bookDefaults'
import { currentSpreadIndex, spreadHoldEnd, spreadJumpPlan } from './pageTurn'
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

describe('見開きへのジャンプ', () => {
  const book = bookWithSpreads(3)
  const holdEnd = (index: number) => spreadHoldEnd(book, index)!

  it('最初の見開きは閉じた表紙から、以降は前の保持終端から進めて保持終端で止まる', () => {
    expect(spreadJumpPlan(book, 0)).toEqual({ start: 0, target: holdEnd(0) })
    expect(spreadJumpPlan(book, 1)).toEqual({ start: holdEnd(0), target: holdEnd(1) })
    expect(spreadJumpPlan(book, 2)).toEqual({ start: holdEnd(1), target: holdEnd(2) })
  })

  it('存在しない見開きは無効', () => {
    expect(spreadJumpPlan(book, -1)).toBeUndefined()
    expect(spreadJumpPlan(book, 3)).toBeUndefined()
  })
})
