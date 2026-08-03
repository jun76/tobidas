import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Asset } from '../schema/assets'
import { AudioBank, AudioPlayback, audioGate } from './playback'

/**
 * 自動再生制限のもとでは `AudioContext` は suspended で生まれ、最初のユーザー操作の
 * あと `resume()` を待つ必要がある。その待ちを手元で開かせられる偽物を用意して、
 * 待っている最中に来た呼び出しの扱いを検査する。
 */
function installFakeAudio() {
  const gains: Array<{ value: number; ramps: Array<[number, number]> }> = []
  const sources: Array<{ started: boolean }> = []
  const calls: string[] = []
  let releaseResume: () => void = () => {}
  const resumed = new Promise<void>((resolve) => { releaseResume = resolve })

  class FakeAudioContext {
    state = 'suspended'
    currentTime = 0
    destination = {}
    async suspend() { calls.push('suspend'); this.state = 'suspended' }
    async resume() { calls.push('resume'); await resumed; this.state = 'running' }
    async decodeAudioData() { return { duration: 10 } }
    createGain() {
      const record = { value: 0, ramps: [] as Array<[number, number]> }
      gains.push(record)
      return {
        gain: {
          get value() { return record.value },
          set value(v: number) { record.value = v },
          setValueAtTime: (v: number) => { record.value = v },
          linearRampToValueAtTime: (v: number, t: number) => { record.ramps.push([v, t]); record.value = v },
          cancelScheduledValues: () => {},
          setTargetAtTime: () => {},
        },
        connect: () => {},
        disconnect: () => {},
      }
    }
    createBufferSource() {
      const record = { started: false }
      sources.push(record)
      return {
        buffer: null, loop: false, onended: null,
        connect: () => {}, start: () => { record.started = true }, stop: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
      }
    }
  }

  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('atob', (s: string) => s)
  return { gains, sources, calls, releaseResume: () => releaseResume() }
}

function installFakeHtmlAudio(abortPlayOnPause = false) {
  const calls: string[] = []
  const elements: Array<{ volume: number; paused: boolean }> = []
  class FakeAudio {
    preload = ''
    src = ''
    loop = false
    currentTime = 0
    volume = 1
    paused = true
    private listeners = new Map<string, () => void>()
    private rejectPlay: ((reason: Error) => void) | null = null
    constructor() { elements.push(this) }
    addEventListener(type: string, listener: () => void) { this.listeners.set(type, listener) }
    load() { queueMicrotask(() => this.listeners.get('loadeddata')?.()) }
    play() {
      calls.push('play')
      this.paused = false
      if (!abortPlayOnPause) return Promise.resolve()
      return new Promise<void>((_resolve, reject) => { this.rejectPlay = reject })
    }
    pause() {
      calls.push('pause')
      this.paused = true
      this.rejectPlay?.(new Error('AbortError'))
      this.rejectPlay = null
    }
  }
  vi.stubGlobal('Audio', FakeAudio)
  return { calls, elements }
}

const bgm: Asset = {
  id: 'bgm', name: 'bgm.mp3', type: 'audio', mime: 'audio/mpeg', bytes: 4,
  data: 'data:audio/mpeg;base64,AAAA',
} as Asset

const externalBgm: Asset = {
  ...bgm, data: './assets/bgm.mp3',
} as Asset

afterEach(() => { vi.unstubAllGlobals() })

