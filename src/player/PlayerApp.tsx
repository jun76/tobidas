import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react'
import { Icon } from '../ui/Icon'
import type { BookProject } from '../schema/bookPackage'
import { validateBookProject } from '../schema/bookValidate'
import { BookRuntime } from '../runtime/BookRuntime'
import { hasEmbeddedVideoAudio, unlockVideoAudio } from '../runtime/videoAudio'
import { VIEW_CLIP, VIEW_GL } from '../runtime/camera/view'
import { AudioBank, AudioPlayback, audioGate } from '../audio/playback'
import { playbackDurationSeconds } from '../runtime/signals'
import { crossedSoundCues, soundCueAssetIds } from '../runtime/soundCues'

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
  const [playing, setPlaying] = useState(false)
  const playingRef = useRef(false)
  const target = useRef(initialProgress)
  const drag = useRef<number | null>(null)
  const bgm = useMemo(() => new AudioPlayback(), [])
  const bank = useMemo(() => new AudioBank(), [])
  /** audioMuted の即値。消した後に操作しても BGM を鳴らし直させない */
  const audioMutedRef = useRef(false)
  /** 終端で止まっているか。止めたのではなく終わったので、BGMはここで切らない */
  const atEnd = progress >= 1

  useEffect(() => {
    try {
      const embedded = document.getElementById('tobidas-project')?.textContent?.trim()
      if (!embedded || embedded === 'null') {
        throw new Error('No book data is embedded.\nOpen the HTML produced by the builder site export.')
      }
      const data: unknown = JSON.parse(embedded)
      const validation = validateBookProject(data)
      if (!validation.ok) throw new Error('Book validation failed:\n' + validation.errors.join('\n'))
      setProject(data as BookProject)
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
        if (playingRef.current && project) {
          next = Math.min(1, value + delta / playbackDurationSeconds(project.book))
          target.current = next
          if (next >= 1) {
            playingRef.current = false
            setPlaying(false)
          }
        } else {
          next = THREE.MathUtils.damp(value, target.current, 12, delta)
        }
        // 進んだぶんで跨いだ効果音を鳴らす。逆行と飛ばしは crossedSoundCues が弾き、
        // 止まっている間 (つまみ・ホイール・drag での移動) はここで弾く。
        // 消音は上の useEffect も掛けるが、あちらは再描画ぶん遅れるので位置を先に見る
        if (project && playingRef.current && !audioMutedRef.current) {
          for (const hit of crossedSoundCues(project.book, value, next)) bank.fire(hit.assetId)
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
      playingRef.current = false
      setPlaying(false)
      target.current = THREE.MathUtils.clamp(value, 0, 1)
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
   * 取りこぼしを防ぐため、状態から毎回引き直す。BGMの止め方が一時停止と消音の
   * 2通りあるのは音の性質の違いで、どちらも音源を作り直さない (作り直すと頭から鳴る)。
   * 進行値そのものを依存に置くと毎フレーム走るので、終端は真偽値へ落として渡す。
   */
  useEffect(() => {
    const gate = audioGate({ active: true, playing, atEnd, muted: audioMuted })
    // 終端シークで再開する場合も、先に完全消音してから時計を動かす。
    bgm.setMuted(gate.bgmMuted, gate.bgmMuted ? 0 : .25)
    bgm.setPaused(gate.bgmPaused)
    bank.setCuesMuted(gate.cuesMuted)
  }, [playing, atEnd, audioMuted, bgm, bank])

  // 効果音は跨いだ瞬間に鳴らすので、待たせないよう先に読み込んでおく
  useEffect(() => {
    if (!project) return
    for (const id of soundCueAssetIds(project.book)) {
      const asset = project.assets.find((item) => item.id === id)
      if (asset) void bank.load(asset)
    }
  }, [project, bank])

  /**
   * BGMは冒頭からループ再生する。ただし自動再生制限があるので、
   * 最初のユーザー操作まで待つ。以降は音楽ボタンで切り替える。
   */
  const startBgm = () => {
    if (!project?.audio || bgm.playing || audioMutedRef.current) return
    void bgm.play(project.audio.volume, project.audio.loop)
    // 止めている最中の操作で鳴り始めたぶんは、その場で止めておく。
    // playing の同期は上の useEffect が持つが、それは状態が変わったときにしか働かない。
    // 終端で鳴り始めたぶんは止めない (上と同じ約束。target は終端で 1 のまま)
    bgm.setPaused(!playingRef.current && target.current < 1)
  }

  if (error) return <pre style={{ padding: 20, color: '#c33', whiteSpace: 'pre-wrap' }}>{error}</pre>
  if (!project) return <div style={{ padding: 20, fontFamily: 'sans-serif' }}>Loading…</div>
  // 音声ボタンはBGMと効果音の両方を消すので、どちらかを持つ作品なら出す
  const hasAudio = Boolean(project.audio) || soundCueAssetIds(project.book).length > 0
    || hasEmbeddedVideoAudio(project.book)
  const pause = () => { playingRef.current = false; setPlaying(false) }
  const add = (pixels: number) => {
    unlockVideoAudio()
    pause()
    startBgm()
    target.current = THREE.MathUtils.clamp(target.current + pixels / 4200, 0, 1)
  }
  const seek = (value: number) => {
    unlockVideoAudio()
    pause()
    startBgm()
    target.current = THREE.MathUtils.clamp(value, 0, 1)
    setProgress(target.current)
  }
  const togglePlayback = () => {
    unlockVideoAudio()
    startBgm()
    if (playingRef.current) {
      pause()
      return
    }
    if (progress >= 1) {
      target.current = 0
      setProgress(0)
    }
    playingRef.current = true
    setPlaying(true)
  }
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
    bank.setCuesMuted(muted || !playingRef.current)
    setAudioMuted(muted)
    // 消音を解いた時点でまだ鳴っていなければ、ここが最初のユーザー操作になる
    if (!muted) startBgm()
  }

  return <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', touchAction: 'none' }}
    onWheel={(event) => add(event.deltaY)}
    onPointerDown={(event) => {
      if ((event.target as HTMLElement).closest('button, input')) return
      pause()
      drag.current = event.clientY
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => { if (drag.current !== null) { add((drag.current - event.clientY) * 2); drag.current = event.clientY } }}
    onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
    <Canvas dpr={[1, 2]} shadows gl={VIEW_GL}
      camera={{ position: project.book.camera.position, fov: project.book.camera.fov, ...VIEW_CLIP }}
      onCreated={({ camera }) => camera.lookAt(...project.book.camera.target)}>
      <BookRuntime project={project} progress={progress} audioActive audioMuted={audioMuted} />
    </Canvas>
    <style>{BAR_CSS}</style>
    <div className="tobiBar" data-audio={hasAudio ? '' : 'none'}>
      <button className="tobiKey" aria-label={playing ? 'Pause' : progress >= 1 ? 'Replay from start' : 'Play'}
        onClick={togglePlayback}>
        <Icon as={playing ? Pause : progress >= 1 ? RotateCcw : Play} size={16} />
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
