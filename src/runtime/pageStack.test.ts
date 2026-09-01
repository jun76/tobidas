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
