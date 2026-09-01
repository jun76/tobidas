import { describe, expect, it } from 'vitest'
import { frontCoverRestHeight, pageLeafRestHeight } from './pageStack'

describe('frontCoverRestHeight', () => {
  const paper = 0.015

  it('閉じた表紙を紙束から浮かせない', () => {
    expect(frontCoverRestHeight(paper, 0, 0)).toBe(0)
  })

  it('最初の見開きでは右紙葉の表面へ揃える', () => {
    expect(frontCoverRestHeight(paper, 1, 0)).toBeCloseTo(paper)
  })

  it('最初の紙葉を送った後は左紙束の下へ戻す', () => {
    expect(frontCoverRestHeight(paper, 1, 1)).toBe(0)
  })

  it('可視紙葉の底面を厚紙束の上面へ密着させる', () => {
    expect(pageLeafRestHeight(paper)).toBeCloseTo(paper / 2)
  })
})
