import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { Icon } from '../ui/Icon'
import { bookProjectSchema, type BookProject } from '../schema/bookPackage'
import { validateBookProject } from '../schema/bookValidate'
import { BookRuntime } from '../runtime/BookRuntime'
import { hasEmbeddedVideoAudio, unlockVideoAudio } from '../runtime/videoAudio'
import { VIEW_CLIP, VIEW_GL } from '../runtime/camera/view'
import { AudioBank, AudioPlayback, audioGate } from '../audio/playback'
import { playbackDurationSeconds } from '../runtime/signals'
import { crossedSoundCues, soundCueAssetIds } from '../runtime/soundCues'
import { crossedSpeechCues, hasSpeechCues, SpeechNarrator, spreadSpeechCues } from '../runtime/speech'
import { currentSpreadIndex, spreadJumpPlan } from '../runtime/pageTurn'

/**
 * 再生の状態。
 * - auto: 再生ボタンで末尾までシームレスに進む
 * - manual: 静止。起動時、ページ送りの到着、一時停止で入る
 * - turning: 見開きボタンで、その見開きのめくり開始へ飛んでから保持終端まで作者の速度で順再生し、到着で manual へ戻る
 */
type Playback = 'auto' | 'manual' | 'turning'

/**
 * 書き出した作品の再生画面。
 *
 * 作品の受け取り口は埋め込みデータ1つだけ。この画面は単一HTMLへインライン化されて
 * file:// で開かれるので、外部から作品を取りに行く経路は成立しない。
 *
 * ただし素材の実体は隣の `assets/` にある外部ファイルで、埋め込みデータは相対URLだけを
 * 持つ。fetch は file:// で落ちるため、実体を読むのは `<img>` と
 * HTMLAudioElement に限る。
 */
