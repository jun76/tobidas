import { describe, expect, it } from 'vitest'
import {
  frontCoverRestHeight,
  pageLeafRestHeight,
  paperStackSupportThickness,
} from './pageStack'

describe('frontCoverRestHeight', () => {
  const paper = 0.015
  it('閉じた表紙を連続紙面の上へ載せる', () => {
    expect(frontCoverRestHeight(paper, 0, 0)).toBeCloseTo(paper)
  })

  it('最初の見開きでも連続紙面の高さを保つ', () => {
    expect(frontCoverRestHeight(paper, 0, 0)).toBeCloseTo(paper)
  })

  it('最初の紙葉を送った後は左支持束の下へ戻す', () => {
    expect(frontCoverRestHeight(paper, 0.03, 1)).toBeCloseTo(-0.03)
  })

  it('送りの前半は表紙の裏を左支持束の天面より上へ保つ', () => {
    // 表紙の裏は見開き1の左ページ。紙葉が立っている間に支持束(天面0)より
    // 下がると、紙面から浮いた本文だけが束に埋まって先に消える。
    const support = 0.12
    for (let step = 0; step <= 15; step++) {
      const angle = step / 20 // 0.00 .. 0.75
      const left = support * angle / 7 // 8見開きぶんの左束の伸び
      const restY = frontCoverRestHeight(paper, left, angle)
      expect(restY).toBeGreaterThanOrEqual(0)
    }
  })

  it('潜り込みは紙葉が寝きる手前へ寄せる', () => {
    const support = 0.12
    const restAt = (angle: number) => frontCoverRestHeight(paper, support * angle / 7, angle)
    expect(restAt(0.5)).toBeCloseTo(paper) // 送りの半ばではまだ動かない
    expect(restAt(1)).toBeLessThan(0) // 送り切ったら束の下
    for (let step = 1; step <= 20; step++) {
      expect(restAt(step / 20)).toBeLessThanOrEqual(restAt((step - 1) / 20) + 1e-9)
    }
  })
})

describe('pageLeafRestHeight', () => {
  const paper = 0.015

  it('すべての可視紙葉を同じ上面高へ置く', () => {
    expect(pageLeafRestHeight(paper)).toBeCloseTo(paper / 2)
  })
})

describe('paperStackSupportThickness', () => {
  const paper = 0.015
  const stack = 0.135

  it('最初は支持紙束をすべて右に置く', () => {
    const supports = paperStackSupportThickness(stack, paper, [0, 0, 0])
    expect(supports.left).toBe(0)
    expect(supports.right).toBeCloseTo(0.12)
  })

  it('途中でも支持紙束の総厚と紙面の連続性を保つ', () => {
    const supports = paperStackSupportThickness(stack, paper, [1, 0.5, 0])
    expect(supports.left).toBeCloseTo(0.06)
    expect(supports.right).toBeCloseTo(0.06)
  })

  it('最後は支持紙束をすべて左へ移す', () => {
    const supports = paperStackSupportThickness(stack, paper, [1, 1, 1])
    expect(supports.left).toBeCloseTo(0.12)
    expect(supports.right).toBe(0)
  })
})
