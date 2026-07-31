import { describe, expect, it } from 'vitest'
import { createBookProject, createSpread } from '../schema/bookDefaults'
import { compileBookBeats, playbackDurationSeconds } from './signals'
import { crossedSoundCues, soundCueAssetIds } from './soundCues'

/** 保持区間の seconds 秒に効果音キューを1つ持つ作品 */
function bookWithCue(seconds: number, spreadIndex = 0) {
  const project = createBookProject('cue')
  project.book.spreads.push(createSpread('2枚目'))
  const spread = project.book.spreads[spreadIndex]
  spread.timeline.tracks.push({
    id: 'track-cue',
    target: { type: 'sound', assetId: 'step.wav' },
    property: 'cue',
    keys: [{ id: 'key', time: seconds, value: true, ease: 'hold' }],
  })
  return project.book
}

/** キューの作品進行 */
function cueProgress(book: ReturnType<typeof bookWithCue>, seconds: number, spreadIndex = 0) {
  const spread = book.spreads[spreadIndex]
  const hold = compileBookBeats(book).find((beat) => beat.kind === 'hold' && beat.spreadId === spread.id)!
  return (hold.startSeconds + seconds) / playbackDurationSeconds(book)
}

describe('効果音の跨ぎ判定', () => {
  it('前へ連続再生してキューを跨いだときに一度だけ鳴る', () => {
    const book = bookWithCue(1)
    const at = cueProgress(book, 1)
    expect(crossedSoundCues(book, at - 0.001, at + 0.001)).toEqual([
      expect.objectContaining({ assetId: 'step.wav' }),
    ])
  })

  it('同じ区間をもう一度通らない限り鳴らない', () => {
    const book = bookWithCue(1)
    const at = cueProgress(book, 1)
    expect(crossedSoundCues(book, at + 0.001, at + 0.002)).toEqual([])
  })

  /** 音は冪等でない。姿勢と同じ規則で扱うと、スクラブのたびに鳴ってしまう */
  it('逆再生では鳴らさない', () => {
    const book = bookWithCue(1)
    const at = cueProgress(book, 1)
    expect(crossedSoundCues(book, at + 0.001, at - 0.001)).toEqual([])
  })

  it('つまみを飛ばしたときは鳴らさない', () => {
    const book = bookWithCue(1)
    const at = cueProgress(book, 1)
    expect(crossedSoundCues(book, 0, at + 0.001)).toEqual([])
  })

  it('止まっているときは鳴らさない', () => {
    const book = bookWithCue(1)
    const at = cueProgress(book, 1)
    expect(crossedSoundCues(book, at, at)).toEqual([])
  })

  it('別の見開きのキューは、その見開きの保持区間で鳴る', () => {
    const book = bookWithCue(0.5, 1)
    const at = cueProgress(book, 0.5, 1)
    expect(crossedSoundCues(book, at - 0.001, at + 0.001)).toHaveLength(1)
    // 1枚目の保持区間を通っても鳴らない
    const first = cueProgress(book, 0.5, 0)
    expect(crossedSoundCues(book, first - 0.001, first + 0.001)).toEqual([])
  })

  it('一度に複数を跨いだら進行順に並べて返す', () => {
    const book = bookWithCue(1)
    const spread = book.spreads[0]
    spread.timeline.tracks.push({
      id: 'track-cue-2',
      target: { type: 'sound', assetId: 'bell.wav' },
      property: 'cue',
      keys: [{ id: 'key-2', time: 1.02, value: true, ease: 'hold' }],
    })
    const from = cueProgress(book, 0.99)
    const to = cueProgress(book, 1.03)
    expect(crossedSoundCues(book, from, to).map((hit) => hit.assetId)).toEqual(['step.wav', 'bell.wav'])
  })

  it('使っている音源を先読みのために集める', () => {
    expect(soundCueAssetIds(bookWithCue(1))).toEqual(['step.wav'])
  })
})
