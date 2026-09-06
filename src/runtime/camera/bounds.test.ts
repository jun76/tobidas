import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { createBook, createSpread, createStageElement } from '../../schema/bookDefaults'
import type { AssemblyElement, VisualElement } from '../../schema/stageElement'
import { makeMechanism } from '../../schema/mechanism'
import { assemblySceneBounds, evaluateAssemblyScene } from '../mechanisms/scene'
import * as assemblyScene from '../mechanisms/scene'
import { compileBookBeats } from '../signals'
import { spreadCameraBounds } from './bounds'
import { evaluateEditCameraPose, evaluatePlayCameraPose, fitCameraPoseToBounds } from './playCamera'

function platform(width = 24, height = 4): AssemblyElement {
  const element = createStageElement('assembly') as AssemblyElement
  const supportWidth = Math.min(width, 8)
  const openScale = width / supportWidth
  element.mechanism = makeMechanism('platform', { parameters: { width: supportWidth, height: height / openScale, depth: 5 / openScale },
    deployment: { mode: 'virtual' }, staging: { openScale, closedScale: .2 } })
  return element
}

function fullOpenScene(book: ReturnType<typeof createBook>, spread = book.spreads[0]) {
  return evaluateAssemblyScene(book, spread, { open: 1, leftAngle: Math.PI, rightAngle: 0, spreadTime: 0, clock: 0 })
}

describe('全開の複合部品を使う構図', () => {
  it('台、面上の入れ子、その上の人物まで全開境界に含める', () => {
    const book = createBook()
    const lower = platform()
    lower.mechanism.staging.openPosition = [-8, 6, 0]
    const upper = platform(7, 9)
    upper.parent = { type: 'element', elementId: lower.id }
    upper.mechanism.mount = { type: 'bridge', elementId: lower.id, bridgeId: 'deck', v: .5 }
    const person = createStageElement('visual', { type: 'element', elementId: upper.id }) as VisualElement
    person.baseTransform.rotation = [0, 0, 0]
    person.surfaceAttachment = { surfaceId: 'top', u: .5, v: .5, offset: 0 }
    person.height = 8
    book.spreads[0].elements = [lower, upper, person]

    const sceneBounds = assemblySceneBounds(fullOpenScene(book))
    const bounds = spreadCameraBounds(book, book.spreads[0])
    expect(bounds.containsBox(sceneBounds)).toBe(true)
    expect(bounds.max.y).toBeGreaterThan(25)
    expect(bounds.min.x).toBeLessThan(-16)
  })

  it('所属ページと通常の親子変換を含み、非表示部品は構図を広げない', () => {
    const book = createBook()
    const group = createStageElement('group', { type: 'left-page' })
    group.baseTransform.position = [-10, 0, 0]
    group.baseTransform.scale = [2, 2, 2]
    const child = createStageElement('visual', { type: 'element', elementId: group.id }) as VisualElement
    child.baseTransform.rotation = [0, 0, 0]
    child.width = 6
    child.height = 8
    const hidden = platform(160, 100)
    hidden.visible = false
    book.spreads[0].elements = [group, child, hidden]
    const bounds = spreadCameraBounds(book, book.spreads[0])
    expect(bounds.min.x).toBeCloseTo(-20)
    expect(bounds.max.y).toBeCloseTo(16.01)
    expect(bounds.max.x).toBe(8)
  })

  it('後から現れる拡大部品も先に囲み、保持中に再フィットしない', () => {
    const book = createBook()
    const stage = platform(72, 12)
    stage.visible = false
    const spread = book.spreads[0]
    spread.elements = [stage]
    spread.timeline.tracks = [{
      id: 'appear', target: { type: 'element', elementId: stage.id }, property: 'visible',
      keys: [{ id: 'hidden', time: 0, value: false, ease: 'linear' },
        { id: 'shown', time: spread.sequence.holdSeconds, value: true, ease: 'linear' }],
    }]
    const bounds = spreadCameraBounds(book, spread)
    expect(bounds.max.x).toBeGreaterThanOrEqual(36)
    const hold = compileBookBeats(book).find((beat) => beat.kind === 'hold')!
    expect(evaluatePlayCameraPose(book, hold.start + .001, 1.8)).toEqual(evaluatePlayCameraPose(book, hold.end, 1.8))
  })

  it('不変な作品の複製で境界を更新し、呼出し側のBox3変更をキャッシュへ戻さない', () => {
    const book = createBook()
    book.spreads[0].elements = [platform()]
    const bounds = spreadCameraBounds(book, book.spreads[0])
    bounds.max.x = 999
    expect(spreadCameraBounds(book, book.spreads[0]).max.x).toBe(12)
    const edited = structuredClone(book)
    ;(edited.spreads[0].elements[0] as AssemblyElement).mechanism.staging.openScale = 5
    expect(spreadCameraBounds(edited, edited.spreads[0]).max.x).toBe(20)
  })

  it('再生進行だけの更新では複合シーンを再評価せず、編集時に再計算する', () => {
    const book = createBook()
    book.spreads[0].elements = [platform(30, 12)]
    const evaluate = vi.spyOn(assemblyScene, 'evaluateAssemblyScene')
    try {
      evaluatePlayCameraPose(book, 0, 1.8)
      const initialEvaluations = evaluate.mock.calls.length
      expect(initialEvaluations).toBeGreaterThan(0)
      for (let frame = 1; frame <= 300; frame++) evaluatePlayCameraPose(book, frame / 300, 1.8)
      expect(evaluate.mock.calls).toHaveLength(initialEvaluations)
      evaluatePlayCameraPose(structuredClone(book), .5, 1.8)
      expect(evaluate.mock.calls.length).toBeGreaterThan(initialEvaluations)
    } finally {
      evaluate.mockRestore()
    }
  })
})

