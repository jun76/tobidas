import type { AssetMeta } from '../schema/assets'
import type { BookProject } from '../schema/bookPackage'

export const SITE_EXT = '.site.zip'

const EXT_TO_KIND: Record<string, { type: AssetMeta['type']; mime: string }> = {
  svg: { type: 'svg', mime: 'image/svg+xml' },
  png: { type: 'image', mime: 'image/png' },
  webp: { type: 'image', mime: 'image/webp' },
  jpg: { type: 'image', mime: 'image/jpeg' },
  jpeg: { type: 'image', mime: 'image/jpeg' },
  mp3: { type: 'audio', mime: 'audio/mpeg' },
  ogg: { type: 'audio', mime: 'audio/ogg' },
  wav: { type: 'audio', mime: 'audio/wav' },
  mp4: { type: 'video', mime: 'video/mp4' },
  webm: { type: 'video', mime: 'video/webm' },
}

export function assetKindForFile(name: string): { type: AssetMeta['type']; mime: string } | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_KIND[ext] ?? null
}

/**
 * ファイルピッカーの `accept`。受け付ける形式の表そのものから作る。
 *
 * `image/*` のような大づかみな指定にすると、GIFやAVIFまで選べるのに
 * `assetKindForFile` が弾いてエラーになる。選べたのに入らないのは事故なので、
 * 実際に通る拡張子だけを並べる。
 */
export function assetAccept(...types: AssetMeta['type'][]): string {
  return Object.entries(EXT_TO_KIND)
    .filter(([, kind]) => types.includes(kind.type))
    .map(([ext]) => `.${ext}`)
    .join(',')
}

export interface AssetSource {
  text(): Promise<string>
  dataUrl(mime: string): Promise<string>
  blob(mime: string): Promise<Blob>
  readonly size?: number
  readonly mime?: string
  metadata?(type: AssetMeta['type'], data: import('../schema/assets').AssetData): Promise<Partial<AssetMeta>>
}

export interface AssembleResult {
  project: BookProject
  notices: string[]
}

export function normalizeAssetPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '')
  const parts = normalized.split('/')
  if (!normalized || parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`invalid asset path: ${path}`)
  }
  return parts.join('/')
}
