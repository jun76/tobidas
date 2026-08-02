import { describe, expect, it } from 'vitest'
import { createStageElement } from '../schema/bookDefaults'
import { assetKindForMode, parentForPreset, PART_PRESETS, presetForElement } from './presets'

describe('投入元プリセット', () => {
  it('姿勢や機構を変更しても保存された投入元を保つ', () => {
    const element = createStageElement('image', { type: 'right-page' }, 'page-glue')
    element.sourcePreset = 'paper-stack'
    element.baseTransform.rotation = [0, 0, 0]
    element.stow.mechanism = 'flap'

    expect(presetForElement(element)?.id).toBe('paper-stack')
  })

  it('個別作成部品をプリセットとして推定しない', () => {
    const element = createStageElement('image', { type: 'right-page' }, 'page-glue')
    expect(element.sourcePreset).toBe('custom')
    expect(presetForElement(element)).toBeUndefined()
  })

  it('背景は選択中の片面へだけ追加する', () => {
    const background = PART_PRESETS.find((preset) => preset.id === 'depth-layer')!
    expect(parentForPreset(background)).toEqual({ type: 'right-page' })
    expect(parentForPreset(background, 'left')).toEqual({ type: 'left-page' })
    expect(parentForPreset(background, 'right')).toEqual({ type: 'right-page' })
  })

  it('テキストは紙面接着の文字部品として選択中の片面へ入る', () => {
    const text = PART_PRESETS.find((preset) => preset.id === 'page-text')!
    expect(text.type).toBe('text')
    expect(text.mechanism).toBe('page-glue')
    expect(parentForPreset(text, 'left')).toEqual({ type: 'left-page' })
  })

  it('空中プリセットは見開き空間へ自動機構で置く', () => {
    const floating = PART_PRESETS.find((preset) => preset.id === 'floating-character')!
    expect(parentForPreset(floating, 'left')).toEqual({ type: 'spread' })
    expect(floating.mechanism).toBe('auto')
  })
})

describe('掴めるアセットの種類', () => {
  it('画像プリセットは画像だけ、効果音は音声だけを掴む', () => {
    expect(assetKindForMode('paper-stack')).toBe('image')
    expect(assetKindForMode('floating-character')).toBe('image')
    expect(assetKindForMode('sound-cue')).toBe('audio')
  })

  it('アセットを要さないプリセットと未選択は何も掴まない', () => {
    expect(assetKindForMode('light-particles')).toBe(null)
    expect(assetKindForMode('page-text')).toBe(null)
    expect(assetKindForMode(null)).toBe(null)
  })
})
