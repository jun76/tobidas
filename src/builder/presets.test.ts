import { describe, expect, it } from 'vitest'
import { assetKindForMode, PART_PRESETS } from './presets'

describe('部品プリセット', () => {
  it('ビジュアルの作成ショートカットだけを持ち、空中プリセットを持たない', () => {
    expect(PART_PRESETS.every((preset) => preset.group === 'visual')).toBe(true)
    expect(PART_PRESETS.map((preset) => preset.id)).not.toContain('floating-character')
  })

  it('画像を要するショートカットだけ画像を掴む', () => {
    expect(assetKindForMode('paper-stack')).toBe('image')
    expect(assetKindForMode('bottom-upright')).toBe('image')
    expect(assetKindForMode('depth-layer')).toBe('image')
    expect(assetKindForMode('light-particles')).toBe(null)
    expect(assetKindForMode('page-text')).toBe(null)
    expect(assetKindForMode('sound-cue')).toBe('audio')
  })
})
