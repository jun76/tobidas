import { describe, expect, it } from 'vitest'
import { createSpread, createStageElement } from '../../schema/bookDefaults'
import { collectTimelineLanes } from './lanes'

describe('timeline lane model', () => {
  it('collects current visual tracks without coupling the renderer to schema lookup', () => {
    const spread = createSpread('lane')
    const element = createStageElement('image')
    element.name = '表紙の部品'
    spread.elements.push(element)
    spread.timeline.tracks.push({
      id: 'track-visible',
      target: { type: 'element', elementId: element.id },
      property: 'visible',
      keys: [{ id: 'key', time: 0, value: true, ease: 'hold' }],
    })
    expect(collectTimelineLanes(spread)).toEqual([expect.objectContaining({
      kind: 'visual',
      id: 'track-visible',
      targetName: '表紙の部品',
      discrete: true,
    })])
  })
})


describe('音声レーン', () => {
  it('効果音トラックは音源の名前で並び、点として扱う', () => {
    const spread = createSpread('cue')
    spread.timeline.tracks.push({
      id: 'track-cue',
      target: { type: 'sound', assetId: 'step.wav' },
      property: 'cue',
      keys: [{ id: 'key', time: 1.2, value: true, ease: 'hold' }],
    })
    const lanes = collectTimelineLanes(spread, [
      { id: 'step.wav', name: '足音', type: 'audio', mime: 'audio/wav', data: '' },
    ])
    expect(lanes).toEqual([expect.objectContaining({
      kind: 'sound',
      targetName: '足音',
      discrete: true,
    })])
  })
})
