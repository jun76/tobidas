import { describe, expect, it } from 'vitest'
import {
  frontCoverRestHeight,
  lastPageIsExposed,
  pageClickTargetLift,
  pageLeafRestHeight,
  paperStackSupportThickness,
} from './pageStack'
import { STOW_HIDDEN_DEG, stowIsDrawn } from './stow/evaluate'

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

  it.each([2, 5, 8, 40])('見開き%d枚でも、描画中の本文と寝た部品を支持束へ埋めない', (spreads) => {
    for (const thickness of [.006, paper, .04]) {
      const stack = Math.max(thickness * (spreads + 1), .18 * .22)
      // 17°から15°で本文が消えた場面と、非表示に入る直前までを含める。
      for (const degrees of [45, 30, 20, 17, 15, 10, 5, STOW_HIDDEN_DEG + .001]) {
        const angle = 1 - degrees / 180
        const sheets = [angle, ...Array<number>(spreads - 2).fill(0)]
        const support = paperStackSupportThickness(stack, thickness, sheets)
        const restY = frontCoverRestHeight(thickness, support.left, angle)
        expect(stowIsDrawn(degrees / 180)).toBe(true)
        // 紙束の天面は0、背景画像は0.003。本文(0.008)と倒伏片(0.006)が
        // 有効なまま地面の下へ消えないことを、実際の紙面高で検査する。
        expect(restY + .008).toBeGreaterThan(.003)
        expect(restY + .006).toBeGreaterThan(.003)
      }
    }
  })

  it('描画終了の境界と閉じ切りで表紙の高さが連続する', () => {
    const boundary = 1 - STOW_HIDDEN_DEG / 180
    const restAt = (angle: number) => frontCoverRestHeight(paper, .03, angle)
    expect(restAt(boundary)).toBeGreaterThanOrEqual(0)
    expect(restAt(boundary + 1e-7)).toBeCloseTo(restAt(boundary), 9)
    expect(restAt(1 - 1e-7)).toBeCloseTo(restAt(1), 9)
    expect(restAt((boundary + 1) / 2)).toBeLessThan(paper)
  })

  it('閉じ際の本文が次の紙葉の表側を突き抜けない高さへ降ろす', () => {
    // 綴じ目から0.35離れた本文の端と、実際の紙葉の下面を比較する。
    for (const degrees of [5, 3, STOW_HIDDEN_DEG + .1]) {
      const delta = degrees * Math.PI / 180
      const ceilingY = pageLeafRestHeight(paper) + .35 * Math.tan(delta) - paper / (2 * Math.cos(delta))
      const captionY = frontCoverRestHeight(paper, .03, 1 - degrees / 180) + .008
      expect(captionY).toBeGreaterThan(.003)
      expect(captionY).toBeLessThan(ceilingY)
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

describe('pageClickTargetLift', () => {
  const paper = 0.015
  const lift = (order: number, face: 'front' | 'back') =>
    pageClickTargetLift(paper, order, 3, face)

  it('右側では葉番号の小さい紙葉の表面を上へ置く', () => {
    // 束の右では手前の紙葉ほど葉番号が小さい。同じ高さのままだと
    // 表示中の見開きの右ページと奥の紙葉の右ページが同一平面で競合する
    expect(lift(0, 'front')).toBeGreaterThan(lift(1, 'front'))
    expect(lift(1, 'front')).toBeGreaterThan(lift(2, 'front'))
  })

  it('左側では葉番号の大きい紙葉の裏面を上へ置く', () => {
    expect(lift(2, 'back')).toBeGreaterThan(lift(1, 'back'))
    expect(lift(1, 'back')).toBeGreaterThan(lift(0, 'back'))
  })

  it('持ち上げは隣の紙葉の面を越えない', () => {
    for (let order = 0; order < 3; order++) {
      for (const face of ['front', 'back'] as const) {
        expect(lift(order, face)).toBeLessThan(paper / 2)
      }
    }
  })

  it('紙葉が1枚だけなら持ち上げない', () => {
    expect(pageClickTargetLift(paper, 0, 1, 'front')).toBe(0)
    expect(pageClickTargetLift(paper, 0, 1, 'back')).toBe(0)
  })
})

describe('lastPageIsExposed', () => {
  it('手前の紙葉が右半分を覆っている間は天面の判定を出さない', () => {
    // 手前の見開きを表示中はここが常に真になり、紙面をクリックすると
    // 最終見開きが選ばれていた
    expect(lastPageIsExposed(0)).toBe(false)
    expect(lastPageIsExposed(0.5)).toBe(false)
  })

  it('覆っている紙葉が左へ倒れた後だけ天面の判定を出す', () => {
    expect(lastPageIsExposed(0.75)).toBe(true)
    expect(lastPageIsExposed(1)).toBe(true)
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
