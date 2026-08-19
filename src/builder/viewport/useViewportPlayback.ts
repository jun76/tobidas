import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { playbackDurationSeconds } from '../../runtime/signals'
import { crossedSoundCues, soundCueAssetIds } from '../../runtime/soundCues'
import { audioGate } from '../../audio/playback'
import { useBuilderStore } from '../store'
import { builderBank, builderBgm } from '../audio'
import { hasEmbeddedVideoAudio, unlockVideoAudio } from '../../runtime/videoAudio'

export function useViewportPlayback() {
  const mode = useBuilderStore((state) => state.mode)
  const previewProgress = useBuilderStore((state) => state.previewProgress)
  const book = useBuilderStore((state) => state.project.book)
  const bookAudio = useBuilderStore((state) => state.project.audio)
  const assets = useBuilderStore((state) => state.project.assets)
  const setPreviewProgress = useBuilderStore((state) => state.setPreviewProgress)
  const [playProgress, setPlayProgress] = useState(0)
  const playProgressRef = useRef(0)
  const [isAutoPlaying, setIsAutoPlaying] = useState(false)
  const autoPlayingRef = useRef(false)
  /** 音声ボタンで消したか。BGMも効果音もまとめて黙らせる。再生の開始・停止を跨いで覚える */
  const [audioMuted, setAudioMuted] = useState(false)
  const audioMutedRef = useRef(false)
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

  useLayoutEffect(() => {
    if (mode === 'play' && previousMode.current !== 'play') {
      target.current = 0
      playProgressRef.current = 0
      setPlayProgress(0)
    }
    if (mode !== 'play') {
      autoPlayingRef.current = false
      setIsAutoPlaying(false)
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
   * BGMは再生モードの間だけ鳴らす。編集へ戻ったら止める。
   * 再生ボタンを押した操作が自動再生制限を解くので、ここから鳴らしてよい。
   */
  useEffect(() => {
    if (mode !== 'play') {
      builderBgm.stop()
      return
    }
    const audio = bookAudio
    const asset = assets.find((item) => item.id === audio?.bgmAsset)
    if (!audio || !asset) return
    let cancelled = false
    void builderBgm.load(asset)
      .then(() => {
        if (cancelled || audioMutedRef.current) return
        void builderBgm.play(audio.volume, audio.loop)
        // 再生していない間に鳴り始めたぶんはその場で止める (音は再生中だけ)。
        // 終端で止まっているぶんは切らない (上の useEffect と同じ約束)
        builderBgm.setPaused(!autoPlayingRef.current && playProgressRef.current < 1)
      })
      .catch((reason) => console.warn('failed to load BGM:', reason))
    return () => {
      cancelled = true
      builderBgm.stop()
    }
  }, [mode, bookAudio, assets])

  /**
   * 音が出る条件は `audioGate` だけが持つ (再生画面とまったく同じ規則)。
   * 編集モードでは `active` が降りるので、BGMは止まり、効果音の消音は中立へ戻る
   * (アセット一覧の試し聞きは別経路。立てたまま残す理由がない)。
   */
  useEffect(() => {
    const active = mode === 'play'
    const gate = audioGate({ active, playing: active && isAutoPlaying, atEnd, muted: audioMuted })
    // 終端シークで再開する場合も、先に完全消音してから時計を動かす。
    builderBgm.setMuted(gate.bgmMuted, gate.bgmMuted ? 0 : .25)
    builderBgm.setPaused(gate.bgmPaused)
    builderBank.setCuesMuted(gate.cuesMuted)
  }, [mode, isAutoPlaying, atEnd, audioMuted])

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
      if (!autoPlayingRef.current || audioMutedRef.current) return
      for (const hit of crossedSoundCues(book, from, to)) builderBank.fire(hit.assetId)
    }
    const tick = (time: number) => {
      const elapsed = Math.min(0.1, Math.max(0, (time - previousTime) / 1000))
      previousTime = time
      const current = playProgressRef.current
      if (autoPlayingRef.current) {
        const next = Math.min(1, current + elapsed / playbackDuration)
        playProgressRef.current = next
        target.current = next
        setPlayProgress(next)
        fireCues(current, next)
        sync(next, 120)
        if (next >= 1) {
          autoPlayingRef.current = false
          setIsAutoPlaying(false)
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
    if (!autoPlayingRef.current) return
    autoPlayingRef.current = false
    setIsAutoPlaying(false)
    setPreviewProgress(playProgressRef.current)
  }

  const toggle = () => {
    unlockVideoAudio()
    if (autoPlayingRef.current) {
      pause()
      return
    }
    if (playProgressRef.current >= 1) {
      playProgressRef.current = 0
      target.current = 0
      setPlayProgress(0)
      setPreviewProgress(0)
    }
    autoPlayingRef.current = true
    setIsAutoPlaying(true)
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
    builderBank.setCuesMuted(mode === 'play' && (muted || !autoPlayingRef.current))
    setAudioMuted(muted)
    if (!muted && bookAudio && !builderBgm.playing) {
      void builderBgm.play(bookAudio.volume, bookAudio.loop)
      builderBgm.setPaused(!autoPlayingRef.current && playProgressRef.current < 1)
    }
  }

  return {
    progress,
    isAutoPlaying,
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
      target.current = THREE.MathUtils.clamp(target.current + pixels / 4200, 0, 1)
      // 送っている途中で編集へ戻しても、送り先の見開きへ戻れるようにする
      sync(target.current)
    },
    pause,
    toggle,
  }
}

