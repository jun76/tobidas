import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createBook, createSpread, createStageElement } from '../schema/bookDefaults'
import { makeMechanism } from '../schema/mechanism'
import type { AssemblyElement } from '../schema/stageElement'
import { evaluateAssemblyScene } from '../runtime/mechanisms/scene'
import { containerElementIds, elementDescendantIds, reparentElement } from './hierarchy'

describe('階層ツリーの部品移動', () => {
  it('左右の紙面を移動しても開いた状態のワールド位置を保つ', () => {
    const spread = createSpread()
    const element = createStageElement('visual', { type: 'left-page' })
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
    const parent = createStageElement('group', { type: 'right-page' })
    parent.baseTransform.position = [2, 1, 0]
    parent.baseTransform.rotation = [0, 0, 20]
    const child = createStageElement('visual', { type: 'right-page' })
    child.baseTransform.position = [-1, 0.5, 0]
    spread.elements.push(parent, child)

    expect(reparentElement(spread, child.id, { type: 'element', elementId: parent.id }, 8)).toBe(true)
    expect(child.parent).toEqual({ type: 'element', elementId: parent.id })
    expect(reparentElement(spread, parent.id, { type: 'element', elementId: child.id }, 8)).toBe(false)
    expect(parent.parent).toEqual({ type: 'right-page' })
  })

  it('子孫を末端まで列挙する', () => {
    const spread = createSpread()
    const parent = createStageElement('group', { type: 'right-page' })
    const child = createStageElement('group', { type: 'element', elementId: parent.id })
    const grandchild = createStageElement('visual', { type: 'element', elementId: child.id })
    const sibling = createStageElement('visual', { type: 'right-page' })
    spread.elements.push(parent, child, grandchild, sibling)

    expect(elementDescendantIds(spread, parent.id)).toEqual(new Set([child.id, grandchild.id]))
  })

  it('紙面直下から連なる全要素を列挙する', () => {
    const spread = createSpread()
    const leftRoot = createStageElement('group', { type: 'left-page' })
    const leftChild = createStageElement('visual', { type: 'element', elementId: leftRoot.id })
    const rightRoot = createStageElement('visual', { type: 'right-page' })
    spread.elements.push(leftRoot, leftChild, rightRoot)

    expect(containerElementIds(spread, 'left-page')).toEqual(new Set([leftRoot.id, leftChild.id]))
    expect(containerElementIds(spread, 'right-page')).toEqual(new Set([rightRoot.id]))
  })

  it('ブリッジ上の部品の面から子を外しても、描画されていた全開位置を保つ', () => {
    const book = createBook(), spread = book.spreads[0]
    const base = createStageElement('assembly') as AssemblyElement
    base.mechanism = makeMechanism('platform', { parameters: { width: 6, height: 1, depth: 4 } })
    const tier = createStageElement('assembly', { type: 'element', elementId: base.id }) as AssemblyElement
    tier.mechanism = makeMechanism('box', { parameters: { width: 3, height: 1.2, depth: 2 }, mount: { type: 'bridge', elementId: base.id, bridgeId: 'deck', v: .7 } })
    const child = createStageElement('visual', { type: 'element', elementId: tier.id })
    child.surfaceAttachment = { surfaceId: 'top-right', u: .3, v: .6, offset: .01 }
    child.baseTransform.position = [.1, .2, .3]
    spread.elements = [base, tier, child]
    const scene = evaluateAssemblyScene(book, spread, { open: 1, leftAngle: Math.PI, rightAngle: 0, clock: 0, spreadTime: 0 })
    const world = scene.visuals.find((entry) => entry.element.id === child.id)!.matrix
    const expected = new THREE.Vector3().setFromMatrixPosition(world)
    expect(expected.y).toBeGreaterThan(2)
    expect(reparentElement(spread, child.id, { type: 'left-page' }, book.format.pageWidth)).toBe(true)
    expect(child.surfaceAttachment).toBeUndefined()
    const actual = new THREE.Vector3(...child.baseTransform.position).add(new THREE.Vector3(-book.format.pageWidth / 2, 0, 0))
    expect(actual.distanceTo(expected)).toBeLessThan(1e-8)
  })
})