describe('AudioPlayback', () => {
  /**
   * 呼び出し側 (PlayerApp の startBgm) はホイールや drag のたびに play を呼ぶ。
   * 締め出しを `resume()` の待ちより後でやると、隙に入った呼び出しが素通りして
   * 音源が何本も走る。gain は最後の1本しか指さないので、音楽ボタンで消せるのも
   * 最後の1本だけになり、残りが鳴り続けて「消音できない」状態になる。
   */
  it('starts a single source even when play is called again while the context resumes', async () => {
    const fake = installFakeAudio()
    const playback = new AudioPlayback()
    await playback.load(bgm)

    const first = playback.play(0.7, true)
    // resume を待っている間の呼び出し。ここで2本目を作ってはいけない
    const second = playback.play(0.7, true)
    const third = playback.play(0.7, true)
    fake.releaseResume()
    await Promise.all([first, second, third])

    expect(fake.sources.length).toBe(1)
    expect(fake.gains.length).toBe(1)
  })

  /** 立ち上がりを待っている最中に消音を押されたら、そのまま無音で立ち上がる */
  it('honours a mute pressed while the context is still resuming', async () => {
    const fake = installFakeAudio()
    const playback = new AudioPlayback()
    await playback.load(bgm)

    const starting = playback.play(0.7, true)
    playback.setMuted(true)
    fake.releaseResume()
    await starting

    expect(playback.muted).toBe(true)
    expect(fake.gains).toHaveLength(1)
    expect(fake.gains[0].value).toBe(0)
  })

  /** ロード直後の消音は、まだ音源が無くても最初のゲインへ引き継ぐ */
  it('remembers mute before playback starts', async () => {
    const fake = installFakeAudio()
    const playback = new AudioPlayback()
    await playback.load(bgm)

    playback.setMuted(true)
    const starting = playback.play(0.7, true)
    fake.releaseResume()
    await starting

    expect(playback.muted).toBe(true)
    expect(fake.gains[0].value).toBe(0)
  })

  /** 書き出しHTMLの外部音源も、ロード直後から終端で再開するまで無音を保つ */
  it('keeps an external audio element silent when muted before start and resumed at the end', async () => {
    const fake = installFakeHtmlAudio()
    const playback = new AudioPlayback()
    await playback.load(externalBgm)

    playback.setMuted(true)
    await playback.play(0.7, true, 0)
    playback.setPaused(true)
    playback.setPaused(false)

    expect(playback.muted).toBe(true)
    expect(fake.elements[0].volume).toBe(0)
    expect(fake.calls).toEqual(['play', 'pause', 'play'])
  })

  /** 外部音源のplay待ちをpauseが中断しても、次の再開用音量を失わない */
  it('keeps an aborted external start as a paused resumable session', async () => {
    const fake = installFakeHtmlAudio(true)
    const playback = new AudioPlayback()
    await playback.load(externalBgm)

    const starting = playback.play(0.7, true, 0)
    playback.setPaused(true)
    await starting

    expect(playback.playing).toBe(true)
    expect(playback.paused).toBe(true)
    expect(fake.elements[0].volume).toBe(0.7)
    expect(fake.calls).toEqual(['play', 'pause'])
  })

  /** resume待ち中に終端シークや停止が来ても、runningのまま音源を開始しない */
  it('re-suspends when paused while the context is resuming', async () => {
    const fake = installFakeAudio()
    const playback = new AudioPlayback()
    await playback.load(bgm)

    const starting = playback.play(0.7, true)
    playback.setPaused(true)
    fake.releaseResume()
    await starting

    expect(playback.paused).toBe(true)
    expect(fake.calls.at(-1)).toBe('suspend')
    expect(fake.gains[0].value).toBe(0.7)
  })

  /** 消音は音源を作り直さない。作り直すと曲が頭から鳴ってしまう */
  it('mutes and unmutes without rebuilding the source', async () => {
    const fake = installFakeAudio()
    const playback = new AudioPlayback()
    await playback.load(bgm)

    const starting = playback.play(0.7, true)
    fake.releaseResume()
    await starting

    playback.setMuted(true)
    expect(fake.gains[0].value).toBe(0)
    playback.setMuted(false)
    expect(fake.gains[0].value).toBe(0.7)
    expect(fake.sources.length).toBe(1)
  })

  /**
   * 一時停止は時間ごと止める。消音のように曲を走らせたままだと、止めている間に
   * 曲だけ進んで、戻したとき絵と噛み合わなくなる。
   */
  it('pauses and resumes the clock without rebuilding the source', async () => {
    const fake = installFakeAudio()
    const playback = new AudioPlayback()
    await playback.load(bgm)
    const starting = playback.play(0.7, true)
    fake.releaseResume()
    await starting
    fake.calls.length = 0

    playback.setPaused(true)
    expect(playback.paused).toBe(true)
    expect(fake.calls).toEqual(['suspend'])

    // 同じ状態をもう一度頼まれても触らない (毎フレーム呼ばれても平気であること)
    playback.setPaused(true)
    expect(fake.calls).toEqual(['suspend'])

    playback.setPaused(false)
    expect(playback.paused).toBe(false)
    expect(fake.calls).toEqual(['suspend', 'resume'])
    // 音源は作り直さない。作り直すと曲が頭から鳴る
    expect(fake.sources.length).toBe(1)
  })

  /** 消音と一時停止は別物で、互いを打ち消さない */
  it('keeps mute and pause independent', async () => {
    const fake = installFakeAudio()
    const playback = new AudioPlayback()
    await playback.load(bgm)
    const starting = playback.play(0.7, true)
    fake.releaseResume()
    await starting

    playback.setMuted(true)
    playback.setPaused(true)
    playback.setPaused(false)
    // 一時停止から戻しても、消音は押したまま
    expect(playback.muted).toBe(true)
    expect(fake.gains[0].value).toBe(0)
  })
})

