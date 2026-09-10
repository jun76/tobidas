import { z } from 'zod'
import { vec3Schema } from './geometry'
import { embeddedVideoAudioSchema } from './audio'
import { timelineTrackSchema } from './timeline'

export const transformSchema = z.object({
  position: vec3Schema,
  rotation: vec3Schema,
  scale: vec3Schema,
})

export const contentMotionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bob'), amplitude: z.number(), period: z.number().positive(), phase: z.number().default(0), axis: z.enum(['x', 'y', 'z']).optional() }),
  z.object({ type: z.literal('sway'), amplitude: z.number(), period: z.number().positive(), phase: z.number().default(0) }),
  z.object({ type: z.literal('drift'), amplitude: vec3Schema, period: z.number().positive(), phase: z.number().default(0) }),
  z.object({ type: z.literal('spin'), axis: z.enum(['x', 'y', 'z']), speed: z.number() }),
  z.object({ type: z.literal('pulse'), amplitude: z.number(), period: z.number().positive(), phase: z.number().default(0) }),
])

export const textFontSchema = z.enum(['rounded', 'sans', 'serif', 'mono'])

/**
 * 文字の装飾。既定値は追加前の描画 (丸ゴシックの太字) に一致させてあるので、
 * これらを持たない既存の作品を読んでも見た目は変わらない。
 */
const textStyleFields = {
  font: textFontSchema.default('rounded'),
  bold: z.boolean().default(true),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
}

export const particleLayerSchema = z.object({
  enabled: z.boolean().default(false),
  color: z.string().default('#fff3a0'),
  count: z.number().int().min(1).max(200).default(6),
  size: z.number().positive().default(.45),
  drift: z.number().nonnegative().default(.05),
  period: z.number().positive().default(11),
})

/** 独立したパーティクル部品の設定。表示のON/OFFは部品の存在で表す。 */
export const particleSettingsSchema = z.object({
  color: z.string().default('#fff3a0'),
  count: z.number().int().min(1).max(200).default(6),
  size: z.number().positive().default(.45),
  drift: z.number().nonnegative().default(.05),
  period: z.number().positive().default(11),
})

const defaultParticleSettings = {
  color: '#fff3a0', count: 6, size: .45, drift: .05, period: 11,
}

export const contentAttachmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('surface'), surface: z.object({ nodeId: z.string().min(1), portId: z.string().min(1) }).strict(),
    point: z.tuple([z.number().finite(), z.number().finite()]), side: z.enum(['front', 'back']) }).strict(),
  z.object({ type: z.literal('visual'), elementId: z.string().min(1) }).strict(),
])
export const presentationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('decal') }).strict(),
  z.object({ kind: z.literal('fiction'), closing: z.literal('shrink-to-anchor') }).strict(),
])
export const visualFields = {
    width: z.number().positive(),
    height: z.number().positive(),
    billboard: z.boolean().default(false),
    backgroundColor: z.string().default('#00000000'),
    foregroundColor: z.string().default('#2e241b'),
    image: z.string().min(1).optional(),
    backImage: z.string().min(1).optional(),
    videoAudio: embeddedVideoAudioSchema.optional(),
    backVideoAudio: embeddedVideoAudioSchema.optional(),
    text: z.string().default(''),
    fontSize: z.number().positive().default(.35),
    align: z.enum(['left', 'center', 'right']).default('center'),
    ...textStyleFields,
    particles: particleLayerSchema.default(() => ({
      enabled: false, color: '#fff3a0', count: 6, size: .45, drift: .05, period: 11,
    })),

}
const contentCommon = {
  id: z.string().min(1), name: z.string().min(1), visible: z.boolean().default(true), opacity: z.number().min(0).max(1).default(1),
  attachment: contentAttachmentSchema, presentation: presentationSchema,
  baseTransform: transformSchema, pivot: z.tuple([z.number(), z.number()]), layer: z.number().default(0),
  motion: z.array(contentMotionSchema).default([]), clock: z.enum(['inherit', 'visible-elapsed', 'story-time']).default('inherit'),
}
export const connectedContentSchema = z.discriminatedUnion('type', [
  z.object({ ...contentCommon, type: z.literal('visual'), ...visualFields }),
  z.object({ ...contentCommon, type: z.literal('particle'), width: z.number().positive(), height: z.number().positive(),
    billboard: z.boolean().default(false), particles: particleSettingsSchema }),
  z.object({ ...contentCommon, type: z.literal('group') }),
])
export const partContentSchema = z.object({ element: connectedContentSchema, tracks: z.array(timelineTrackSchema).default([]) }).strict()
export type ContentAttachment = z.infer<typeof contentAttachmentSchema>
export type Presentation = z.infer<typeof presentationSchema>
export type ConnectedContent = z.infer<typeof connectedContentSchema>
export type PartContent = z.infer<typeof partContentSchema>
