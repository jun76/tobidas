import { z } from 'zod'

const audioAssetIdSchema = z.string().min(1)

export const projectAudioSchema = z.object({
  bgmAsset: audioAssetIdSchema,
  volume: z.number().min(0).max(1),
  loop: z.boolean(),
})

export const spreadAudioFields = {
  enterSound: audioAssetIdSchema.optional(),
  pageTurnSound: audioAssetIdSchema.optional(),
}

/** 動画を置いた面ごとの内蔵音声設定。存在しない既存作品は無音のまま。 */
export const embeddedVideoAudioSchema = z.object({
  enabled: z.boolean(),
  volume: z.number().min(0).max(1),
  /** ページ幅に対する基準距離。 */
  referenceDistance: z.number().min(0.05).max(8),
  rolloffFactor: z.number().min(0).max(4),
})

export type EmbeddedVideoAudio = z.infer<typeof embeddedVideoAudioSchema>

export const DEFAULT_EMBEDDED_VIDEO_AUDIO: EmbeddedVideoAudio = {
  enabled: true,
  volume: 1,
  referenceDistance: 0.5,
  rolloffFactor: 1,
}