describe('audioGate', () => {
  const gate = (over: Partial<Parameters<typeof audioGate>[0]>) =>
    audioGate({ active: true, playing: false, atEnd: false, muted: false, ...over })

  it('rings while playing and falls silent while stopped', () => {
    expect(gate({ playing: true })).toEqual({ bgmPaused: false, bgmMuted: false, cuesMuted: false })
    // つまみ・ホイール・drag で動かしている間 (途中で止まっている)
    expect(gate({ playing: false })).toEqual({ bgmPaused: true, bgmMuted: false, cuesMuted: true })
  })

  /**
   * 終端は「止めた」のではなく「終わった」。最後の絵が出た瞬間に曲がぶつっと
   * 切れると余韻が残らないので、BGMだけは流したままにする。
   */
  it('lets the BGM ring on at the end instead of cutting it', () => {
    expect(gate({ playing: false, atEnd: true }).bgmPaused).toBe(false)
    // 効果音は跨いだ瞬間の出来事なので、終端でも切ってよい
    expect(gate({ playing: false, atEnd: true }).cuesMuted).toBe(true)
    // 終端から頭へ戻して再生し直しても、BGMは一度も止まっていない
    expect(gate({ playing: true, atEnd: false }).bgmPaused).toBe(false)
  })

  /** 音声ボタンはBGMと効果音の両方を消す。片方だけ残ると消音に見えない */
  it('mutes both the BGM and the cues', () => {
    const muted = gate({ playing: true, muted: true })
    expect(muted.bgmMuted).toBe(true)
    expect(muted.cuesMuted).toBe(true)
    // 消音は一時停止ではない。曲は流れたまま音量だけ落とす
    expect(muted.bgmPaused).toBe(false)
  })

  /** 編集モードへ戻ったら音は止め、効果音の消音は中立へ戻す (試し聞きは別経路) */
  it('stops the BGM outside the play view and leaves cues neutral', () => {
    expect(gate({ active: false, playing: false, atEnd: true })).toEqual({
      bgmPaused: true, bgmMuted: false, cuesMuted: false,
    })
  })
})

describe('AudioBank', () => {
  const cue: Asset = {
    id: 'cue', name: 'page-turn.wav', type: 'audio', mime: 'audio/wav', bytes: 4,
    data: 'data:audio/wav;base64,AAAA',
  } as Asset

  /**
   * 再生が止まっている間は効果音を鳴らさない。
   * 試し聞きは編集の操作なので、こちらには従わせない。
   */
  it('does not fire cues while muted, and lets previews through', async () => {
    const fake = installFakeAudio()
    fake.releaseResume() // 試し聞きは resume を待つので、先に開けておく
    const bank = new AudioBank()
    await bank.load(cue)

    bank.fire('cue')
    expect(fake.sources.length).toBe(1)

    bank.setCuesMuted(true)
    bank.fire('cue')
    bank.fire('cue')
    expect(fake.sources.length).toBe(1)

    // 試し聞きは止めている間も鳴る
    await bank.togglePreview(cue)
    expect(fake.sources.length).toBe(2)

    bank.setCuesMuted(false)
    bank.fire('cue')
    expect(fake.sources.length).toBe(3)
  })
})
