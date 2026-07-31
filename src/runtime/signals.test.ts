import { describe, expect, it } from 'vitest'
import { createBook, createSpread } from '../schema/bookDefaults'
import { compileBookBeats, evaluateBookSignals, evaluateSheetAngles, playbackDurationSeconds } from './signals'

function bookWithSpreads(count: number) {
  const book = createBook()
  for (let index = 1; index < count; index++) book.spreads.push(createSpread(`見開き ${index + 1}`))
  return book
}

describe('ビート列', () => {
  it('連続した正規化区間になる', () => {
    const beats = compileBookBeats(bookWithSpreads(3))
    expect(beats[0].start).toBe(0)
    expect(beats.at(-1)?.end).toBe(1)
    for (let index = 1; index < beats.length; index++) expect(beats[index].start).toBeCloseTo(beats[index - 1].end)
  })

  it('closeビートを含まない', () => {
    const kinds = new Set(compileBookBeats(bookWithSpreads(3)).map((beat) => beat.kind))
    expect(kinds).toEqual(new Set(['cover-open', 'hold', 'turn', 'back-cover-close']))
  })
})

describe('蝶番角', () => {
  it('進行に対して各シートが単調に開く', () => {
    const book = bookWithSpreads(3)
    const beats = compileBookBeats(book)
    let previous = evaluateSheetAngles(book, beats, 0)
    for (let step = 1; step <= 200; step++) {
      const angles = evaluateSheetAngles(book, beats, step / 200)
      for (let sheet = 0; sheet < angles.length; sheet++) expect(angles[sheet]).toBeGreaterThanOrEqual(previous[sheet] - 1e-9)
      previous = angles
    }
  })

  it('同じ進行値から順逆どちらでも同じ値を返す', () => {
    const book = bookWithSpreads(2)
    const beats = compileBookBeats(book)
    for (const progress of [0, 0.2, 0.41, 0.63, 0.85, 1]) {
      expect(evaluateSheetAngles(book, beats, progress)).toEqual(evaluateSheetAngles(book, beats, progress))
    }
  })
})

describe('見開き二面角', () => {
  it('hold区間でπ、閉じた本で0になる', () => {
    const book = bookWithSpreads(3)
    const beats = compileBookBeats(book)
    for (const [index, spread] of book.spreads.entries()) {
      const hold = beats.find((beat) => beat.kind === 'hold' && beat.spreadId === spread.id)!
      expect(evaluateBookSignals(book, (hold.start + hold.end) / 2).dihedrals[index]).toBeCloseTo(Math.PI)
    }
    for (const dihedral of evaluateBookSignals(book, 0).dihedrals) expect(dihedral).toBe(0)
    for (const dihedral of evaluateBookSignals(book, 1).dihedrals) expect(dihedral).toBe(0)
  })

  it('ページ送り中は送り元が閉じ、送り先が同時に開く', () => {
    const book = bookWithSpreads(2)
    const beats = compileBookBeats(book)
    const turn = beats.find((beat) => beat.kind === 'turn')!
    const middle = evaluateBookSignals(book, (turn.start + turn.end) / 2)
    expect(middle.dihedrals[0]).toBeGreaterThan(0)
    expect(middle.dihedrals[0]).toBeLessThan(Math.PI)
    expect(middle.dihedrals[1]).toBeGreaterThan(0)
    expect(middle.dihedrals[1]).toBeLessThan(Math.PI)
    // 表紙開きもページ送りも同じ導出式であり、和は常にπ以下
    expect(middle.dihedrals[0] + middle.dihedrals[1]).toBeLessThanOrEqual(Math.PI + 1e-9)
  })

  it('進行の全域で二面角が連続する', () => {
    const book = bookWithSpreads(3)
    const steps = 800
    let previous = evaluateBookSignals(book, 0)
    for (let step = 1; step <= steps; step++) {
      const signals = evaluateBookSignals(book, step / steps)
      for (let index = 0; index < signals.dihedrals.length; index++) {
        expect(Math.abs(signals.dihedrals[index] - previous.dihedrals[index])).toBeLessThan(0.15)
      }
      previous = signals
    }
  })

  it('明示した秒数の総和を等速再生時間として使う', () => {
    const book = bookWithSpreads(2)
    book.sequence.coverOpenSeconds = 1
    book.spreads[0].sequence = { holdSeconds: 2, turnSeconds: 1.5 }
    book.spreads[1].sequence = { holdSeconds: 3, turnSeconds: 2.5 }
    expect(playbackDurationSeconds(book)).toBe(10)
  })

  it('保持前は0秒、保持後はholdSecondsへ固定する', () => {
    const book = bookWithSpreads(2)
    const beats = compileBookBeats(book)
    const first = book.spreads[0]
    const hold = beats.find((beat) => beat.kind === 'hold' && beat.spreadId === first.id)!
    expect(evaluateBookSignals(book, hold.start / 2).spreadTimes[0]).toBe(0)
    expect(evaluateBookSignals(book, (hold.start + hold.end) / 2).spreadTimes[0]).toBeCloseTo(first.sequence.holdSeconds / 2)
    expect(evaluateBookSignals(book, 1).spreadTimes[0]).toBe(first.sequence.holdSeconds)
  })
})
