import { describe, expect, it } from 'vitest'
import { createSpread, createStageElement } from '../schema/bookDefaults'
import { containerElementIds, elementDescendantIds, reparentElement } from './hierarchy'

describe('階層ツリーの部品移動', () => {
  it('左右の紙面を移動しても開いた状態のワールド位置を保つ', () => {
    const spread = createSpread()
    const element = createStageElement('image', { type: 'left-page' })
    element.baseTransform.position = [1.25, 0.2, -0.5]
    spread.elements.push(element)

    expect(reparentElement(spread, element.id, { type: 'right-page' }, 8)).toBe(true)
    expect(element.parent).toEqual({ type: 'right-page' })
    expect(element.baseTransform.position[0]).toBeCloseTo(-6.75)
    expect(element.baseTransform.position[1]).toBeCloseTo(0.2)
    expect(element.baseTransform.position[2]).toBeCloseTo(-0.5)
  })

  it('別部品の子に移動しても姿勢を保ち、自分の子孫への移動は拒否する', () => {
    const spread = createSpread()
    const parent = createStageElement('group', { type: 'spread' })
    parent.baseTransform.position = [2, 1, 0]
    parent.baseTransform.rotation = [0, 0, 20]
    const child = createStageElement('image', { type: 'right-page' })
    child.baseTransform.position = [-1, 0.5, 0]
    spread.elements.push(parent, child)

    expect(reparentElement(spread, child.id, { type: 'element', elementId: parent.id }, 8)).toBe(true)
    expect(child.parent).toEqual({ type: 'element', elementId: parent.id })
    expect(reparentElement(spread, parent.id, { type: 'element', elementId: child.id }, 8)).toBe(false)
    expect(parent.parent).toEqual({ type: 'spread' })
  })

  it('子孫を末端まで列挙する', () => {
    const spread = createSpread()
    const parent = createStageElement('group', { type: 'spread' })
    const child = createStageElement('group', { type: 'element', elementId: parent.id })
    const grandchild = createStageElement('image', { type: 'element', elementId: child.id })
    const sibling = createStageElement('image', { type: 'right-page' })
    spread.elements.push(parent, child, grandchild, sibling)

    expect(elementDescendantIds(spread, parent.id)).toEqual(new Set([child.id, grandchild.id]))
  })

  it('紙面直下から連なる全要素を列挙する', () => {
    const spread = createSpread()
    const leftRoot = createStageElement('group', { type: 'left-page' })
    const leftChild = createStageElement('image', { type: 'element', elementId: leftRoot.id })
    const rightRoot = createStageElement('image', { type: 'right-page' })
    const spreadRoot = createStageElement('image', { type: 'spread' })
    spread.elements.push(leftRoot, leftChild, rightRoot, spreadRoot)

    expect(containerElementIds(spread, 'left-page')).toEqual(new Set([leftRoot.id, leftChild.id]))
    expect(containerElementIds(spread, 'right-page')).toEqual(new Set([rightRoot.id]))
    expect(containerElementIds(spread, 'spread')).toEqual(new Set([spreadRoot.id]))
  })
})
