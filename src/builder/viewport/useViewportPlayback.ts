import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { playbackDurationSeconds } from '../../runtime/signals'
import { crossedSoundCues, soundCueAssetIds } from '../../runtime/soundCues'
import { crossedSpeechCues, SpeechNarrator } from '../../runtime/speech'
import { pageTurnPlan, pageTurnTarget } from '../../runtime/pageTurn'
import { audioGate } from '../../audio/playback'
import { useBuilderStore } from '../store'
import { builderBank, builderBgm } from '../audio'

/** 読み上げはビルダーで一つ。再生モードの間だけ使い、編集へ戻ると消音側で打ち切られる */
const builderNarrator = new SpeechNarrator()
import { hasEmbeddedVideoAudio, unlockVideoAudio } from '../../runtime/videoAudio'

/** 再生の状態。書き出した再生画面 (player/PlayerApp.tsx) と同じ3つ */
export type ViewportPlayback = 'auto' | 'manual' | 'turning'

export function useViewportPlayback() {
  const mode = useBuilderStore((state) => state.mode)
  const previewProgress = useBuilderStore((state) => state.previewProgress)
  const book = useBuilderStore((state) => state.project.book)
  const bookAudio = useBuilderStore((state) => state.project.audio)
  const assets = useBuilderStore((state) => state.project.assets)
  const setPreviewProgress = useBuilderStore((state) => state.setPreviewProgress)
  const [playProgress, setPlayProgress] = useState(0)
  const playProgressRef = useRef(0)
  const [playbackState, setPlaybackState] = useState<ViewportPlayback>('manual')
  const playbackRef = useRef<ViewportPlayback>('manual')
  /** turning の目的地と向き。到着で manual へ戻るときに消す */
  const turn = useRef<{ target: number; direction: 1 | -1 } | null>(null)
  const isAutoPlaying = playbackState === 'auto'
  /** 自動再生・ページ送りを止めて手動モードへ戻す */
  const settle = () => {
    turn.current = null
    if (playbackRef.current === 'manual') return
    playbackRef.current = 'manual'
    setPlaybackState('manual')
  }
  /** 音声ボタンで消したか。BGMも効果音もまとめて黙らせる。再生の開始・停止を跨いで覚える */
  const [audioMuted, setAudioMuted] = useState(false)
  const audioMutedRef = useRef(false)
  /** 再生モードへ入っただけではBGMを開始せず、再生ボタンかシークバーの操作を待つ */
  const bgmArmedRef = useRef(false)
  /** 終端で止まっているか。止めたのではなく終わったので、BGMはここで切らない */
  const atEnd = playProgress >= 1
  const target = useRef(playProgress)
  const previousMode = useRef(mode)
  const synced = useRef({ value: -1, at: 0 })

  /**
   * 再生で見ている位置をストアへ返す。
   *
   * 返さないと、再生でめくった先が編集へ伝わらない (再生中の送りは target と
   * playProgress だけを動かす)。編集から戻る先の見開きはこの値で決まる。
   * ただし編集パネルは再生中も出たままなので、毎フレーム返すと再生のあいだ
   * ずっとパネルを描き直すことになる。送っている最中は間引き、止まった
   * 時点では必ず返す。
   */
  const sync = (value: number, throttleMs = 0) => {
    const now = performance.now()
    if (value === synced.current.value || now - synced.current.at < throttleMs) return
    synced.current = { value, at: now }
    setPreviewProgress(value)
  }
  const enteringPlay = mode === 'play' && previousMode.current !== 'play'
  const progress = mode === 'play' ? (enteringPlay ? 0 : playProgress) : previewProgress
  const playbackDuration = playbackDurationSeconds(book)

  const startBgm = (arm = false) => {
    if (arm) bgmArmedRef.current = true
    if (!bgmArmedRef.current || !bookAudio || builderBgm.playing || audioMutedRef.current) return
    void builderBgm.play(bookAudio.volume, bookAudio.loop)
  }

  useLayoutEffect(() => {
    if (mode === 'play' && previousMode.current !== 'play') {
      target.current = 0
      playProgressRef.current = 0
      // 前回の停止位置を外部シークの反響と誤認しないよう、再入場時に同期履歴も戻す。
      synced.current = { value: 0, at: 0 }
      setPlayProgress(0)
    }
    if (mode !== 'play') {
      settle()
      bgmArmedRef.current = false
    }
    previousMode.current = mode
  }, [mode])

  useEffect(() => {
    if (mode !== 'play') return
    // 自分が返した値は無視する。送っている最中に古い書き戻しを受け取ると、
    // 送り先が書き戻した時点まで巻き戻り、スクロールが頭打ちになる。
    // 外から進行値を動かされたとき (タイムラインの目盛りなど) だけ追従する
    if (previewProgress === synced.current.value) return
    target.current = previewProgress
  }, [mode, previewProgress])

  /**
   * BGMは再生モードの間だけ鳴らす。編集へ戻ったら止める。読み上げの途中も打ち切る。
   * 初回は再生ボタンかシークバーの操作を待つ。再生モードへ入っただけでは鳴らさない。
   */
  useEffect(() => {
    if (mode !== 'play') {
      builderBgm.stop()
      builderNarrator.cancel()
      return
    }
    const audio = bookAudio
    const asset = assets.find((item) => item.id === audio?.bgmAsset)
    if (!audio || !asset) return
    let cancelled = false
    void builderBgm.load(asset)
      .then(() => {
        if (cancelled || audioMutedRef.current) return
        startBgm()
      })
      .catch((reason) => console.warn('failed to load BGM:', reason))
    return () => {
      cancelled = true
      builderBgm.stop()
      builderNarrator.cancel()
    }
  }, [mode, bookAudio, assets])

  /**
   * 音が出る条件は `audioGate` だけが持つ (再生画面とまったく同じ規則)。
   * 編集モードでは `active` が降りるので、BGMは止まり、効果音の消音は中立へ戻る。
   * 再生モードでは一時停止中もBGMを流し、効果音だけを抑制する。
   */
  useEffect(() => {
    const active = mode === 'play'
    // ページ送りの間も作者の速度で進んでいるので、効果音は自動再生と同じく鳴らす
    const gate = audioGate({ active, playing: active && playbackState !== 'manual', muted: audioMuted })
    builderBgm.setMuted(gate.bgmMuted, gate.bgmMuted ? 0 : .25)
    builderBgm.setPaused(gate.bgmPaused)
    builderBank.setCuesMuted(gate.cuesMuted)
    builderNarrator.setMuted(gate.cuesMuted)
  }, [mode, playbackState, audioMuted])

  /**
   * 効果音は再生モードでだけ鳴らす。編集中のスクラブでいちいち鳴っては
   * 作業にならないし、音は跨いだ瞬間の出来事なので進行値の関数にもできない。
   * 効果音は連続再生で位置を跨いだときだけ鳴らす。
   */
  useEffect(() => {
    if (mode !== 'play') return
    for (const id of soundCueAssetIds(book)) {
      const asset = assets.find((item) => item.id === id)
      if (asset) void builderBank.load(asset)
    }
  }, [mode, book, assets])

  useEffect(() => {
    if (mode !== 'play') return
    let frame = 0
    let previousTime = performance.now()
    // 鳴らすのは自動再生で進んでいる間だけ。つまみやホイールで動かしたぶんでは鳴らさない
    // (上の useEffect も消音を掛けるが、あちらは再描画ぶん遅れるので位置を先に見る)
    const fireCues = (from: number, to: number) => {
      if (playbackRef.current === 'manual' || audioMutedRef.current) return
      for (const hit of crossedSoundCues(book, from, to)) builderBank.fire(hit.assetId)
      builderNarrator.speak(crossedSpeechCues(book, from, to))
    }
    const tick = (time: number) => {
      const elapsed = Math.min(0.1, Math.max(0, (time - previousTime) / 1000))
      previousTime = time
      const current = playProgressRef.current
      if (playbackRef.current === 'auto') {
        const next = Math.min(1, current + elapsed / playbackDuration)
        playProgressRef.current = next
        target.current = next
        setPlayProgress(next)
        fireCues(current, next)
        sync(next, 120)
        if (next >= 1) {
          settle()
          sync(next)
        }
      } else if (playbackRef.current === 'turning' && turn.current) {
        // 目的地を跨いだら目的地で止める。作者の速度で進むので、めくりと演出は自動再生と同じ見え方になる
        const { target: goal, direction } = turn.current
        const step = elapsed / playbackDuration
        const next = direction > 0 ? Math.min(goal, current + step) : Math.max(goal, current - step)
        playProgressRef.current = next
        target.current = next
        setPlayProgress(next)
        fireCues(current, next)
        sync(next, 120)
        if (next === goal) {
          settle()
          sync(next)
        }
      } else {
        const damped = THREE.MathUtils.damp(current, target.current, 10, elapsed)
        const next = Math.abs(damped - target.current) < 0.0001 ? target.current : damped
        if (next !== current) {
          playProgressRef.current = next
          setPlayProgress(next)
          fireCues(current, next)
          // 動きが収まった時点でストアへ返す。ここを返さないと、再生で
          // めくった先が編集へ伝わらず、戻り先が入場時のページのままになる
          if (next === target.current) sync(next)
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [mode, book, playbackDuration, setPreviewProgress])

  const pause = () => {
    if (playbackRef.current === 'manual') return
    settle()
    setPreviewProgress(playProgressRef.current)
  }

  const toggle = () => {
    unlockVideoAudio()
    startBgm(true)
    if (playbackRef.current === 'auto') {
      pause()
      return
    }
    // 手動モードやページ送りの途中からは、その位置から自動再生へ移る
    turn.current = null
    if (playProgressRef.current >= 1) {
      playProgressRef.current = 0
      target.current = 0
      setPlayProgress(0)
      setPreviewProgress(0)
    }
    playbackRef.current = 'auto'
    setPlaybackState('auto')
  }

  /**
   * 見開き単位のページ送り (書き出した再生画面と同じ)。自動再生中なら止めて手動モードへ移り、
   * 保持の途中ならめくりが始まるフレームへ飛んでから、目的地の保持終端まで作者の速度で進める。
   */
  const turnPage = (direction: 1 | -1) => {
    const plan = pageTurnPlan(book, playProgressRef.current, direction)
    if (!plan) return
    unlockVideoAudio()
    startBgm(true)
    if (plan.start !== playProgressRef.current) {
      // 保持の途中なら、めくりが始まるフレームへ直ちに飛ぶ。飛ばした区間の効果音は鳴らさない
      playProgressRef.current = plan.start
      target.current = plan.start
      setPlayProgress(plan.start)
    }
    turn.current = { target: plan.target, direction }
    playbackRef.current = 'turning'
    setPlaybackState('turning')
  }

  /**
   * 再生バーで指定された位置へ即座に移動する。
   *
   * ホイールや画面ドラッグは紙を送る操作なので target まで補間するが、再生バーは
   * 時刻を直接指定する操作である。target だけを変えるとクリック位置へ少しずつしか
   * 近づかないため、表示値と編集へ戻る位置も同じフレームで確定させる。
   */
  const seek = (value: number) => {
    unlockVideoAudio()
    pause()
    startBgm(true)
    const next = THREE.MathUtils.clamp(value, 0, 1)
    target.current = next
    playProgressRef.current = next
    setPlayProgress(next)
    sync(next)
  }

  /**
   * 音声ボタンは消音の切り替え (再生画面と同じ)。BGMも効果音もまとめて消す。
   * 実際の適用は上の useEffect が状態から引き直すので、ここは意思を記録して、
   * まだ鳴っていなければ鳴らし始めるだけ。
   */
  const toggleAudio = () => {
    const muted = !audioMutedRef.current
    if (!muted) unlockVideoAudio()
    audioMutedRef.current = muted
    // Reactのeffectを待たず、このクリック内で音源と効果音を閉じる。
    builderBgm.setMuted(muted, 0)
    builderBank.setCuesMuted(mode === 'play' && (muted || playbackRef.current === 'manual'))
    setAudioMuted(muted)
    if (!muted && bookAudio && !builderBgm.playing) {
      startBgm()
    }
  }

  return {
    progress,
    playback: playbackState,
    isAutoPlaying,
    canTurn: (direction: 1 | -1) => pageTurnTarget(book, progress, direction) !== undefined,
    turnPage,
    // 終端では再生ボタンが「最初から」の絵になる (書き出した再生画面と同じ)
    atEnd,
    // 音声ボタンはBGMと効果音の両方を消すので、どちらかを持つ作品なら出す
    hasAudio: Boolean(bookAudio) || soundCueAssetIds(book).length > 0
      || hasEmbeddedVideoAudio(book, new Map(assets.map((asset) => [asset.id, asset]))),
    audioMuted,
    toggleAudio,
    seek,
    adjust: (pixels: number) => {
      unlockVideoAudio()
      startBgm()
      target.current = THREE.MathUtils.clamp(target.current + pixels / 4200, 0, 1)
      // 送っている途中で編集へ戻しても、送り先の見開きへ戻れるようにする
      sync(target.current)
    },
    pause,
    toggle,
  }
}