export function PlayerApp() {
  const initialProgress = initialProgressFromUrl()
  const [project, setProject] = useState<BookProject | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(initialProgress)
  /** 音声ボタンで消したか。BGMも効果音もまとめて黙らせる */
  const [audioMuted, setAudioMuted] = useState(false)
  const [playback, setPlayback] = useState<Playback>('manual')
  const [contentTime, setContentTime] = useState<number | undefined>()
  const playbackRef = useRef<Playback>('manual')
  /** turning の目的地と向き。到着で manual へ戻るときに消す */
  const turn = useRef<{ target: number; direction: 1 | -1 } | null>(null)
  const progressRef = useRef(initialProgress)
  const target = useRef(initialProgress)
  const drag = useRef<number | null>(null)
  const bgm = useMemo(() => new AudioPlayback(), [])
  const bank = useMemo(() => new AudioBank(), [])
  const narrator = useMemo(() => new SpeechNarrator(), [])
  /** audioMuted の即値。消した後に操作しても BGM を鳴らし直させない */
  const audioMutedRef = useRef(false)
  /** 初回は再生ボタンかシークバーに触れるまでBGMを開始しない */
  const bgmArmedRef = useRef(false)
  /** 自動再生・ページ送りを止めて手動モードへ戻す。到着、一時停止、つまみやホイールの操作で呼ぶ */
  const settle = () => {
    turn.current = null
    if (playbackRef.current === 'manual') return
    playbackRef.current = 'manual'
    setPlayback('manual')
  }

  useEffect(() => {
    try {
      const embedded = document.getElementById('tobidas-project')?.textContent?.trim()
      if (!embedded || embedded === 'null') {
        throw new Error('No book data is embedded.\nOpen the HTML produced by the builder site export.')
      }
      const data: unknown = JSON.parse(embedded)
      const validation = validateBookProject(data)
      if (!validation.ok) throw new Error('Book validation failed:\n' + validation.errors.join('\n'))
      // 保存時に省略した所有ページなどを編集用フォルダーと同じスキーマで導出する。
      setProject({ ...bookProjectSchema.parse(data), assets: (data as BookProject).assets })
    } catch (reason) { setError(String(reason)) }
  }, [])

  useEffect(() => {
    let frame = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const delta = document.hidden ? 0 : Math.min(0.05, (now - previous) / 1000)
      previous = now
      setProgress((value) => {
        let next: number
        const step = project ? delta / playbackDurationSeconds(project.book) : 0
        if (playbackRef.current === 'auto' && project) {
          next = Math.min(1, value + step)
          target.current = next
          if (next >= 1) settle()
        } else if (playbackRef.current === 'turning' && project && turn.current) {
          // 目的地を跨いだら目的地で止める。作者の速度で進むので、めくりと演出は自動再生と同じ見え方になる
          const { target: goal, direction } = turn.current
          next = direction > 0 ? Math.min(goal, value + step) : Math.max(goal, value - step)
          target.current = next
          if (next === goal) settle()
        } else {
          next = THREE.MathUtils.damp(value, target.current, 12, delta)
        }
        progressRef.current = next
        // 進んだぶんで跨いだ効果音を鳴らす。逆行と飛ばしは crossedSoundCues が弾き、
        // 止まっている間 (つまみ・ホイール・drag での移動) はここで弾く。
        // 消音は上の useEffect も掛けるが、あちらは再描画ぶん遅れるので位置を先に見る
        if (project && playbackRef.current !== 'manual' && !audioMutedRef.current) {
          for (const hit of crossedSoundCues(project.book, value, next)) bank.fire(hit.assetId)
          narrator.speak(crossedSpeechCues(project.book, value, next))
        }
        return next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [project])

  useEffect(() => {
    ;(window as unknown as { __tobiSetScroll?: (value: number) => void }).__tobiSetScroll = (value) => {
      settle()
      target.current = THREE.MathUtils.clamp(value, 0, 1)
      progressRef.current = target.current
      setProgress(target.current)
    }
  }, [])

  useEffect(() => {
    const audio = project?.audio
    const asset = project?.assets.find((item) => item.id === audio?.bgmAsset)
    if (asset) void bgm.load(asset).catch((reason) => console.warn('failed to load BGM:', reason))
  }, [project, bgm])

  /**
   * 音が出る条件は `audioGate` だけが持つ (ビルダーの再生モードと同じ規則)。
   * 取りこぼしを防ぐため、状態から毎回引き直す。BGMは絵の一時停止では止めず、
   * 音声ボタンの消音だけを反映する。
   */
  useEffect(() => {
    ;(window as unknown as { __tobiSetContentTime?: (value?: number) => void }).__tobiSetContentTime = (value) => {
      if (value === undefined || Number.isFinite(value) && value >= 0) setContentTime(value)
    }
    // ページ送りの間も作者の速度で進んでいるので、効果音は自動再生と同じく鳴らす
    const gate = audioGate({ active: true, playing: playback !== 'manual', muted: audioMuted })
    bgm.setMuted(gate.bgmMuted, gate.bgmMuted ? 0 : .25)
    bgm.setPaused(gate.bgmPaused)
    bank.setCuesMuted(gate.cuesMuted)
    // 読み上げは効果音と同じ扱い。止めたり消音したりした時点で残りを打ち切る
    narrator.setMuted(gate.cuesMuted)
  }, [playback, audioMuted, bgm, bank, narrator])
  useEffect(() => () => narrator.cancel(), [narrator])

  // 効果音は跨いだ瞬間に鳴らすので、待たせないよう先に読み込んでおく
  useEffect(() => {
    if (!project) return
    for (const id of soundCueAssetIds(project.book)) {
      const asset = project.assets.find((item) => item.id === id)
      if (asset) void bank.load(asset)
    }
  }, [project, bank])

  /**
   * BGMは冒頭からループ再生する。初回は再生ボタンかシークバーの操作を待つ。
   * これはブラウザの自動再生許可に依存せず、単一HTMLと同じ開始条件に揃えるためのガード。
   */
  const startBgm = (arm = false) => {
    if (arm) bgmArmedRef.current = true
    if (!bgmArmedRef.current || !project?.audio || bgm.playing || audioMutedRef.current) return
    void bgm.play(project.audio.volume, project.audio.loop)
  }

  if (error) return <pre style={{ padding: 20, color: '#c33', whiteSpace: 'pre-wrap' }}>{error}</pre>
  if (!project) return <div style={{ padding: 20, fontFamily: 'sans-serif' }}>Loading…</div>
  // 音声ボタンはBGMと効果音の両方を消すので、どちらかを持つ作品なら出す
  const hasAudio = Boolean(project.audio) || soundCueAssetIds(project.book).length > 0 || hasSpeechCues(project.book)
    || hasEmbeddedVideoAudio(project.book, new Map(project.assets.map((asset) => [asset.id, asset])))
  const pause = () => settle()
  const add = (pixels: number) => {
    unlockVideoAudio()
    pause()
    startBgm()
    target.current = THREE.MathUtils.clamp(target.current + pixels / 4200, 0, 1)
  }
  const seek = (value: number) => {
    unlockVideoAudio()
    pause()
    startBgm(true)
    target.current = THREE.MathUtils.clamp(value, 0, 1)
    setProgress(target.current)
  }
  const togglePlayback = () => {
    unlockVideoAudio()
    startBgm(true)
    if (playbackRef.current === 'auto') {
      pause()
      return
    }
    // 手動モードやページ送りの途中からは、その位置から自動再生へ移る
    turn.current = null
    if (progress >= 1) {
      target.current = 0
      progressRef.current = 0
      setProgress(0)
    }
    playbackRef.current = 'auto'
    setPlayback('auto')
  }
  /**
   * 見開きボタンによるジャンプ。自動再生中なら止めて手動モードへ移り、その見開きのめくりが始まる
   * フレームへ直ちに飛んでから、めくりと演出を作者の速度で進めて保持終端で止まる。
   * 飛ばした区間の効果音は鳴らさない (跨ぎ判定を通さず位置だけ変える)。
   */
  const jumpToSpread = (index: number) => {
    const plan = spreadJumpPlan(project.book, index)
    if (!plan) return
    unlockVideoAudio()
    startBgm(true)
    progressRef.current = plan.start
    target.current = plan.start
    setProgress(plan.start)
    turn.current = { target: plan.target, direction: 1 }
    playbackRef.current = 'turning'
    setPlayback('turning')
  }
  const spreadIndex = currentSpreadIndex(project.book, progress)
  /**
   * 音声ボタンは消音の切り替え。BGMも効果音もまとめて消す。
   *
   * BGMは動画プレイヤーのミュートと同じで、消している間も曲は流れ続け、戻すと
   * 続きから聞こえる (止めて鳴らし直すと必ず頭からになる)。実際の適用は上の
   * useEffect が状態から引き直すので、ここは意思を記録して鳴らし始めるだけ。
   */
  const toggleAudio = () => {
    const muted = !audioMutedRef.current
    if (!muted) unlockVideoAudio()
    audioMutedRef.current = muted
    // Reactのeffectを待たず、このクリック内で音源と効果音を閉じる。
    bgm.setMuted(muted, 0)
    bank.setCuesMuted(muted || playbackRef.current === 'manual')
    setAudioMuted(muted)
    // 消音を解いた時点でまだ鳴っていなければ、ここが最初のユーザー操作になる
    if (!muted) startBgm()
  }

  return <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', touchAction: 'none' }}
    onWheel={(event) => add(event.deltaY)}
    onPointerDown={(event) => {
      if ((event.target as HTMLElement).closest('button')) return
      if ((event.target as HTMLElement).closest('input')) {
        pause()
        startBgm(true)
        return
      }
      pause()
      drag.current = event.clientY
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => { if (drag.current !== null) { add((drag.current - event.clientY) * 2); drag.current = event.clientY } }}
    onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
    <Canvas dpr={[1, 2]} shadows gl={VIEW_GL}
      camera={{ position: project.book.camera.position, fov: project.book.camera.fov, ...VIEW_CLIP }}
      onCreated={({ camera }) => camera.lookAt(...project.book.camera.target)}>
      <BookRuntime project={project} progress={progress} playing={playback !== 'manual'} contentTime={contentTime} audioActive audioMuted={audioMuted} />
    </Canvas>
    <style>{BAR_CSS}</style>
    <PlayerState project={project} playback={playback} spreadIndex={spreadIndex} />
    <div className="tobiPages" role="group" aria-label="Pages" data-audio={hasAudio ? '' : 'none'}>
      {project.book.spreads.map((spread, index) => <button key={spread.id} className="tobiPage"
        aria-label={`Page ${index + 1}`} aria-current={index === spreadIndex ? 'page' : undefined}
        onClick={() => jumpToSpread(index)}>{index + 1}</button>)}
    </div>
    <div className="tobiBar" data-audio={hasAudio ? '' : 'none'}>
      <button className="tobiKey" aria-label={playback === 'auto' ? 'Pause' : progress >= 1 ? 'Replay from start' : 'Play'}
        onClick={togglePlayback}>
        <Icon as={playback === 'auto' ? Pause : progress >= 1 ? RotateCcw : Play} size={16} />
      </button>
      <div className="tobiTrack">
        <input aria-label="Book progress" type="range" min={0} max={1} step={0.001} value={progress}
          style={{ background: `linear-gradient(to right, #168af0 0%, #168af0 ${progress * 100}%, #d6d6dd ${progress * 100}%, #d6d6dd 100%)` }}
          onPointerDown={pause}
          onChange={(event) => seek(Number(event.target.value))} />
      </div>
      {hasAudio && <button className="tobiKey" aria-label={audioMuted ? 'Unmute audio' : 'Mute audio'}
        onClick={toggleAudio}>
        <Icon as={audioMuted ? VolumeX : Volume2} size={16} />
      </button>}
    </div>
  </div>
}

/**
 * ブラウザを操作するエージェント向けの意味付きDOM。画面には出さない。
 *
 * 外部TTSで読ませる作品は `readAloud` を切って書き出し、エージェントは見開きボタンを押して
 * `data-tobidas-playback` が manual に戻るのを待ち、ここの本文一覧を読む。
 * 本文は Web Speech と同じ `spreadSpeechCues` から作るので、読む対象と順序は一致する。
 * 表紙を開いている間は見開きが無いので添字を付けず、一覧も空にする。
 */
function PlayerState({ project, playback, spreadIndex: index }: { project: BookProject; playback: Playback; spreadIndex: number }) {
  const spread = project.book.spreads[index]
  const items = useMemo(() => spread ? spreadSpeechCues(project.book, spread.id) : [], [project, spread])
  return <div data-tobidas-kind="player-state" data-tobidas-playback={playback}
    data-tobidas-spread-index={index >= 0 ? index : undefined}
    data-tobidas-spread-count={project.book.spreads.length}
    data-tobidas-read-aloud={project.book.readAloud ? 'true' : 'false'}
    style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
    <ol aria-label="Current spread text">
      {items.map((item) => <li key={item.elementId} data-tobidas-element={item.elementId} lang={item.lang}>{item.text}</li>)}
    </ol>
  </div>
}

/**
 * 再生バー。ビルダーの再生モードのバー (builder.module.css の .timeline 一式) と
 * 同じ見た目にしてある。同じ操作なので見た目まで揃える。
 *
 * 擬似要素 (::-webkit-slider-thumb) はインラインstyleで書けないので、ここだけ
 * style要素で持つ。単一HTMLへインライン化されるため外部CSSは参照できない。
 * 音声ボタンが無い作品では3列目を潰す (固定幅だと右に空白が残る)。
 */
const BAR_CSS = `
.tobiBar {
  position: fixed;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: min(720px, calc(100% - 40px));
  box-sizing: border-box;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border: 1px solid #4a4a58;
  border-radius: 20px;
  background: #202028e8;
  color: #fff;
  font-size: 12px;
}
.tobiBar[data-audio='none'] { grid-template-columns: 34px minmax(0, 1fr); }
.tobiPages {
  position: fixed;
  bottom: 64px;
  left: 50%;
  transform: translateX(-50%);
  width: min(720px, calc(100% - 40px));
  box-sizing: border-box;
  display: flex;
  gap: 4px;
  /* 左右は再生ボタン・音声ボタンとその間隔のぶんを空け、進行バーと横幅を揃える */
  padding: 0 58px;
}
.tobiPages[data-audio='none'] { padding-right: 14px; }
.tobiPage {
  flex: 1 1 0;
  min-width: 0;
  height: 20px;
  margin: 0;
  padding: 0;
  border: 1px solid #ffffff40;
  border-radius: 6px;
  background: #20202880;
  color: #f4f4f8;
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
}
.tobiPage:hover { border-color: #6bb6ff; background: #414152c0; }
.tobiPage[aria-current='page'] { border-color: #6bb6ffc0; background: #168af0b0; color: #fff; }
.tobiKey {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 26px;
  margin: 0;
  padding: 0;
  border: 1px solid #626270;
  border-radius: 7px;
  background: #343440;
  color: #f4f4f8;
  cursor: pointer;
  line-height: 1;
}
.tobiKey:hover { border-color: #6bb6ff; background: #414152; }
.tobiTrack { position: relative; display: flex; min-width: 0; }
.tobiBar input[type='range'] {
  appearance: none;
  width: 100%;
  height: 14px;
  min-width: 0;
  margin: 0;
  border-radius: 7px;
  cursor: pointer;
}
.tobiBar input[type='range']::-webkit-slider-thumb {
  appearance: none;
  width: 22px;
  height: 22px;
  border: 2px solid #6bb6ff;
  border-radius: 50%;
  background: #168af0;
  box-shadow: 0 1px 4px rgb(0 0 0 / 35%);
}
.tobiBar input[type='range']::-moz-range-track {
  height: 14px;
  border-radius: 7px;
  background: transparent;
}
.tobiBar input[type='range']::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border: 2px solid #6bb6ff;
  border-radius: 50%;
  background: #168af0;
  box-shadow: 0 1px 4px rgb(0 0 0 / 35%);
}
`

function initialProgressFromUrl(): number {
  const value = Number(new URLSearchParams(location.search).get('progress') ?? 0)
  return Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0
}
