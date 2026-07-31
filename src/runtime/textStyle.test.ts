import { describe, expect, it } from 'vitest'
import { canvasFont, measureTextBox, TEXT_FONTS, TEXT_LINE_HEIGHT } from './textStyle'

const style = { text: 'Lamp', font: 'rounded' as const, bold: true, italic: false, underline: false }

describe('文字の体裁', () => {
  it('斜体と太字をキャンバスの font 指定へ並べる', () => {
    expect(canvasFont(style, 96)).toBe(`bold 96px ${TEXT_FONTS.rounded.stack}`)
    expect(canvasFont({ ...style, italic: true }, 96)).toBe(`italic bold 96px ${TEXT_FONTS.rounded.stack}`)
    expect(canvasFont({ ...style, bold: false }, 96)).toBe(`96px ${TEXT_FONTS.rounded.stack}`)
  })

  it('どの書体も総称ファミリで閉じる (端末に無くても着地する)', () => {
    for (const font of Object.values(TEXT_FONTS)) {
      expect(font.stack).toMatch(/(sans-serif|serif|monospace)$/)
    }
  })

  it('箱の高さは行数とフォントサイズだけで決まる', () => {
    expect(measureTextBox(style, 0.4).height).toBeCloseTo(0.4 * TEXT_LINE_HEIGHT)
    expect(measureTextBox({ ...style, text: 'a\nb\nc' }, 0.4).height).toBeCloseTo(0.4 * TEXT_LINE_HEIGHT * 3)
  })

  it('箱の幅はいちばん長い行から決まり、フォントサイズに比例する', () => {
    const short = measureTextBox(style, 0.4).width
    const long = measureTextBox({ ...style, text: 'Lamp\nLamplighter' }, 0.4).width
    expect(long).toBeGreaterThan(short)
    expect(measureTextBox(style, 0.8).width).toBeCloseTo(short * 2)
  })

  it('空文字でも潰れない箱を返す', () => {
    const box = measureTextBox({ ...style, text: '' }, 0.4)
    expect(box.width).toBeGreaterThan(0)
    expect(box.height).toBeGreaterThan(0)
  })
})
