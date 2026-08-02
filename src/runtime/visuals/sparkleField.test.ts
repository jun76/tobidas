import { describe, expect, it } from 'vitest'
import { SPARKLE, buildSparkleField, seededRandom } from './sparkleField'

describe('光の欠片の粒', () => {
  it('広がりは差し渡しに収まる', () => {
    const field = buildSparkleField('spread-1-ember', 2.2)
    expect(field.positions).toHaveLength(SPARKLE.count * 3)
    for (const value of field.positions) expect(Math.abs(value)).toBeLessThanOrEqual(1.1)
  })

  it('全粒子を透明な縦置き平面上へ置く', () => {
    const field = buildSparkleField('spread-1-ember', 2.2)
    for (let index = 0; index < SPARKLE.count; index++) {
      expect(field.positions[index * 3 + 2]).toBe(0)
    }
  })

  it('畳まれた要素の雲は広がりを持たない', () => {
    // 収納コンパイラが動かすのは要素の原点だけなので、広がりを収納へ従わせるのは
    // ここの役目。広がったままだと、閉じてページが傾いたときに粒が紙の輪郭の
    // 外へ出て、本の外や隣の面の上に浮いて見える
    const field = buildSparkleField('spread-1-ember', 0)
    // -0 になりうるので絶対値で見る
    for (const value of field.positions) expect(Math.abs(value)).toBe(0)
  })

  it('同じ要素IDからは同じ雲が組み上がる', () => {
    // drei はマウントのたびに位置を引き直すので、Visibility Gate が
    // 付け外しするたびに雲の形が変わっていた
    const a = buildSparkleField('spread-5-halo', 1.2)
    const b = buildSparkleField('spread-5-halo', 1.2)
    const other = buildSparkleField('spread-4-halo', 1.2)
    expect([...a.positions]).toEqual([...b.positions])
    expect([...a.positions]).not.toEqual([...other.positions])
  })

  it('粒ごとに速さを散らす', () => {
    const { rates } = buildSparkleField('spread-2-spray', 1.8)
    expect(new Set(rates).size).toBeGreaterThan(1)
    for (const rate of rates) expect(rate).toBeGreaterThanOrEqual(0.75)
    for (const rate of rates) expect(rate).toBeLessThanOrEqual(1.25)
  })

  it('種つき乱数は0..1を返す', () => {
    const next = seededRandom('seed')
    for (let i = 0; i < 50; i++) {
      const value = next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})
