import { isExternalAssetData, type Asset } from '../schema/assets'

/** 音の止め方を決める入力。再生画面とビルダーの再生モードで同じ規則を使う */
export interface AudioGateInput {
  /** 再生の画面にいるか。ビルダーで編集へ戻ったら false */
  active: boolean
  /** 自動再生で進んでいるか。つまみ・ホイール・drag で動かしている間は false */
  playing: boolean
  /** 終端に着いているか */
  atEnd: boolean
  /** 音声ボタンで消しているか */
  muted: boolean
}

export interface AudioGate {
  bgmPaused: boolean
  bgmMuted: boolean
  cuesMuted: boolean
}

/**
 * 音が出る条件。**再生画面とビルダーで同じ答えを使う**ので、規則はここだけが持つ。
 *
 * 黙るのは2通り: 再生が止まっているとき (一時停止・スクラブ) と、音声ボタンで
 * 消しているとき。音声ボタンはBGMと効果音の両方を消す — スピーカーの絵で音楽だけ
 * 消えても、ページをめくる音が鳴り続けたら消音に見えない。
 *
 * **終端だけはBGMを止めない**。そこは「止めた」のではなく「終わった」ので、最後の絵が
 * 出た瞬間に曲がぶつっと切れると余韻が残らない。曲は流したままにして、もう一度再生を
 * 押したら絵だけ頭から始める。BGMは切れていないぶん、そのまま一続きに聞こえる。
 *
 * 効果音は跨いだ瞬間の出来事で「続きから」が無いので、終端でも切ってよい
 * (そもそも進んでいないので跨がない)。
 */
export function audioGate({ active, playing, atEnd, muted }: AudioGateInput): AudioGate {
  return {
    bgmPaused: !playing && !(active && atEnd),
    bgmMuted: muted,
    cuesMuted: active && (muted || !playing),
  }
}

