import { describe, expect, it } from 'vitest'
import { createBook, createStageElement } from '../../schema/bookDefaults'
import type { TimelineTrack } from '../../schema/timeline'
import { evaluateElementTimeline, evaluateTimelineTrack } from './evaluate'

const track = (property: TimelineTrack['property'], values: Array<[number, TimelineTrack['keys'][number]['value']]>, ease: TimelineTrack['keys'][number]['ease'] = 'linear'): TimelineTrack => ({
  id: `track-${property}`,
  target: { type: 'element', elementId: 'subject' },
  property,
  keys: values.map(([time, value], index) => ({ id: `key-${index}`, time, value, ease })),
})

describe('オーサードタイムライン評価', () => {
  it('端点の外側では端の値を保持する', () => {
    const item = track('position.x', [[1, 10], [3, 30]])
    expect(evaluateTimelineTrack(item, 0)).toBe(10)
    expect(evaluateTimelineTrack(item, 4)).toBe(30)
  })

  it('前進と逆方向の評価で同じ値を返す', () => {
    const item = track('position.x', [[0, -2], [4, 6]], 'easeInOut')
    const forward = [0, 1, 2, 3, 4].map((time) => evaluateTimelineTrack(item, time))
    const reverse = [4, 3, 2, 1, 0].map((time) => evaluateTimelineTrack(item, time)).reverse()
    expect(reverse).toEqual(forward)
  })

  it('離散値は次のキーまで直前値を保持する', () => {
    const item = track('visible', [[0, false], [2, true]], 'hold')
    expect(evaluateTimelineTrack(item, 1.999)).toBe(false)
    expect(evaluateTimelineTrack(item, 2)).toBe(true)
  })

  it('回転は最短角で補間する', () => {
    const item = track('rotation.z', [[0, 350], [2, 10]])
    expect(Number(evaluateTimelineTrack(item, 1))).toBeCloseTo(360)
  })

  it('sRGB色を線形色空間で補間してsRGBへ戻す', () => {
    const item = track('effect.color', [[0, '#000000'], [2, '#ffffff']])
    expect(evaluateTimelineTrack(item, 1)).toBe('#bcbcbc')
  })

  it('要素の制作姿勢へトラック値を適用する', () => {
    const book = createBook()
    const element = createStageElement('image')
    element.id = 'subject'
    element.baseTransform.position[0] = 9
    book.spreads[0].elements.push(element)
    book.spreads[0].timeline.tracks = [
      track('position.x', [[0, -3], [2, 3]]),
      track('opacity', [[0, 0], [2, 1]]),
    ]
    const evaluated = evaluateElementTimeline(element, book.spreads[0], 1)
    expect(evaluated.baseTransform.position[0]).toBeCloseTo(0)
    expect(evaluated.type === 'image' && evaluated.opacity).toBeCloseTo(0.5)
    expect(element.baseTransform.position[0]).not.toBe(evaluated.baseTransform.position[0])
  })
})
