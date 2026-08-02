import { describe, expect, it } from 'vitest'
import { createBookProject, createStageElement } from '../../schema/bookDefaults'
import type { Book, Spread } from '../../schema/book'
import type { StageElement } from '../../schema/stageElement'
import { analyzeSpreadContainment } from './containment'

/**
 * 開姿勢の包含検査。
 * 「紙の上にいるか」を、タイムラインとContent Motionを含めた実際の姿勢で見る。
 */

const book = (): Book => createBookProject('containment').book
const spreadOf = (source: Book): Spread => source.spreads[0]

type ImageElement = Extract<StageElement, { type: 'image' }>

function place(source: Book, build: (element: ImageElement) => void): StageElement {
  const element = createStageElement('image', { type: 'right-page' }, 'flap')
  if (element.type !== 'image') throw new Error('unreachable')
  element.width = 2
  element.height = 2
  element.pivot = [0.5, 0]
  element.baseTransform.position = [0, 0.01, 1]
  element.baseTransform.rotation = [0, 0, 0]
  build(element)
  spreadOf(source).elements.push(element)
  return element
}

const codes = (source: Book) => analyzeSpreadContainment(source, spreadOf(source)).errors.map((issue) => issue.code)
const warningCodes = (source: Book) => analyzeSpreadContainment(source, spreadOf(source)).warnings.map((issue) => issue.code)

describe('開姿勢の包含検査', () => {
  it('紙面に収まる立ち板は問題を報告しない', () => {
    const source = book()
    place(source, () => {})
    expect(codes(source)).toEqual([])
  })

  it('Pivotが板の中心のまま紙面へ置いた部品は紙をくぐる', () => {
    const source = book()
    place(source, (element) => {
      element.pivot = [0.5, 0.5]
      element.baseTransform.position = [0, 0.01, 1]
    })
    expect(codes(source)).toContain('below-paper')
  })

  it('接地線で左右へ倒す回転は下角が紙をくぐる', () => {
    const source = book()
    const element = place(source, () => {})
    spreadOf(source).timeline.tracks.push({
      id: 'tilt',
      target: { type: 'element', elementId: element.id },
      property: 'rotation.z',
      keys: [
        { id: 'tilt-0', time: 0, value: 0, ease: 'easeInOut' },
        { id: 'tilt-1', time: 1, value: -70, ease: 'easeInOut' },
      ],
    })
    expect(codes(source)).toContain('below-paper')
  })

  it('揺れの振幅ぶんも姿勢に数える', () => {
    const source = book()
    place(source, (element) => {
      element.width = 3
      element.motion = [{ type: 'sway', amplitude: 12, period: 3, phase: 0 }]
    })
    expect(codes(source)).toContain('below-paper')
  })

  it('紙へ糊付けした部品は背表紙を越えられない', () => {
    const source = book()
    const element = place(source, () => {})
    spreadOf(source).timeline.tracks.push({
      id: 'slide',
      target: { type: 'element', elementId: element.id },
      property: 'position.x',
      keys: [
        { id: 'slide-0', time: 0, value: 0, ease: 'easeInOut' },
        { id: 'slide-1', time: 1, value: -6, ease: 'easeInOut' },
      ],
    })
    expect(codes(source)).toContain('crosses-spine')
  })

  it('空中要素でも本の輪郭の外へは出られない', () => {
    const source = book()
    const element = place(source, (item) => {
      item.stow.mechanism = 'auto'
      item.baseTransform.position = [0, 1.5, 0]
      item.parent = { type: 'spread' }
    })
    spreadOf(source).timeline.tracks.push({
      id: 'fly',
      target: { type: 'element', elementId: element.id },
      property: 'position.x',
      keys: [
        { id: 'fly-0', time: 0, value: 0, ease: 'linear' },
        { id: 'fly-1', time: 1, value: 12, ease: 'linear' },
      ],
    })
    expect(codes(source)).toContain('off-page')
  })

  it('非表示の区間は姿勢を問わない', () => {
    const source = book()
    const element = place(source, (item) => {
      item.visible = false
      item.baseTransform.position = [0, -3, 1]
    })
    void element
    expect(codes(source)).toEqual([])
  })

  it('収納時に縮小しないと畳めない立ち板を検出する', () => {
    const source = book()
    place(source, (element) => {
      // 手前ぎりぎりに接地させた背の高い板は、どちらへ倒しても紙面から出る
      element.height = 6
      element.baseTransform.position = [0, 0.01, 0]
    })
    expect(codes(source)).not.toContain('shrunk-to-fit')
    expect(warningCodes(source)).toContain('shrunk-to-fit')
  })
})
