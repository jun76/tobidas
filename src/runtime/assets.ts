import { useEffect, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { isExternalAssetData, type Asset } from '../schema/assets'
import type { VisualElement } from '../schema/stageElement'
import { canvasFont, TEXT_LINE_HEIGHT, TEXT_SIDE_PAD, type TextStyle } from './textStyle'

/**
 * 素材の読み込み。
 * - SVG は標準では画像としてラスタライズして平面へ (仕様 §8)
 * - PNG/WebP は data URL からテクスチャ化
 * - 同じ実体のテクスチャは配置物間で共有する
 *
 * 素材は制作中は data URL (SVGはテキスト) で、書き出したサイトでは外部ファイルへの
 * 相対URLで届く。どちらも `<img>` に読ませられるので経路は一本で済む。
 */

export interface TextureResult {
  texture: THREE.Texture
  /** width / height */
  aspect: number
}

const MAX_TEX = 2048
const imageTextureCache = new Map<string, Promise<TextureResult>>()
const svgTextureCache = new Map<string, Promise<TextureResult>>()

export interface VideoTextureResult extends TextureResult {
  video: HTMLVideoElement
}

export interface MediaTextureResult extends TextureResult {
  video?: HTMLVideoElement
}

// ---------------------------------------------------------------------------
// SVG → ラスタテクスチャ
// ---------------------------------------------------------------------------

function svgIntrinsicSize(svgText: string): { w: number; h: number; text: string } {
  try {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
    const root = doc.documentElement
    let w = parseFloat(root.getAttribute('width') ?? '')
    let h = parseFloat(root.getAttribute('height') ?? '')
    const vb = root.getAttribute('viewBox')
    if ((!w || !h) && vb) {
      const p = vb.trim().split(/[\s,]+/).map(Number)
      w = w || p[2]
      h = h || p[3]
    }
    if (!w || !h || !isFinite(w) || !isFinite(h)) {
      w = 512
      h = 512
    }
    // Firefox 対策: 明示的な width/height を付与して直列化
    root.setAttribute('width', String(w))
    root.setAttribute('height', String(h))
    return { w, h, text: new XMLSerializer().serializeToString(root) }
  } catch {
    return { w: 512, h: 512, text: svgText }
  }
}

/** 読み込み済みの画像を内在サイズぶんのキャンバスへ焼く */
function bakeTexture(img: HTMLImageElement, w: number, h: number): TextureResult {
  const scale = Math.min(2, MAX_TEX / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(w * scale))
  canvas.height = Math.max(2, Math.round(h * scale))
  const c2d = canvas.getContext('2d')!
  c2d.drawImage(img, 0, 0, canvas.width, canvas.height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return { texture, aspect: w / h }
}

function rasterizeSvg(svgText: string): Promise<TextureResult> {
  const { w, h, text } = svgIntrinsicSize(svgText)
  return loadSvgImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text), () => ({ w, h }))
}

/**
 * 外部ファイルのSVGをラスタライズする。
 *
 * 実体のテキストは持っていない。file:// で開かれた書き出し物では fetch がCORSで
 * 落ちるので取りにも行けず、内在サイズは `<img>` が読んだ結果から採る。
 */
function rasterizeSvgUrl(url: string): Promise<TextureResult> {
  return loadSvgImage(url, (img) => ({ w: img.naturalWidth || 512, h: img.naturalHeight || 512 }))
}

function loadSvgImage(
  src: string,
  size: (img: HTMLImageElement) => { w: number; h: number },
): Promise<TextureResult> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const { w, h } = size(img)
      resolve(bakeTexture(img, w, h))
    }
    img.onerror = () => reject(new Error('failed to rasterize SVG'))
    img.src = src
  })
}

export function useSvgTexture(asset: Asset | undefined): TextureResult | null {
  const [result, setResult] = useState<TextureResult | null>(null)
  useEffect(() => {
    if (!asset) {
      setResult(null)
      return
    }
    let alive = true
    if (typeof asset.data !== 'string') {
      setResult(null)
      return
    }
    const data = asset.data
    let pending = svgTextureCache.get(data)
    if (!pending) {
      pending = isExternalAssetData(data) ? rasterizeSvgUrl(data) : rasterizeSvg(data)
      svgTextureCache.set(data, pending)
    }
    pending
      .then((r) => {
        if (alive) setResult(r)
      })
      .catch((e) => console.warn('failed to load SVG:', asset.name, e))
    return () => {
      alive = false
    }
  }, [asset?.id, asset?.data])
  return result
}

// ---------------------------------------------------------------------------
// PNG/WebP → テクスチャ
// ---------------------------------------------------------------------------