describe('機構に追いかけられない再生カメラ', () => {
  it('巨大台の全開頂点を横長と縦長の視野に収める', () => {
    const book = createBook()
    book.spreads[0].elements = [platform(30, 12)]
    const bounds = spreadCameraBounds(book, book.spreads[0])
    const hold = compileBookBeats(book).find((beat) => beat.kind === 'hold')!
    for (const aspect of [16 / 9, 9 / 16]) {
      const pose = evaluatePlayCameraPose(book, hold.start, aspect)
      const camera = new THREE.PerspectiveCamera(pose.fov, aspect, .3, 300)
      camera.position.set(...pose.position)
      camera.lookAt(...pose.target)
      camera.updateMatrixWorld()
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const point = new THREE.Vector3(x, y, z).project(camera)
          expect(Math.abs(point.x)).toBeLessThan(1)
          expect(Math.abs(point.y)).toBeLessThan(1)
          expect(point.z).toBeLessThan(1)
          expect(point.z).toBeGreaterThan(-1)
        }
      }
    }
  })

  it('同じ構図の開閉とページ送りで距離が膨らまない', () => {
    const book = createBook()
    book.spreads[0].elements = [platform()]
    book.spreads.push(createSpread('同じ構図', { elements: [platform()] }))
    const baseline = evaluatePlayCameraPose(book, .5, 1.8)
    for (const progress of [0, .03, .13, .31, .52, .59, .61, .67, .94, 1]) {
      expect(evaluatePlayCameraPose(book, progress, 1.8)).toEqual(baseline)
    }
  })

  it('構図が違うページ間は端点だけで補間し、途中で端点より遠ざからない', () => {
    const book = createBook()
    book.spreads[0].elements = [platform(18)]
    book.spreads.push(createSpread('巨大な舞台', { elements: [platform(50)] }))
    const turn = compileBookBeats(book).find((beat) => beat.kind === 'turn')!
    const from = evaluatePlayCameraPose(book, turn.start, 1.8)
    const to = evaluatePlayCameraPose(book, turn.end, 1.8)
    for (const t of [.1, .4, .5, .8, .95]) {
      const progress = turn.start + (turn.end - turn.start) * t
      const pose = evaluatePlayCameraPose(book, progress, 1.8)
      expect(pose.position[2]).toBeGreaterThanOrEqual(from.position[2])
      expect(pose.position[2]).toBeLessThanOrEqual(to.position[2])
      expect(evaluatePlayCameraPose(book, progress, 1.8)).toEqual(pose)
    }
  })

  it('巨大部品があっても明示カメラを変えず、次の自動構図は独立して評価する', () => {
    const book = createBook()
    book.spreads[0].elements = [platform(90, 40)]
    book.spreads[0].timeline.tracks = [{
      id: 'authored', target: { type: 'camera' }, property: 'position',
      keys: [{ id: 'key', time: 0, value: [0, 6, 9], ease: 'linear' }],
    }]
    book.spreads.push(createSpread('自動の巨大舞台', { elements: [platform(50)] }))
    const beats = compileBookBeats(book)
    const hold = beats.find((beat) => beat.kind === 'hold')!
    expect(evaluatePlayCameraPose(book, hold.end, 1.8).position).toEqual([0, 6, 9])
    const turn = beats.find((beat) => beat.kind === 'turn')!
    const arrival = evaluatePlayCameraPose(book, turn.end, 1.8)
    expect(arrival.position[2]).toBeGreaterThan(30)
    expect(arrival).toEqual(evaluatePlayCameraPose(book, turn.end + .001, 1.8))
  })

  it('編集用全体表示は全開境界へ注視し、保存カメラを書き換えない', () => {
    const book = createBook()
    const stage = platform(40, 20)
    stage.mechanism.staging.openPosition = [15, 10, 0]
    book.spreads[0].elements = [stage]
    const original = structuredClone(book.camera)
    const edit = evaluateEditCameraPose(book, book.spreads[0], 1.8)
    expect(edit.target).toEqual(spreadCameraBounds(book, book.spreads[0]).getCenter(new THREE.Vector3()).toArray())
    expect(book.camera).toEqual(original)
  })

  it('編集用全体表示で利用者が回り込んだ向きとFOVを保つ', () => {
    const book = createBook()
    book.spreads[0].elements = [platform(30, 9)]
    const view = { position: [12, 9, 4] as [number, number, number], target: [2, 1, 0] as [number, number, number], fov: 51 }
    const edit = evaluateEditCameraPose(book, book.spreads[0], 1.8, view)
    const before = new THREE.Vector3(...view.position).sub(new THREE.Vector3(...view.target)).normalize()
    const after = new THREE.Vector3(...edit.position).sub(new THREE.Vector3(...edit.target)).normalize()
    expect(before.distanceTo(after)).toBeLessThan(1e-10)
    expect(edit.fov).toBe(51)
  })

  it('注視点とカメラが重なっていても有限な代替距離を返す', () => {
    const box = new THREE.Box3(new THREE.Vector3(-8, 0, -4), new THREE.Vector3(8, 5, 4))
    const pose = fitCameraPoseToBounds({ position: [0, 0, 0], target: [0, 0, 0], fov: 42 }, box, 1.8)
    expect(pose.position.every(Number.isFinite)).toBe(true)
    expect(new THREE.Vector3(...pose.position).length()).toBeGreaterThan(10)
  })
})
