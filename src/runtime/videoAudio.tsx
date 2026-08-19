import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Book } from '../schema/book'
import { DEFAULT_EMBEDDED_VIDEO_AUDIO, type EmbeddedVideoAudio } from '../schema/audio'
import type { Asset } from '../schema/assets'
import { CAMERA_REFERENCE_ASPECT, evaluatePlayCameraPose } from './camera/playCamera'

interface RuntimeVideoAudio {
  listener: THREE.AudioListener
  audible: boolean
  pageWidth: number
}

const VideoAudioContext = createContext<RuntimeVideoAudio | null>(null)

interface Attachment {
  audio: THREE.Audio<GainNode> | THREE.PositionalAudio
  video: HTMLVideoElement
  desiredAudible: boolean
  refs: number
  connected: boolean
  disposeTimer?: ReturnType<typeof setTimeout>
}

const attachments = new Set<Attachment>()
const attachmentsByVideo = new WeakMap<HTMLVideoElement, Attachment>()
let unlocked = false

/** ユーザー操作の同期区間でWeb Audioと動画要素の自動再生制限を解除する。 */
export function unlockVideoAudio(): void {
  unlocked = true
  try {
    void THREE.AudioContext.getContext().resume()
  } catch {
    // Web Audioを持たない検査環境では何もしない。
  }
  for (const attachment of attachments) applyGate(attachment)
}

export function VideoAudioProvider({ book, progress, active, muted, children }: {
  book: Book
  progress: number
  active: boolean
  muted: boolean
  children: React.ReactNode
}) {
  const listener = useMemo(() => new THREE.AudioListener(), [])
  const value = useMemo(() => ({
    listener,
    audible: active && !muted,
    pageWidth: book.format.pageWidth,
  }), [listener, active, muted, book.format.pageWidth])

  // 音像は端末の縦横比によるカメラ後退へ引きずらず、作品が持つ基準カメラへ固定する。
  useFrame(() => {
    const pose = evaluatePlayCameraPose(book, progress, CAMERA_REFERENCE_ASPECT)
    listener.position.set(...pose.position)
    listener.up.set(0, 1, 0)
    listener.lookAt(...pose.target)
    listener.updateMatrixWorld()
  })

  useEffect(() => () => {
    listener.removeFromParent()
    try { listener.gain.disconnect() } catch { /* 既に切断済み */ }
  }, [listener])

  return <VideoAudioContext.Provider value={value}>
    <primitive object={listener} />
    {children}
  </VideoAudioContext.Provider>
}

/** 同じ動画要素を映像と音の両方へ使い、位置音源を描画ツリーへ取り付ける。 */
export function VideoAudioSource({ video, settings, positional = true, active = true }: {
  video?: HTMLVideoElement
  settings?: EmbeddedVideoAudio
  positional?: boolean
  /** ページ面が現在の音声対象か。未指定設定の既定再生と分けて扱う。 */
  active?: boolean
}) {
  const runtime = useContext(VideoAudioContext)
  const [audio, setAudio] = useState<Attachment['audio'] | null>(null)

  useEffect(() => {
    const effective = settings ?? DEFAULT_EMBEDDED_VIDEO_AUDIO
    if (!runtime || !video || !active || !effective.enabled) {
      setAudio(null)
      if (video) video.muted = true
      return
    }
    let attachment = attachmentsByVideo.get(video)
    if (!attachment) {
      const node = positional
        ? new THREE.PositionalAudio(runtime.listener)
        : new THREE.Audio(runtime.listener)
      node.setMediaElementSource(video)
      attachment = { audio: node, video, desiredAudible: false, refs: 0, connected: true }
      attachmentsByVideo.set(video, attachment)
    }
    if (attachment.disposeTimer) clearTimeout(attachment.disposeTimer)
    if (!attachment.connected) {
      attachment.audio.connect()
      attachment.connected = true
    }
    attachment.refs++
    attachments.add(attachment)
    attachment.audio.setVolume(effective.volume)
    if (attachment.audio instanceof THREE.PositionalAudio) {
      attachment.audio.setDistanceModel('inverse')
      attachment.audio.setRefDistance(effective.referenceDistance * runtime.pageWidth)
      attachment.audio.setRolloffFactor(effective.rolloffFactor)
      attachment.audio.panner.panningModel = 'HRTF'
    }
    attachment.desiredAudible = runtime.audible
    applyGate(attachment)
    setAudio(attachment.audio)
    return () => {
      attachment!.desiredAudible = false
      applyGate(attachment!)
      attachment!.refs--
      if (attachment!.refs <= 0) {
        attachment!.disposeTimer = setTimeout(() => {
          if (attachment!.refs > 0) return
          attachment!.audio.removeFromParent()
          attachment!.audio.disconnect()
          attachment!.connected = false
          attachments.delete(attachment!)
        }, 0)
      }
      setAudio(null)
    }
  }, [runtime, video, settings, positional, active])

  return audio ? <primitive object={audio} /> : null
}

function applyGate(attachment: Attachment): void {
  const audible = unlocked && attachment.desiredAudible
  attachment.video.muted = !audible
  if (audible) void attachment.video.play().catch(() => { /* 次のユーザー操作で再試行する */ })
}

/** 再生バーへ音声ボタンを出す必要があるか。 */
export function hasEmbeddedVideoAudio(book: Book, assets?: ReadonlyMap<string, Pick<Asset, 'type'>>): boolean {
  const enabled = (value: EmbeddedVideoAudio | undefined, assetId?: string) => value?.enabled === true
    || (value === undefined && assetId !== undefined && assets?.get(assetId)?.type === 'video')
  const timelineHasVideo = (spread: Book['spreads'][number]) => spread.timeline.tracks.some((track) =>
    track.property === 'visual.image'
      && track.keys.some((key) => typeof key.value === 'string' && assets?.get(key.value)?.type === 'video'))
  if (enabled(book.appearance.backgroundVideoAudio, book.appearance.backgroundAsset)) return true
  if (enabled(book.frontCover.frontVideoAudio, book.frontCover.frontAsset)
    || enabled(book.frontCover.backVideoAudio, book.frontCover.backAsset)) return true
  if (enabled(book.backCover.frontVideoAudio, book.backCover.frontAsset)
    || enabled(book.backCover.backVideoAudio, book.backCover.backAsset)) return true
  return book.spreads.some((spread) => enabled(spread.leftPage.backgroundVideoAudio, spread.leftPage.backgroundAsset)
    || enabled(spread.rightPage.backgroundVideoAudio, spread.rightPage.backgroundAsset)
    || timelineHasVideo(spread)
    || spread.elements.some((element) => element.type === 'visual'
      && (enabled(element.videoAudio, element.image) || enabled(element.backVideoAudio, element.backImage))))
}
