import { z } from 'zod'
import { embeddedVideoAudioSchema, spreadAudioFields } from './audio'
import { migrateStageElementInput, stageElementSchema } from './stageElement'
import { spreadSequenceSchema } from './sequence'
import { vec3Schema } from './geometry'
import { spreadTimelineSchema } from './timeline'

export const pageSchema = z.object({
  backgroundAsset: z.string().min(1).optional(),
  backgroundVideoAudio: embeddedVideoAudioSchema.optional(),
  paperColor: z.string().optional(),
})

export type Page = z.infer<typeof pageSchema>

export const cameraSchema = z.object({
  position: vec3Schema,
  target: vec3Schema,
  fov: z.number().positive().max(179),
})

export type BookCamera = z.infer<typeof cameraSchema>

/** 新規プロジェクトで使う光源の既定値。 */
export const DEFAULT_BOOK_LIGHTS = {
  ambient: { color: '#ffffff', intensity: 1.2 },
  directional: { color: '#ffffff', intensity: 1.8, position: [-4, 10, 6] as [number, number, number] },
}

export const lightsSchema = z.object({
  ambient: z.object({ color: z.string(), intensity: z.number().min(0) }),
  directional: z.object({ color: z.string(), intensity: z.number().min(0), position: vec3Schema }),
})

export type BookLights = z.infer<typeof lightsSchema>

export const spreadSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  leftPage: pageSchema,
  rightPage: pageSchema,
  elements: z.array(stageElementSchema),
  sequence: spreadSequenceSchema,
  timeline: spreadTimelineSchema,
  ...spreadAudioFields,
})

export type Spread = z.infer<typeof spreadSchema>

export const coverSchema = z.object({
  frontAsset: z.string().min(1).optional(),
  backAsset: z.string().min(1).optional(),
  frontVideoAudio: embeddedVideoAudioSchema.optional(),
  backVideoAudio: embeddedVideoAudioSchema.optional(),
})

export type Cover = z.infer<typeof coverSchema>

const currentBookSchema = z.object({
  sequence: z.object({
    coverOpenSeconds: z.number().positive(),
  }),
  format: z.object({
    pageAspect: z.number().positive(),
    pageWidth: z.number().positive(),
    coverThickness: z.number().positive(),
    pageThickness: z.number().nonnegative(),
    gutter: z.number().nonnegative(),
    binding: z.literal('left'),
  }),
  appearance: z.object({
    paperColor: z.string(),
    edgeColor: z.string(),
    roughness: z.number().min(0).max(1),
    background: z.string(),
    /** 単色背景の代わりに画面全体へ表示する舞台背景。未指定ならbackground色を使う。 */
    backgroundAsset: z.string().min(1).optional(),
    /** 舞台背景動画の音はカメラ位置に依存しない全体音として鳴らす。 */
    backgroundVideoAudio: embeddedVideoAudioSchema.optional(),
    /** 表紙面と背の地色。未指定の既存作品は従来の茶色を使う。 */
    coverColor: z.string().optional(),
    coverEdgeColor: z.string().optional(),
    shadowOpacity: z.number().min(0).max(1),
  }),
  camera: cameraSchema,
  lights: lightsSchema.default(() => structuredClone(DEFAULT_BOOK_LIGHTS)),
  frontCover: coverSchema,
  spreads: z.array(spreadSchema).min(1),
  backCover: coverSchema,
})

/** 旧要素型、見開き親、旧タイムラインを現行の保存契約へ正規化する。 */
function migrateBookInput(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const input = structuredClone(value) as Record<string, unknown>
  const format = input.format as { pageWidth?: unknown } | undefined
  const pageWidth = typeof format?.pageWidth === 'number' ? format.pageWidth : 8
  if (!Array.isArray(input.spreads)) return input
  for (const rawSpread of input.spreads) {
    if (!rawSpread || typeof rawSpread !== 'object') continue
    const spread = rawSpread as Record<string, unknown>
    if (Array.isArray(spread.elements)) {
      spread.elements = spread.elements.map((element) => migrateStageElementInput(element, pageWidth))
    }
    const timeline = spread.timeline as { tracks?: unknown } | undefined
    if (!Array.isArray(timeline?.tracks)) continue
    timeline.tracks = timeline.tracks.flatMap((rawTrack) => {
      if (!rawTrack || typeof rawTrack !== 'object') return [rawTrack]
      const track = rawTrack as Record<string, unknown>
      if (track.property === 'effect.size') {
        return [
          { ...track, id: `${String(track.id)}-width`, property: 'visual.width' },
          { ...track, id: `${String(track.id)}-height`, property: 'visual.height' },
        ]
      }
      if (track.property === 'asset') return [{ ...track, property: 'visual.image' }]
      if (track.property === 'effect.color') return [{ ...track, property: 'visual.particles.color' }]
      return [track]
    })
  }
  return input
}

export const bookSchema = z.preprocess(migrateBookInput, currentBookSchema)

export type Book = z.infer<typeof bookSchema>