export function useImageTexture(asset: Asset | undefined): TextureResult | null {
  const [result, setResult] = useState<TextureResult | null>(null)
  useEffect(() => {
    if (!asset) {
      setResult(null)
      return
    }
    let alive = true
    if (typeof asset.data !== 'string') {
      setResult(null)
      return
    }
    const data = asset.data
    let pending = imageTextureCache.get(data)
    if (!pending) {
      pending = new THREE.TextureLoader().loadAsync(data).then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = 4
        return { texture, aspect: texture.image.width / texture.image.height }
      })
      imageTextureCache.set(data, pending)
    }
    pending
      .then((t) => {
        if (alive) setResult(t)
      })
      .catch((e) => console.warn('failed to load image:', asset.name, e))
    return () => {
      alive = false
    }
  }, [asset?.id, asset?.data])
  return result
}

// ---------------------------------------------------------------------------
// テキスト → キャンバステクスチャ (CDN 非依存でエクスポート後も自己完結)
// ---------------------------------------------------------------------------

export interface TextOptions extends TextStyle {
  color: string
  align: 'left' | 'center' | 'right'
}

function makeTextTexture(opts: TextOptions): TextureResult & { lines: number } {
  const lines = opts.text.split('\n')
  const px = 96
  const font = canvasFont(opts, px)
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = font
  const width = Math.max(...lines.map((l) => measure.measureText(l).width), 1)
  const lineH = px * TEXT_LINE_HEIGHT
  const canvas = document.createElement('canvas')
  canvas.width = Math.min(MAX_TEX, Math.ceil(width) + px * TEXT_SIDE_PAD)
  canvas.height = Math.ceil(lineH * lines.length)
  const c2d = canvas.getContext('2d')!
  c2d.font = font
  c2d.fillStyle = opts.color
  c2d.textBaseline = 'middle'
  c2d.textAlign = opts.align
  const x = opts.align === 'left' ? px * 0.1 : opts.align === 'right' ? canvas.width - px * 0.1 : canvas.width / 2
  lines.forEach((l, i) => {
    const y = lineH * (i + 0.5)
    c2d.fillText(l, x, y)
    if (!opts.underline) return
    // 下線はフォントが持たないので自前で引く。字送りぶんだけ引き、行送りには乗せない
    const run = c2d.measureText(l).width
    const left = opts.align === 'left' ? x : opts.align === 'right' ? x - run : x - run / 2
    c2d.fillRect(left, y + px * 0.42, run, Math.max(1, px * 0.055))
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return { texture, aspect: canvas.width / canvas.height, lines: lines.length }
}

export function useTextTexture(opts: TextOptions): (TextureResult & { lines: number }) | null {
  const result = useMemo(() => makeTextTexture(opts),
    [opts.text, opts.color, opts.font, opts.align, opts.bold, opts.italic, opts.underline])
  useEffect(() => () => result?.texture.dispose(), [result])
  return result
}

// ---------------------------------------------------------------------------
// MP4/WebM → VideoTexture
// ---------------------------------------------------------------------------

interface VideoCacheEntry {
  key: string
  data: Asset['data']
  element: HTMLVideoElement
  refs: number
  activeRefs: number
  promise: Promise<VideoTextureResult>
  result?: VideoTextureResult
  blob?: Blob
  embeddedData?: string
  disposeTimer?: ReturnType<typeof setTimeout>
  visibilityListener?: () => void
}

const videoTextureCache = new Map<string, VideoCacheEntry>()
const residentVideoTimes = new Map<string, number>()
const blobUrls = new WeakMap<Blob, { url: string; refs: number; revokeTimer?: ReturnType<typeof setTimeout> }>()
const embeddedVideoBlobs = new Map<string, { blob: Blob; refs: number }>()
let videoPlaybackEnabled = true
const videoPlaybackListeners = new Set<(enabled: boolean) => void>()

/** BookRuntimeの再生状態を全動画へ即時反映する。Reactの再描画待ちで一瞬進まないようにする。 */
export function setVideoPlaybackEnabled(enabled: boolean): void {
  videoPlaybackEnabled = enabled
  for (const entry of videoTextureCache.values()) updateVideoPlayback(entry)
  for (const listener of videoPlaybackListeners) listener(enabled)
}

export function isVideoPlaybackEnabled(): boolean {
  return videoPlaybackEnabled
}

export function subscribeVideoPlayback(listener: (enabled: boolean) => void): () => void {
  videoPlaybackListeners.add(listener)
  return () => videoPlaybackListeners.delete(listener)
}

/**
 * 同じ配置を中央線で二翼へ分けても、動画デコーダーと再生時刻は1つだけ使う。
 * instanceKeyを省いた紙面素材はasset ID単位で共有する。
 */
export function useVideoTexture(
  asset: Asset | undefined,
  instanceKey?: string,
  active = true,
): VideoTextureResult | null {
  const [result, setResult] = useState<VideoTextureResult | null>(null)
  useEffect(() => {
    if (!asset || asset.type !== 'video') {
      setResult(null)
      return
    }
    const key = `${instanceKey ?? 'asset'}:${asset.id}`
    let entry = videoTextureCache.get(key)
    if (!entry || entry.data !== asset.data) {
      if (entry) disposeVideoEntry(entry)
      entry = createVideoEntry(asset, key)
      videoTextureCache.set(key, entry)
    }
    if (entry.disposeTimer) clearTimeout(entry.disposeTimer)
    entry.refs++
    if (active) entry.activeRefs++
    updateVideoPlayback(entry)
    let alive = true
    entry.promise
      .then((loaded) => {
        if (alive) setResult(loaded)
      })
      .catch((error) => console.warn('failed to load video:', asset.name, error))
    return () => {
      alive = false
      setResult(null)
      entry!.refs--
      if (active) entry!.activeRefs--
      updateVideoPlayback(entry!)
      if (entry!.refs > 0) return
      // React StrictModeの直後の再マウントなら同じデコーダーを引き継ぐ。
      entry!.disposeTimer = setTimeout(() => {
        if (entry!.refs > 0) return
        disposeVideoEntry(entry!)
        if (videoTextureCache.get(key) === entry) videoTextureCache.delete(key)
      }, 0)
    }
  }, [asset?.id, asset?.data, asset?.type, instanceKey, active])
  return result
}

function createVideoEntry(asset: Asset, key: string): VideoCacheEntry {
  const video = document.createElement('video')
  video.preload = 'auto'
  video.loop = true
  video.muted = true
  video.playsInline = true
  video.setAttribute('playsinline', '')
  const embeddedData = typeof asset.data === 'string' && asset.data.startsWith('data:')
    ? asset.data
    : undefined
  const blob = asset.data instanceof Blob
    ? asset.data
    : embeddedData
      ? acquireEmbeddedVideoBlob(embeddedData, asset.mime)
      : undefined
  const src = blob ? acquireBlobUrl(blob) : asset.data
  const entry: VideoCacheEntry = {
    key,
    data: asset.data,
    element: video,
    refs: 0,
    activeRefs: 0,
    blob,
    embeddedData,
    promise: new Promise<VideoTextureResult>((resolve, reject) => {
      video.onloadedmetadata = () => {
        const restored = residentVideoTimes.get(key)
        if (restored !== undefined && Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = restored % video.duration
        }
        const texture = new THREE.VideoTexture(video)
        texture.colorSpace = THREE.SRGBColorSpace
        texture.minFilter = THREE.LinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.generateMipmaps = false
        const result = {
          texture,
          aspect: (video.videoWidth || asset.width || 1) / (video.videoHeight || asset.height || 1),
          video,
        }
        entry.result = result
        updateVideoPlayback(entry)
        resolve(result)
      }
      video.onerror = () => reject(new Error(`failed to decode ${asset.id}`))
    }),
  }
  entry.visibilityListener = () => {
    updateVideoPlayback(entry)
  }
  document.addEventListener('visibilitychange', entry.visibilityListener)
  video.src = String(src)
  video.load()
  return entry
}

function updateVideoPlayback(entry: VideoCacheEntry): void {
  if (document.hidden || !videoPlaybackEnabled || entry.activeRefs <= 0) {
    entry.element.pause()
    return
  }
  void entry.element.play().catch(() => { /* 自動再生解除前は消音のまま次の操作を待つ */ })
}

function disposeVideoEntry(entry: VideoCacheEntry): void {
  if (entry.disposeTimer) clearTimeout(entry.disposeTimer)
  if (entry.result) residentVideoTimes.set(entry.key, entry.result.video.currentTime)
  if (entry.visibilityListener) document.removeEventListener('visibilitychange', entry.visibilityListener)
  entry.result?.texture.dispose()
  entry.element.pause()
  entry.element.onloadedmetadata = null
  entry.element.onerror = null
  entry.element.removeAttribute('src')
  entry.element.load()
  if (entry.blob) releaseBlobUrl(entry.blob)
  if (entry.embeddedData) releaseEmbeddedVideoBlob(entry.embeddedData)
}

function acquireBlobUrl(blob: Blob): string {
  const existing = blobUrls.get(blob)
  if (existing) {
    if (existing.revokeTimer) clearTimeout(existing.revokeTimer)
    existing.refs++
    return existing.url
  }
  const created = { url: URL.createObjectURL(blob), refs: 1 }
  blobUrls.set(blob, created)
  return created.url
}

function releaseBlobUrl(blob: Blob): void {
  const entry = blobUrls.get(blob)
  if (!entry || --entry.refs > 0) return
  // video.load()による後片付けがURLを読み直すブラウザがあるため、同じタスクでは破棄しない。
  entry.revokeTimer = setTimeout(() => {
    if (entry.refs > 0) return
    URL.revokeObjectURL(entry.url)
    blobUrls.delete(blob)
  }, 1000)
}

function dataUrlToBlob(data: string, fallbackMime: string): Blob {
  const comma = data.indexOf(',')
  const header = data.slice(0, comma)
  const mime = /^data:([^;,]+)/.exec(header)?.[1] ?? fallbackMime
  const binary = atob(data.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mime })
}

function acquireEmbeddedVideoBlob(data: string, mime: string): Blob {
  const existing = embeddedVideoBlobs.get(data)
  if (existing) {
    existing.refs++
    return existing.blob
  }
  const created = { blob: dataUrlToBlob(data, mime), refs: 1 }
  embeddedVideoBlobs.set(data, created)
  return created.blob
}

function releaseEmbeddedVideoBlob(data: string): void {
  const entry = embeddedVideoBlobs.get(data)
  if (!entry || --entry.refs > 0) return
  embeddedVideoBlobs.delete(data)
}

/** 背景色・画像・文字を、ビジュアル矩形と同じUVを持つ1枚へCPU合成する。 */
export function useVisualTexture(
  element: VisualElement,
  asset?: Asset,
  instanceKey?: string,
): MediaTextureResult | null {
  const image = useImageTexture(asset?.type === 'image' ? asset : undefined)
  const svg = useSvgTexture(asset?.type === 'svg' ? asset : undefined)
  const video = useVideoTexture(asset?.type === 'video' ? asset : undefined, instanceKey)
  const source = image ?? svg ?? video
  const hasBackground = element.backgroundColor !== '#00000000'
  const needsComposite = hasBackground || Boolean(element.text)
  const result = useMemo(() => {
    if (!hasBackground && !source && !element.text) return null
    if (video && !needsComposite) return video
    const aspect = element.width / element.height
    const canvas = document.createElement('canvas')
    canvas.width = aspect >= 1 ? 1024 : Math.max(2, Math.round(1024 * aspect))
    canvas.height = aspect >= 1 ? Math.max(2, Math.round(1024 / aspect)) : 1024
    const c2d = canvas.getContext('2d')!
    const draw = () => {
      c2d.clearRect(0, 0, canvas.width, canvas.height)
      if (hasBackground) {
        c2d.fillStyle = element.backgroundColor
        c2d.fillRect(0, 0, canvas.width, canvas.height)
      }
      if (source && (!video || video.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA)) {
        c2d.drawImage(source.texture.image as CanvasImageSource, 0, 0, canvas.width, canvas.height)
      }
      if (!element.text) return
      const px = Math.max(1, element.fontSize / element.height * canvas.height)
      c2d.font = canvasFont(element, px)
      c2d.fillStyle = element.foregroundColor
      c2d.textBaseline = 'middle'
      c2d.textAlign = element.align
      const x = element.align === 'left' ? px * .1 : element.align === 'right' ? canvas.width - px * .1 : canvas.width / 2
      const lines = element.text.split('\n')
      const lineHeight = px * TEXT_LINE_HEIGHT
      lines.forEach((line, index) => {
        const y = canvas.height / 2 + (index - (lines.length - 1) / 2) * lineHeight
        c2d.fillText(line, x, y)
        if (!element.underline) return
        const run = c2d.measureText(line).width
        const left = element.align === 'left' ? x : element.align === 'right' ? x - run : x - run / 2
        c2d.fillRect(left, y + px * .42, run, Math.max(1, px * .055))
      })
    }
    draw()
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    return { texture, aspect, draw, video: video?.video }
  }, [element.width, element.height, element.backgroundColor, element.foregroundColor, element.text,
    element.fontSize, element.font, element.bold, element.italic, element.underline, element.align,
    source, video, needsComposite, hasBackground])
  useFrame(() => {
    if (!video || !needsComposite || !result || !('draw' in result)) return
    if (video.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
    result.draw()
    result.texture.needsUpdate = true
  })
  useEffect(() => () => {
    // 直返ししたVideoTextureの所有権は動画キャッシュ側にある。
    if (result && result !== video) result.texture.dispose()
  }, [result, video])
  return result
}

