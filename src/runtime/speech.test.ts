import { describe, expect, it } from 'vitest'
import { createBookProject, createSpread, createStageElement } from '../schema/bookDefaults'
import { compileBookBeats, playbackDurationSeconds } from './signals'
import { crossedSpeechCues, hasSpeechCues, spreadSpeechCues } from './speech'

/** 1枚目に読み上げ指定の本文を持つ作品 */
function bookWithSpeech(speech: 'ja' | 'en' | 'none', text = 'こんにちは') {
  const project = createBookProject('speech')
  project.book.spreads.push(createSpread('2枚目'))
  const spread = project.book.spreads[0]
  const element = createStageElement('visual', { type: 'left-page' })
  if (element.type !== 'visual') throw new Error('unexpected element type')
  element.text = text; element.speech = speech
  spread.elements.push(element)
  return project.book
}

function holdStart(book: ReturnType<typeof bookWithSpeech>, spreadIndex = 0) {
  const spread = book.spreads[spreadIndex]
  const hold = compileBookBeats(book).find((beat) => beat.kind === 'hold' && beat.spreadId === spread.id)!
  return hold.startSeconds / playbackDurationSeconds(book)
}

describe('本文の読み上げの跨ぎ判定', () => {
  it('見開きが開き切った瞬間を跨いだときに本文を言語付きで返す', () => {
    const book = bookWithSpeech('ja')
    const at = holdStart(book)
    expect(crossedSpeechCues(book, at - 0.001, at + 0.001)).toEqual([expect.objectContaining({ text: 'こんにちは', lang: 'ja-JP' })])
    expect(crossedSpeechCues(bookWithSpeech('en', 'Hello'), at - 0.001, at + 0.001)[0].lang).toBe('en-US')
  })

  it('読み上げなし・空文・逆行・飛ばしでは返さない', () => {
    const at = holdStart(bookWithSpeech('ja'))
    expect(crossedSpeechCues(bookWithSpeech('none'), at - 0.001, at + 0.001)).toEqual([])
    expect(crossedSpeechCues(bookWithSpeech('ja', '  '), at - 0.001, at + 0.001)).toEqual([])
    expect(crossedSpeechCues(bookWithSpeech('ja'), at + 0.001, at - 0.001)).toEqual([])
    expect(crossedSpeechCues(bookWithSpeech('ja'), 0, 1)).toEqual([])
  })

  it('改行や連続する空白は一つの空白にまとめる', () => {
    const book = bookWithSpeech('en', 'One summer\nday,   we went')
    const at = holdStart(book)
    expect(crossedSpeechCues(book, at - 0.001, at + 0.001)[0].text).toBe('One summer day, we went')
  })

  it('読み上げ指定の有無を作品全体で判定する', () => {
    expect(hasSpeechCues(bookWithSpeech('ja'))).toBe(true)
    expect(hasSpeechCues(bookWithSpeech('none'))).toBe(false)
  })

  it('作品全体の読み上げを切ると跨いでも返さず、音声操作の判定からも外れる', () => {
    const book = bookWithSpeech('ja')
    book.readAloud = false
    const at = holdStart(book)
    expect(crossedSpeechCues(book, at - 0.001, at + 0.001)).toEqual([])
    expect(hasSpeechCues(book)).toBe(false)
    // 外部TTS向けの一覧は読み上げOFFでも本文を返す
    expect(spreadSpeechCues(book, book.spreads[0].id)).toEqual([expect.objectContaining({ text: 'こんにちは', lang: 'ja-JP' })])
  })
})

describe('見開きの読み上げ本文', () => {
  it('要素順に並び、読み上げ指定のない要素と不可視の要素を除く', () => {
    const book = bookWithSpeech('ja', '一つ目')
    const spread = book.spreads[0]
    const silent = createStageElement('visual', { type: 'right-page' })
    const hidden = createStageElement('visual', { type: 'right-page' })
    const second = createStageElement('visual', { type: 'right-page' })
    if (silent.type !== 'visual' || hidden.type !== 'visual' || second.type !== 'visual') throw new Error('unexpected element type')
    silent.text = '読まない'; silent.speech = 'none'
    hidden.text = '見えない'; hidden.speech = 'ja'; hidden.visible = false
    second.text = 'Second'; second.speech = 'en'
    spread.elements.push(silent, hidden, second)
    expect(spreadSpeechCues(book, spread.id)).toEqual([
      { elementId: spread.elements[0].id, text: '一つ目', lang: 'ja-JP' },
      { elementId: second.id, text: 'Second', lang: 'en-US' },
    ])
    expect(spreadSpeechCues(book, book.spreads[1].id)).toEqual([])
    expect(spreadSpeechCues(book, 'missing')).toEqual([])
  })

  it('跨ぎ判定と同じ本文を同じ順で返す', () => {
    const book = bookWithSpeech('ja', '一つ目')
    const second = createStageElement('visual', { type: 'right-page' })
    if (second.type !== 'visual') throw new Error('unexpected element type')
    second.text = '二つ目'; second.speech = 'ja'
    book.spreads[0].elements.push(second)
    const at = holdStart(book)
    expect(crossedSpeechCues(book, at - 0.001, at + 0.001).map((hit) => hit.text))
      .toEqual(spreadSpeechCues(book, book.spreads[0].id).map((item) => item.text))
  })
})
