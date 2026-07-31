import { z } from 'zod'
import { spreadAudioFields } from './audio'
import { stageElementSchema } from './stageElement'
import { spreadSequenceSchema } from './sequence'
import { vec3Schema } from './geometry'
import { spreadTimelineSchema } from './timeline'

export const pageSchema = z.object({
  backgroundAsset: z.string().min(1).optional(),
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
})

export type Cover = z.infer<typeof coverSchema>

export const bookSchema = z.object({
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

export type Book = z.infer<typeof bookSchema>
