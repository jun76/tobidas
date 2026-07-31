import { z } from 'zod'

export const assetTypeSchema = z.enum(['svg', 'image', 'audio'])

/**
 * 音声1本の上限 (docs/008 §6.3)。
 *
 * 書き出しでは実体が外部ファイルへ出るのでHTMLは太らないが (docs/009)、
 * 制作中は data URL のまま IndexedDB と undo スタックへ乗る。上限は編集の重さで決める。
 */
export const AUDIO_BYTE_LIMIT = 3 * 1024 * 1024

/**
 * 書き出したサイトが素材の実体を置く場所 (docs/009 §2)。
 *
 * `index.html` の隣の `assets/` で、作品パッケージと同じ相対配置。埋め込まれた
 * 作品データは実体のかわりにこの相対URLを持つ。
 */
export const EXTERNAL_ASSET_PREFIX = './assets/'

/** 素材IDから外部ファイルへの相対URLを作る。IDは元のファイル名由来で空白や日本語を含む */
export function externalAssetUrl(id: string): string {
  return EXTERNAL_ASSET_PREFIX + id.split('/').map(encodeURIComponent).join('/')
}

/** `data` が実体そのものではなく外部ファイルへの参照か (制作中は常に false) */
export function isExternalAssetData(data: string): boolean {
  return data.startsWith(EXTERNAL_ASSET_PREFIX)
}

export const assetSchema = z.object({
  /** assets/ からの相対パス */
  id: z.string().min(1),
  name: z.string().min(1),
  type: assetTypeSchema,
  mime: z.string().min(1),
  bytes: z.number().nonnegative().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  duration: z.number().nonnegative().optional(),
  alphaBounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
})

export type AssetMeta = z.infer<typeof assetSchema>

/** メモリ内表現。SVG は文字列、それ以外は data URL。 */
export interface Asset extends AssetMeta {
  data: string
}
