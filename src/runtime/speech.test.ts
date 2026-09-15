import { describe, expect, it } from 'vitest'
import { createBookProject, createSpread, createStageElement } from '../schema/bookDefaults'
import { compileBookBeats, playbackDurationSeconds } from './signals'
import { crossedSpeechCues, hasSpeechCues } from './speech'

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
})
