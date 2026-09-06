import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createBook, createSpread, createStageElement } from '../../schema/bookDefaults'
import { makeMechanism } from '../../schema/mechanism'
import type { AssemblyElement } from '../../schema/stageElement'
import { evaluateAssemblyScene, assemblySceneBounds } from './scene'

const input = { open: 1, leftAngle: Math.PI, rightAngle: 0, spreadTime: 0, clock: 0 }
function fixture() {
  const parent = createStageElement('assembly', { type: 'right-page' }) as AssemblyElement
  parent.mechanism = makeMechanism('platform', { mount: { type: 'space' }, deployment: { mode: 'virtual' },
    parameters: { width: 4, height: 1, depth: 2 }, staging: { closedScale: .25 } })
  const child = createStageElement('visual', { type: 'element', elementId: parent.id })
  child.baseTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
  child.surfaceAttachment = { surfaceId: 'top', u: .75, v: .5, offset: .01 }
  const spread = createSpread('面の子', { elements: [parent, child] })
  return { parent, child, spread, book: createBook({ spreads: [spread] }) }
}

describe('複合面の描画評価', () => {
  it('全体の縮小を面上の子へ一度だけ適用し、全開の寸法を保つ', () => {
    const { book, spread, parent } = fixture()
    parent.baseTransform.scale = [2, 2, 2]
    const full = evaluateAssemblyScene(book, spread, input)
    const childScale = new THREE.Vector3().setFromMatrixScale(full.visuals[0].matrix)
    expect(childScale.toArray()).toEqual([2, 2, 2])
    expect(new THREE.Vector3().setFromMatrixPosition(full.visuals[0].matrix).y).toBeCloseTo(2.02)
    const half = evaluateAssemblyScene(book, spread, { ...input, open: .5, rightAngle: Math.PI / 2 })
    const halfScale = new THREE.Vector3().setFromMatrixScale(half.visuals[0].matrix)
    const parentScale = new THREE.Vector3().setFromMatrixScale(half.surfaces[0].matrix)
    expect(halfScale.x / parentScale.x).toBeCloseTo(1)
    expect(halfScale.y).toBeCloseTo(halfScale.x)
    expect(halfScale.z).toBeCloseTo(halfScale.x)
  })

  it('支持面を隠してもその面への取り付けと子の描画を維持する', () => {
    const { book, spread, parent } = fixture()
    parent.mechanism.surfaces.top = { color: '#ffffff', visible: false }
    const scene = evaluateAssemblyScene(book, spread, input)
    expect(scene.surfaces.some((surface) => surface.surface.id === 'top')).toBe(false)
    expect(scene.visuals).toHaveLength(1)
    expect(scene.diagnostics.filter((text) => text.includes('surface'))).toEqual([])
  })

  it('初期非表示でもタイムラインで表示でき、同じ時刻は呼び順に依存しない', () => {
    const { book, spread, parent } = fixture()
    parent.visible = false
    spread.timeline.tracks.push({ id: 'visibility', target: { type: 'element', elementId: parent.id }, property: 'visible',
      keys: [{ id: 'visible', time: 1, value: true, ease: 'hold' }] })
    const a = evaluateAssemblyScene(book, spread, { ...input, spreadTime: 2 })
    expect(a.surfaces.length).toBeGreaterThan(0)
    evaluateAssemblyScene(book, spread, { ...input, open: .3, clock: 19 })
    expect(assemblySceneBounds(evaluateAssemblyScene(book, spread, { ...input, spreadTime: 2 }))).toEqual(assemblySceneBounds(a))
  })

  it('面上groupの子孫を描画し、非表示と不透明度を階層に沿って継承する', () => {
    const { book, spread, parent, child } = fixture()
    const group = createStageElement('group', { type: 'element', elementId: parent.id })
    group.baseTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    group.surfaceAttachment = child.surfaceAttachment
    group.opacity = .4
    child.parent = { type: 'element', elementId: group.id }
    delete child.surfaceAttachment
    spread.elements.push(group)
    const scene = evaluateAssemblyScene(book, spread, input)
    expect(scene.visuals.map((entry) => entry.element.id)).toEqual([child.id])
    expect(scene.visuals[0].opacity).toBeCloseTo(.4)
    group.visible = false
    expect(evaluateAssemblyScene(book, spread, input).visuals).toHaveLength(0)
    expect(evaluateAssemblyScene(book, spread, { ...input, open: 0 }).surfaces).toHaveLength(0)
  })
})
