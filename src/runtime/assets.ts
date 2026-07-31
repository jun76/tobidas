import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { isExternalAssetData, type Asset } from '../schema/assets'
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
    let pending = svgTextureCache.get(asset.data)
    if (!pending) {
      pending = isExternalAssetData(asset.data) ? rasterizeSvgUrl(asset.data) : rasterizeSvg(asset.data)
      svgTextureCache.set(asset.data, pending)
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
    let pending = imageTextureCache.get(asset.data)
    if (!pending) {
      pending = new THREE.TextureLoader().loadAsync(asset.data).then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        texture.anisotropy = 4
        return { texture, aspect: texture.image.width / texture.image.height }
      })
      imageTextureCache.set(asset.data, pending)
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