/** data URL の base64 部分を復号する。制作中の音声は data URL としてのみ持ち歩く */
function decodeDataUrl(data: string): ArrayBuffer {
  const base64 = data.slice(data.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

/**
 * 外部ファイルの音声は Web Audio へ通さず HTMLAudioElement のまま鳴らす。
 *
 * 書き出したサイトは単一HTMLを file:// で直接開かれる前提がある。そこでは fetch も XHR も
 * CORS で落ちるので `decodeAudioData` へ渡すバイト列が手に入らない。`createMediaElementSource`
 * も file:// の音源は出自不明として無音化されうるため、Web Audio のグラフには載せず、
 * 要素の再生と `volume` だけで扱う。制作中は data URL なので従来の AudioBuffer 経路のまま。
 */
function loadAudioElement(url: string): Promise<HTMLAudioElement> {
  return new Promise((resolve, reject) => {
    const element = new Audio()
    element.preload = 'auto'
    // canplaythrough を待つと全部が届くまで返らない。鳴らし始められる loadeddata で足りる
    element.addEventListener('loadeddata', () => resolve(element), { once: true })
    element.addEventListener('error', () => reject(new Error(`failed to load audio: ${url}`)), { once: true })
    element.src = url
    element.load()
  })
}

/**
 * 要素の音量を線形に寄せる。GainNode の代わりで、フェードの見え方を両経路で揃える。
 * 戻り値を呼ぶと途中で止まる (次のフェードが前のを打ち消すため)。
 */
function rampVolume(
  element: HTMLAudioElement,
  to: number,
  seconds: number,
  onDone?: () => void,
): () => void {
  const from = element.volume
  const start = performance.now()
  let frame = 0
  let alive = true
  const step = () => {
    if (!alive) return
    const ratio = seconds <= 0 ? 1 : Math.min(1, (performance.now() - start) / (seconds * 1000))
    element.volume = Math.max(0, Math.min(1, from + (to - from) * ratio))
    if (ratio >= 1) {
      alive = false
      onDone?.()
      return
    }
    frame = requestAnimationFrame(step)
  }
  step()
  return () => {
    alive = false
    cancelAnimationFrame(frame)
  }
}

/**
 * 1つの音声アセットをロードして再生・停止する capability。
 * Player と Builder のタイムラインが共有する所有者。
 * 自動再生制限のため play はユーザー操作から呼ぶ。
 */
export class AudioPlayback {
  private context: AudioContext | null = null
  private gain: GainNode | null = null
  private source: AudioBufferSourceNode | null = null
  private buffer: AudioBuffer | null = null
  /** 外部ファイル経路。要素そのものが音源になる */
  private element: HTMLAudioElement | null = null
  private cancelRamp: (() => void) | null = null
  /** play で渡された音量。消音を戻すときの行き先になる */
  private volume = 1
  playing = false
  /** 消音中か。playing は立ったままで、曲は流れ続けている */
  muted = false
  /** 一時停止中か。playing は立ったままで、曲は時間ごと止まっている */
  paused = false

  async load(asset: Asset): Promise<void> {
    if (isExternalAssetData(asset.data)) {
      this.element = await loadAudioElement(asset.data)
      return
    }
    this.context ??= new AudioContext()
    this.buffer = await this.context.decodeAudioData(decodeDataUrl(asset.data))
  }

  /**
   * 鳴らし始める。**再入の締め出しは最初の await より前で済ませる**。
   *
   * 自動再生制限があるので `AudioContext` は読み込み時点では suspended で、最初の
   * ユーザー操作のあと `resume()` を待つ必要がある。この待ちは一瞬ではないのに、
   * 呼び出し側 (PlayerApp の startBgm) はホイールや drag のたびに呼んでくる。
   * `playing` を待ちの後で立てると、その隙に入った2度目3度目の呼び出しが素通りして
   * 音源を何本も走らせる。`gain` と `source` は最後の1本しか指さないので、
   * 音楽ボタンで消せるのも最後の1本だけになり、残りが鳴り続けて「消音できない」
   * 状態になる。
   *
   * 待っている間に音楽ボタンが押されることもある。そのとき `setMuted` は
   * `gain` がまだ無いので `muted` を立てるだけで戻る。ここで最後にその意思を
   * 読んで、立ち上がりのフェード先を決める。
   */
  async play(volume: number, loop: boolean, fadeSeconds = 1): Promise<void> {
    if (this.playing) return
    this.playing = true
    this.volume = volume
    this.muted = false
    this.paused = false
    const element = this.element
    if (element) {
      element.loop = loop
      element.currentTime = 0
      element.volume = 0
      try {
        await element.play()
      } catch (reason) {
        this.playing = false
        console.warn('failed to start audio:', reason)
        return
      }
      this.cancelRamp?.()
      this.cancelRamp = rampVolume(element, this.muted ? 0 : volume, fadeSeconds)
      return
    }
    if (!this.context || !this.buffer) {
      this.playing = false
      return
    }
    await this.context.resume()
    // 待っている間に stop されていたら、もう音源を作らない
    if (!this.playing) return
    this.gain = this.context.createGain()
    this.gain.gain.setValueAtTime(0, this.context.currentTime)
    this.gain.gain.linearRampToValueAtTime(this.muted ? 0 : volume, this.context.currentTime + fadeSeconds)
    this.gain.connect(this.context.destination)
    this.source = this.context.createBufferSource()
    this.source.buffer = this.buffer
    this.source.loop = loop
    this.source.connect(this.gain)
    this.source.start()
  }

  /**
   * 消音の切り替え。動画プレイヤーのミュートと同じで、止めずに音量だけ落とす。
   *
   * `stop` と `play` で往復させると音源を作り直すことになり、曲は必ず頭から鳴る。
   * ここでは音源をそのまま走らせて音量だけ動かすので、戻したときはその間に進んだ
   * 続きから聞こえる。まだ鳴り始めていないときは何もしない (最初の再生は play の仕事)。
   */
  setMuted(muted: boolean, fadeSeconds = 0.25): void {
    if (!this.playing) return
    this.muted = muted
    const target = muted ? 0 : this.volume
    const element = this.element
    if (element) {
      this.cancelRamp?.()
      this.cancelRamp = rampVolume(element, target, fadeSeconds)
      return
    }
    if (!this.context || !this.gain) return
    const now = this.context.currentTime
    const gain = this.gain.gain
    // 立ち上がりのフェードが残っていることがあるので、今の値で押さえてから引き直す
    if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now)
    else {
      gain.cancelScheduledValues(now)
      gain.setValueAtTime(gain.value, now)
    }
    gain.linearRampToValueAtTime(target, now + fadeSeconds)
  }

  /**
   * 一時停止の切り替え。消音とは別物で、こちらは**時間ごと止める**。
   *
   * 消音は曲を走らせたまま音量を落とすので、戻すとその間に進んだ続きから聞こえる。
   * 一時停止は曲そのものを止めるので、戻すと止めた位置から続く。再生を止めたときに
   * 音楽だけ進み続けると、戻したときに絵と曲の位置が噛み合わなくなる。
   *
   * `stop`/`play` で往復させないのは消音と同じ理由で、音源を作り直すと頭から鳴る。
   * 内蔵経路は AudioContext ごと止める (BGMはこの context を専有している)。
   * 消音との併用は素直で、両方が独立に効く。
   */
  setPaused(paused: boolean): void {
    if (!this.playing || this.paused === paused) return
    this.paused = paused
    const element = this.element
    if (element) {
      if (paused) element.pause()
      else void element.play().catch((reason) => console.warn('failed to resume audio:', reason))
      return
    }
    if (!this.context) return
    void (paused ? this.context.suspend() : this.context.resume())
  }

  stop(fadeSeconds = 0.6): void {
    if (!this.playing) return
    this.muted = false
    // 止める前に時間を動かしておく。止まったままだとフェードが進まず、
    // 次に鳴らすときも suspended のまま残る
    if (this.paused) {
      this.paused = false
      void this.context?.resume()
    }
    const element = this.element
    if (element) {
      this.playing = false
      this.cancelRamp?.()
      this.cancelRamp = rampVolume(element, 0, fadeSeconds, () => element.pause())
      return
    }
    // 立ち上がりを待っている最中の停止。ここで降ろしておくと play が音源を作らずに戻る
    if (!this.context || !this.gain || !this.source) {
      this.playing = false
      return
    }
    const gain = this.gain
    const source = this.source
    gain.gain.linearRampToValueAtTime(0, this.context.currentTime + fadeSeconds)
    setTimeout(() => {
      try {
        source.stop()
      } catch {
        // 停止済み
      }
      gain.disconnect()
    }, fadeSeconds * 1000 + 50)
    this.playing = false
  }
}

/** 効果音の音量。キューにもトラックにも持たせない */
export const CUE_VOLUME = 0.9
/** BGMの音量。割り当てたときの既定値 */
export const BGM_VOLUME = 0.7

/**
 * 同じ効果音を重ねられる本数 (要素経路のみ)。
 * AudioBufferSourceNode は使い捨てで何本でも重なるが、要素は1本で1発しか鳴らせないので
 * 足りなくなったぶんだけ要素を増やす。上限に達したら古いものを鳴らし直す。
 */
const CUE_ELEMENT_LIMIT = 6

/** 鳴らせる状態になった音源。data URL は AudioBuffer、外部ファイルは要素の束 */
type Voice =
  | { kind: 'buffer'; buffer: AudioBuffer }
  | { kind: 'element'; url: string; pool: HTMLAudioElement[] }

/**
 * 複数の音声を鳴らし分ける所有者。効果音の発火と、制作中の試し聞きが使う。
 *
 * 発火は一度きりで、同じ音が重なることを許す。前の発音を
 * 止める作りにすると、足音や水滴のように連ねて置いた音が最後の一つしか
 * 鳴らなくなる。
 *
 * 自動再生制限があるので、最初の fire / preview はユーザー操作から呼ぶ。
 */
export class AudioBank {
  private context: AudioContext | null = null
  private voices = new Map<string, Voice>()
  private loading = new Map<string, Promise<Voice | null>>()
  /** 試し聞きだけは「鳴っている1つ」を止められる。編集の操作なので重ねない */
  private preview: { id: string; stop: () => void } | null = null
  private onPreviewEnd: (() => void) | null = null
  /**
   * 効果音だけを通す口。試し聞きは通さない。
   *
   * 再生を止めたら効果音も黙らせたいが、同じ AudioBank をアセット一覧の試し聞きも
   * 使っている。まとめて絞ると、止めている間は試し聞きも鳴らなくなる。
   */
  private cueGain: GainNode | null = null
  /** 要素経路で今鳴っている効果音。消音のとき切りに行く先 */
  private firedElements = new Set<HTMLAudioElement>()
  /** 効果音を止めているか。再生が止まっている間は立つ */
  cuesMuted = false

  get previewingId(): string | null {
    return this.preview?.id ?? null
  }

  /** 読み込み済みなら即返す。同じアセットへの多重読み込みは1本にまとめる */
  async load(asset: Asset): Promise<Voice | null> {
    const cached = this.voices.get(asset.id)
    if (cached) return cached
    const inFlight = this.loading.get(asset.id)
    if (inFlight) return inFlight
    const task = this.open(asset)
      .then((voice) => {
        this.voices.set(asset.id, voice)
        return voice
      })
      .catch((reason) => {
        console.warn('failed to load audio:', reason)
        return null
      })
      .finally(() => this.loading.delete(asset.id))
    this.loading.set(asset.id, task)
    return task
  }

  private async open(asset: Asset): Promise<Voice> {
    if (isExternalAssetData(asset.data)) {
      return { kind: 'element', url: asset.data, pool: [await loadAudioElement(asset.data)] }
    }
    this.context ??= new AudioContext()
    return { kind: 'buffer', buffer: await this.context.decodeAudioData(decodeDataUrl(asset.data)) }
  }

  /** 読み込み済みのものを一度だけ鳴らす。未読み込みなら何もしない (発火は待たせない) */
  fire(assetId: string, volume = CUE_VOLUME): void {
    if (this.cuesMuted) return
    const voice = this.voices.get(assetId)
    if (!voice) return
    if (voice.kind === 'buffer') {
      if (!this.context) return
      void this.context.resume()
      this.start(voice.buffer, volume, true)
      return
    }
    const element = this.startElement(voice, volume)
    this.firedElements.add(element)
    element.addEventListener('ended', () => this.firedElements.delete(element), { once: true })
  }

  /**
   * 効果音を止める / 戻す。再生が止まっている間は鳴らさない。
   *
   * 効果音は跨いだ瞬間の出来事なので、BGMのような一時停止 (時間ごと止めて続きから)
   * は意味を持たない。鳴っている途中のものは**切る**、戻しても鳴り直さない。
   * 試し聞きは編集の操作なのでここに従わせない。だから効果音だけ `cueGain` を通す。
   */
  setCuesMuted(muted: boolean): void {
    if (this.cuesMuted === muted) return
    this.cuesMuted = muted
    if (!muted) return
    // 鳴っている途中のものは切る。口ごと外せば繋がっている音源は全部黙り、
    // 戻したときに途中から蘇ることもない (次の fire が口を作り直す)
    this.cueGain?.disconnect()
    this.cueGain = null
    for (const element of this.firedElements) {
      element.pause()
      element.currentTime = 0
    }
    this.firedElements.clear()
  }

  /** 試し聞き。鳴っている間にもう一度呼ぶと止まる */
  async togglePreview(asset: Asset, onEnd?: () => void): Promise<void> {
    if (this.preview?.id === asset.id) {
      this.stopPreview()
      return
    }
    this.stopPreview()
    const voice = await this.load(asset)
    if (!voice) return
    const ended = () => {
      if (this.preview?.id !== asset.id) return
      this.preview = null
      this.onPreviewEnd?.()
      this.onPreviewEnd = null
    }
    if (voice.kind === 'buffer') {
      if (!this.context) return
      await this.context.resume()
      const source = this.start(voice.buffer, CUE_VOLUME)
      source.onended = ended
      this.preview = {
        id: asset.id,
        stop: () => {
          source.onended = null
          try {
            source.stop()
          } catch {
            // 停止済み
          }
        },
      }
    } else {
      const element = this.startElement(voice, CUE_VOLUME)
      element.addEventListener('ended', ended, { once: true })
      this.preview = {
        id: asset.id,
        stop: () => {
          element.removeEventListener('ended', ended)
          element.pause()
        },
      }
    }
    this.onPreviewEnd = onEnd ?? null
  }

  stopPreview(): void {
    if (!this.preview) return
    const { stop } = this.preview
    this.preview = null
    stop()
    this.onPreviewEnd?.()
    this.onPreviewEnd = null
  }

  /** 効果音の口。消音のとき丸ごと外すので、その都度ここで作り直す */
  private ensureCueGain(): GainNode {
    const context = this.context!
    if (!this.cueGain) {
      this.cueGain = context.createGain()
      this.cueGain.gain.value = 1
      this.cueGain.connect(context.destination)
    }
    return this.cueGain
  }

  private start(buffer: AudioBuffer, volume: number, asCue = false): AudioBufferSourceNode {
    const context = this.context!
    const gain = context.createGain()
    gain.gain.value = volume
    gain.connect(asCue ? this.ensureCueGain() : context.destination)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(gain)
    source.addEventListener('ended', () => gain.disconnect())
    source.start()
    return source
  }

  /** 空いている要素を鳴らす。全部鳴っていれば増やし、上限なら最も古いものを鳴らし直す */
  private startElement(voice: { url: string; pool: HTMLAudioElement[] }, volume: number): HTMLAudioElement {
    let element = voice.pool.find((item) => item.paused || item.ended)
    if (!element) {
      if (voice.pool.length < CUE_ELEMENT_LIMIT) {
        element = new Audio(voice.url)
        element.preload = 'auto'
        voice.pool.push(element)
      } else {
        element = voice.pool[0]
      }
    }
    element.volume = volume
    element.currentTime = 0
    void element.play().catch((reason) => console.warn('failed to fire audio:', reason))
    return element
  }
}
