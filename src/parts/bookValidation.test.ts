import { describe, expect, it, vi } from 'vitest'
import { createBookProject, createSpread, createStageElement } from '../schema/bookDefaults'
import { connectedContentSchema } from '../schema/content'
import { bindBookContents, contentAsStage, evaluateContents } from './contents'
import { bookContentHoldTime, evaluateBookParts, validateBookParts } from './book'
import { inspectContentIntersections } from './contentValidation'
import { pagePorts } from './geometry'
import { compileBookBeats, evaluateBookSignals } from '../runtime/signals'
import * as evaluation from './evaluate'

describe('見開きごとの検査結果の再利用', () => {
  it('複製された同じ設計だけを再利用し、基準点と本の寸法の変更を再検査する', () => {
    const project = createBookProject(), spread = project.book.spreads[0]
    spread.elements = [contentAsStage(connectedContentSchema.parse({ ...createStageElement('visual'),
      attachment: { type: 'surface', surface: { nodeId: '$book', portId: 'right-page' }, point: [4, 1], side: 'front' },
      presentation: { kind: 'decal' }, width: 1, height: 1, billboard: false, motion: [],
      baseTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }))]
    const evaluate = vi.spyOn(evaluation, 'evaluatePartGraph')
    try {
      expect(validateBookParts(project)).toEqual([])
      expect(evaluate).toHaveBeenCalled()
      evaluate.mockClear()
      expect(validateBookParts(structuredClone(project))).toEqual([])
      expect(evaluate).not.toHaveBeenCalled()
      const changed = structuredClone(project), attachment = changed.book.spreads[0].elements[0].attachment!
      if (attachment.type === 'surface') attachment.point = [100, 1]
      expect(validateBookParts(changed).some((message) => message.includes('outside material'))).toBe(true)
      expect(evaluate).toHaveBeenCalled()
      evaluate.mockClear()
      expect(validateBookParts(project)).toEqual([])
      expect(evaluate).not.toHaveBeenCalled()
      project.book.format.pageWidth = 2
      expect(validateBookParts(project).some((message) => message.includes('outside material'))).toBe(true)
      expect(evaluate).toHaveBeenCalled()
    } finally { evaluate.mockRestore() }
  })
})

describe('本の進行と接続演出の検査時刻', () => {
  it('順逆のページめくりでも保持時計を再生器と同じ冒頭・末尾へ固定する', () => {
    const project = createBookProject(), book = project.book
    book.spreads.push(createSpread('second'))
    const beats = compileBookBeats(book)
    const progress = beats.flatMap((beat) => [.1, .5, .9].map((t) => beat.start + (beat.end - beat.start) * t))
    for (const p of [...progress, ...[...progress].reverse()]) {
      const signals = evaluateBookSignals(book, p)
      for (const [i, spread] of book.spreads.entries()) {
        const angle = signals.dihedrals[i] * 180 / Math.PI
        const side = signals.sheetAngles[i] < 1 ? 'left' : 'right'
        const time = bookContentHoldTime(angle, side, spread.sequence.holdSeconds)
        if (angle < 180 - 1e-8) expect(time).toBe(signals.spreadTimes[i])
        else expect(time).toBeUndefined()
      }
    }
  })

  it('保持中だけ谷を越える演出を許可し、開閉中に実際に表示される貫通は拒否する', () => {
    const project = createBookProject(), spread = project.book.spreads[0], hold = spread.sequence.holdSeconds
    const train = connectedContentSchema.parse({ ...createStageElement('visual'), id: 'train', width: 1, height: .8,
      attachment: { type: 'surface', surface: { nodeId: '$book', portId: 'left-page' }, point: [3.2, .1], side: 'back' },
      presentation: { kind: 'fiction', closing: 'shrink-to-anchor' },
      baseTransform: { position: [0, -2, .01], rotation: [90, -90, 0], scale: [1, 1, 1] } })
    spread.elements = [contentAsStage(train)]
    spread.timeline.tracks = [{ id: 'pass', target: { type: 'element', elementId: train.id }, property: 'visible',
      keys: [[0, false], [.2, true], [hold - .2, false]].map(([time, value], i) => ({ id: String(i), time: time as number, value: value as boolean, ease: 'hold' })) }]
    const angle = 175, left = angle * Math.PI / 180
    const result = evaluateBookParts(project, spread, left, 0)
    const bindings = bindBookContents(project, spread, result, left, 0)
    const mid = evaluateContents(bindings, { openingAngleDeg: angle, maxOpeningAngleDeg: 180, holdTime: hold / 2, clock: () => 0 })
    // 開き途中と中盤時刻を独立に組み合わせると、実際にはない貫通を作ってしまう。
    const page = pagePorts(8, 6.4, left, 0)['right-page']
    if (page.kind !== 'surface') throw new Error('Expected a page surface')
    expect(inspectContentIntersections(mid, [page.face]).length).toBeGreaterThan(0)
    expect(validateBookParts(project)).toEqual([])
    spread.timeline.tracks = []
    expect(validateBookParts(project)).toContainEqual(expect.stringContaining('Content crosses paper: train'))
  })
})
