import type { Book } from '../schema/book'
import { compileBookBeats, playbackDurationSeconds } from './signals'

/**
 * 本文の読み上げ。
 *
 * 効果音と同じく「跨いだ瞬間の出来事」として扱い、進行値の関数にはしない (soundCues.ts 参照)。
 * 見開きの保持区間の始まり (ページが開き切った瞬間) を連続再生で跨いだとき、その見開きの
 * 読み上げ指定のある本文を要素順に読む。逆行・飛ばし・停止中は読まない。
 */

const CONTINUOUS_LIMIT = 0.05
const LANGUAGE: Record<'ja' | 'en', string> = { ja: 'ja-JP', en: 'en-US' }

export interface SpeechCueHit {
  spreadId: string
  text: string
  lang: string
  /** 作品全体の進行としての位置。並べ替えの基準になる */
  progress: number
}

/** from から to へ進んだときに開き切った見開きの読み上げ。見開きごとに本文の順で並ぶ */
export function crossedSpeechCues(book: Book, from: number, to: number): SpeechCueHit[] {
  if (!(to > from) || to - from > CONTINUOUS_LIMIT) return []
  const duration = playbackDurationSeconds(book)
  if (duration <= 0) return []
  const beats = compileBookBeats(book)
  const hits: SpeechCueHit[] = []
  for (const spread of book.spreads) {
    const hold = beats.find((beat) => beat.kind === 'hold' && beat.spreadId === spread.id)
    if (!hold) continue
    const progress = hold.startSeconds / duration
    if (!(progress > from && progress <= to)) continue
    for (const element of spread.elements) {
      if (element.type !== 'visual' || element.speech === 'none' || !element.visible) continue
      const text = element.text.replace(/\s+/g, ' ').trim()
      if (text) hits.push({ spreadId: spread.id, text, lang: LANGUAGE[element.speech], progress })
    }
  }
  return hits.sort((left, right) => left.progress - right.progress)
}

/** 作品に読み上げ指定の本文があるか (音声操作の有無を決める) */
export function hasSpeechCues(book: Book): boolean {
  return book.spreads.some((spread) => spread.elements.some((element) => element.type === 'visual' && element.speech !== 'none' && element.text.trim()))
}

/**
 * Web Speech API の薄い包み。ブラウザが対応しない環境では何もしない。
 * 新しい見開きの読み上げは前の見開きの残りを打ち切る。停止・消音・画面離脱でも打ち切る。
 */
export class SpeechNarrator {
  private muted = false
  private readonly synth: SpeechSynthesis | undefined =
    typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : undefined

  get available(): boolean { return Boolean(this.synth) }

  speak(hits: SpeechCueHit[]): void {
    if (!this.synth || this.muted || !hits.length) return
    this.synth.cancel()
    for (const hit of hits) {
      const utterance = new SpeechSynthesisUtterance(hit.text)
      utterance.lang = hit.lang
      const voice = this.pickVoice(hit.lang)
      if (voice) utterance.voice = voice
      this.synth.speak(utterance)
    }
  }

  cancel(): void { this.synth?.cancel() }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (muted) this.cancel()
  }

  /** 言語が一致する音声を優先し、なければブラウザの既定 (lang 指定だけ) に任せる */
  private pickVoice(lang: string): SpeechSynthesisVoice | undefined {
    const voices = this.synth?.getVoices() ?? []
    const language = lang.slice(0, 2).toLowerCase()
    return voices.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase())
      ?? voices.find((voice) => voice.lang.toLowerCase().startsWith(language))
  }
}
