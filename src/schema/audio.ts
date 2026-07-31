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
