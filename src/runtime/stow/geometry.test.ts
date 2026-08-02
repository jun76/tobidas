import { describe, expect, it } from 'vitest'
import { createSpread, createStageElement } from '../../schema/bookDefaults'
import { childrenByParent, constrainAbovePaper, pageAnchorX, spreadOpenBounds, updatePageOwnership } from './geometry'

describe('開姿勢の床とページ所有', () => {
  it('回転後の矩形下端が紙面を抜けると、部品ツリーを真上へ戻す', () => {
    const spread = createSpread()
    const element = createStageElement('visual', { type: 'right-page' })
    element.pivot = [.5, .5]
    element.baseTransform.position = [0, -.4, 0]
    element.baseTransform.rotation = [0, 0, 25]
    spread.elements.push(element)
    const children = childrenByParent(spread)

    expect(constrainAbovePaper(element, children, 8)).toBeGreaterThan(0)
    expect(spreadOpenBounds(element, children, 8).min[1]).toBeCloseTo(0)
  })

  it('中央線を越えたルートの所属ページを、開姿勢を保ったまま切り替える', () => {
    const spread = createSpread()
    const element = createStageElement('visual', { type: 'right-page' })
    element.baseTransform.position[0] = -5
    spread.elements.push(element)
    const children = childrenByParent(spread)
    const before = pageAnchorX(element.parent, 8) + element.baseTransform.position[0]

    expect(updatePageOwnership(element, children, 8)).toBe(true)
    expect(element.parent).toEqual({ type: 'left-page' })
    expect(pageAnchorX(element.parent, 8) + element.baseTransform.position[0]).toBeCloseTo(before)
  })

  it('中央線付近のヒステリシス内では現在の所属を保つ', () => {
    const spread = createSpread()
    const element = createStageElement('visual', { type: 'right-page' })
    if (element.type !== 'visual') throw new Error('unreachable')
    element.width = .001
    element.baseTransform.position[0] = -4
    spread.elements.push(element)

    expect(updatePageOwnership(element, childrenByParent(spread), 8)).toBe(false)
    expect(element.parent).toEqual({ type: 'right-page' })
  })
})
