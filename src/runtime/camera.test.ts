import { describe, expect, it } from 'vitest'
import { createBook, createSpread } from '../schema/bookDefaults'
import { compileBookBeats } from './signals'
import { evaluateTimelineCamera, evaluateTimelineEnvironment } from './camera'
import { evaluatePlayCameraPose } from './camera/playCamera'
import { VIEW_CLIP, VIEW_GL } from './camera/view'

describe('見開きタイムラインのカメラ', () => {
  it('保持区間で見開きローカル時刻を評価する', () => {
    const book = createBook()
    const spread = book.spreads[0]
    spread.sequence.holdSeconds = 4
    spread.timeline.tracks = [{
      id: 'camera-position',
      target: { type: 'camera' },
      property: 'position',
      keys: [
        { id: 'a', time: 0, value: [0, 5, 12], ease: 'linear' },
        { id: 'b', time: 4, value: [4, 7, 15], ease: 'linear' },
      ],
    }]
    const hold = compileBookBeats(book).find((beat) => beat.kind === 'hold')!
    const pose = evaluateTimelineCamera(book, (hold.start + hold.end) / 2)
    expect(pose.position).toEqual([2, 6, 13.5])
  })

  /**
   * 表紙を開く区間は見開きローカル時刻がまだ 0 のまま進まない。姿勢まで止めると
   * 開き終わるまで最初の構えに張りつき、飛び出す前の紙面を見せてしまう。
   */
  it('表紙を開く間に保存カメラから見開き先頭の姿勢へ寄る', () => {
    const book = createBook()
    book.camera.position = [0, 10, 20]
    book.spreads[0].timeline.tracks = [
      cameraPosition('first', [0, 2, 12], [0, 2, 12], book.spreads[0].sequence.holdSeconds),
    ]
    const open = compileBookBeats(book).find((beat) => beat.kind === 'cover-open')!
    const early = evaluateTimelineCamera(book, open.start + (open.end - open.start) * 0.05)
    const late = evaluateTimelineCamera(book, open.start + (open.end - open.start) * 0.95)
    expect(early.position[1]).toBeGreaterThan(late.position[1])
    expect(late.position[1]).toBeCloseTo(2, 0)
  })

  it('ページ送り中に送り元終端から送り先始端へ補間する', () => {
    const book = createBook()
    book.spreads.push(createSpread('次'))
    book.spreads[0].timeline.tracks = [cameraPosition('first', [0, 5, 12], [2, 5, 12], book.spreads[0].sequence.holdSeconds)]
    book.spreads[1].timeline.tracks = [cameraPosition('next', [8, 5, 12], [10, 5, 12], book.spreads[1].sequence.holdSeconds)]
    const turn = compileBookBeats(book).find((beat) => beat.kind === 'turn')!
    const pose = evaluateTimelineCamera(book, (turn.start + turn.end) / 2)
    expect(pose.position[0]).toBeCloseTo(5)
  })

  it('環境色を見開き間で連続補間する', () => {
    const book = createBook()
    book.spreads.push(createSpread('次'))
    book.spreads[0].timeline.tracks = [colorTrack('a', '#000000')]
    book.spreads[1].timeline.tracks = [colorTrack('b', '#ffffff')]
    const turn = compileBookBeats(book).find((beat) => beat.kind === 'turn')!
    const state = evaluateTimelineEnvironment(book, (turn.start + turn.end) / 2)
    expect(state.background).not.toBe('#000000')
    expect(state.background).not.toBe('#ffffff')
  })
})

describe('視錐台と深度バッファ', () => {
  /**
   * 対数深度バッファはシェーダから gl_FragDepth を書くので polygonOffset が無効になる。
   * 紙面へ寝かせた部品は紙と同一平面にいて、前後を支えているのは layerDepthBias の
   * polygonOffset だけ。有効にすると開き始めと閉じ際に寝た部品が紙へ埋もれて消える。
   */
  it('対数深度バッファを使わない', () => {
    expect(VIEW_GL.logarithmicDepthBuffer).toBe(false)
  })

  /**
   * 線形深度の分解能はおよそ 距離² / near × 2⁻²⁴。紙どうしの隙間 (pageThickness/2) を
   * 割ると表紙と紙面がちらつく。既定の紙で、実用の視距離まで割らないことを確かめる。
   */
  it('実用の視距離で紙の隙間を割らない', () => {
    const gap = createBook().format.pageThickness / 2
    const resolution = (distance: number) => (distance ** 2 / VIEW_CLIP.near) * 2 ** -24
    expect(resolution(15)).toBeLessThan(gap / 10)
    expect(resolution(90)).toBeLessThan(gap)
    expect(resolution(200)).toBeLessThan(gap * 1.1)
  })
})

describe('再生カメラの構図', () => {
  it('縦長画面ではカメラ距離を広げる', () => {
    const book = createBook()
    const landscape = evaluatePlayCameraPose(book, .5, 16 / 9)
    const portrait = evaluatePlayCameraPose(book, .5, 9 / 16)
    expect(portrait.position[1]).toBeGreaterThan(landscape.position[1])
    expect(portrait.position[2]).toBeGreaterThan(landscape.position[2])
    expect(portrait.target).toEqual(landscape.target)
  })

  it('カメラキーのある見開きは画面の縦横比によらず保存値をそのまま使う', () => {
    const book = createBook()
    const spread = book.spreads[0]
    spread.timeline.tracks = [
      cameraPosition('position', [1, 6, 9], [1, 6, 9], spread.sequence.holdSeconds),
      {
        id: 'target',
        target: { type: 'camera' as const },
        property: 'target' as const,
        keys: [{ id: 'target-key', time: 0, value: [0, 1, 0] as [number, number, number], ease: 'linear' as const }],
      },
    ]
    const hold = compileBookBeats(book).find((beat) => beat.kind === 'hold')!
    for (const aspect of [16 / 9, 1, 9 / 16]) {
      const pose = evaluatePlayCameraPose(book, (hold.start + hold.end) / 2, aspect)
      expect(pose.position).toEqual([1, 6, 9])
      expect(pose.target).toEqual([0, 1, 0])
    }
  })

  it('カメラトラックのFOVを維持する', () => {
    const book = createBook()
    book.spreads[0].timeline.tracks = [{
      id: 'fov',
      target: { type: 'camera' },
      property: 'fov',
      keys: [{ id: 'fov-key', time: 0, value: 58, ease: 'linear' }],
    }]
    const hold = compileBookBeats(book).find((beat) => beat.kind === 'hold')!
    expect(evaluatePlayCameraPose(book, hold.start, 1).fov).toBe(58)
  })
})

function cameraPosition(id: string, start: [number, number, number], end: [number, number, number], time: number) {
  return {
    id,
    target: { type: 'camera' as const },
    property: 'position' as const,
    keys: [
      { id: `${id}-a`, time: 0, value: start, ease: 'linear' as const },
      { id: `${id}-b`, time, value: end, ease: 'linear' as const },
    ],
  }
}

function colorTrack(id: string, value: string) {
  return {
    id,
    target: { type: 'environment' as const },
    property: 'background' as const,
    keys: [{ id: `${id}-key`, time: 0, value, ease: 'linear' as const }],
  }
}
