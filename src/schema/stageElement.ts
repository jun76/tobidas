import { z } from 'zod'
import { vec3Schema } from './geometry'
import { embeddedVideoAudioSchema } from './audio'

export const transformSchema = z.object({
  position: vec3Schema,
  rotation: vec3Schema,
  scale: vec3Schema,
})

export const parentSpaceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('left-page') }),
  z.object({ type: z.literal('right-page') }),
  z.object({ type: z.literal('element'), elementId: z.string().min(1) }),
])

export const contentMotionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bob'), amplitude: z.number(), period: z.number().positive(), phase: z.number().default(0) }),
  z.object({ type: z.literal('sway'), amplitude: z.number(), period: z.number().positive(), phase: z.number().default(0) }),
  z.object({ type: z.literal('drift'), amplitude: vec3Schema, period: z.number().positive(), phase: z.number().default(0) }),
  z.object({ type: z.literal('spin'), axis: z.enum(['x', 'y', 'z']), speed: z.number() }),
  z.object({ type: z.literal('pulse'), amplitude: z.number(), period: z.number().positive(), phase: z.number().default(0) }),
])

export const stowHintSchema = z.object({
  /** 倒す方向。autoはコンパイラが包含検証で決める */
  fallDirection: z.enum(['auto', 'back', 'front', 'spine', 'outward']).default('auto'),
  /** 開き始めの位相 (0..1)。包含検証による自動位相へ加算される */
  stagger: z.number().min(0).max(1).default(0),
})

/**
 * 装飾トラック。
 * uで評価するキーフレーム列に窓関数を乗じ、u=0とu=1では必ず効かない。
 */
export const trackPropertySchema = z.enum([
  'position.x', 'position.y', 'position.z',
  'rotation.x', 'rotation.y', 'rotation.z',
  'scale', 'opacity',
])

export const trackKeySchema = z.object({
  t: z.number().min(0).max(1),
  value: z.number(),
  ease: z.enum(['linear', 'easeInOut']).default('easeInOut'),
})

export const motionTrackSchema = z.object({
  property: trackPropertySchema,
  keys: z.array(trackKeySchema).min(1),
})

const common = {
  id: z.string().min(1),
  name: z.string().min(1),
  visible: z.boolean(),
  opacity: z.number().min(0).max(1),
  parent: parentSpaceSchema,
  baseTransform: transformSchema,
  pivot: z.tuple([z.number(), z.number()]),
  layer: z.number(),
  motion: z.array(contentMotionSchema),
  stow: stowHintSchema,
  stowFlourish: z.array(motionTrackSchema).optional(),
  clock: z.enum(['inherit', 'visible-elapsed', 'story-time']),
}

/**
 * 文字の書体。実体はフォントファイルではなく端末に載っている書体の候補列で、
 * 対応表は runtime/textStyle.ts が持つ。同梱プレイヤーは単一HTMLを file:// で開くので
 * フォントを外から取りに行けず、同梱すると日本語書体は数MB級で作品の容量を食う。
 * だから作品が持つのは「どの系統か」だけにして、実物は端末のものを使う。
 */
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

const currentStageElementSchema = z.discriminatedUnion('type', [
  z.object({
    ...common,
    type: z.literal('visual'),
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
  }),
  z.object({ ...common, type: z.literal('group') }),
])

/**
 * v0.1.0と初期v0.1.1の排他的な描画型を、単一の矩形ビジュアルへ移す。
 * pageWidthを受け取る版はbookSchemaの前処理が使い、単体parseは既定幅8で移行する。
 */
export function migrateStageElementInput(value: unknown, pageWidth = 8): unknown {
  if (!value || typeof value !== 'object') return value
  const input = structuredClone(value) as Record<string, unknown>
  const transform = input.baseTransform as { position?: unknown } | undefined
  const position = Array.isArray(transform?.position) ? [...transform.position] : undefined
  const parent = input.parent as { type?: string; elementId?: string } | undefined
  if (parent?.type === 'spread') {
    const x = typeof position?.[0] === 'number' ? position[0] : 0
    const side = x < 0 ? 'left-page' : 'right-page'
    input.parent = { type: side }
    if (position && transform) {
      position[0] = x + (side === 'left-page' ? pageWidth / 2 : -pageWidth / 2)
      transform.position = position
    }
  }

  const stow = input.stow && typeof input.stow === 'object'
    ? input.stow as Record<string, unknown>
    : {}
  input.stow = {
    fallDirection: stow.fallDirection ?? 'auto',
    stagger: stow.stagger ?? 0,
  }
  delete input.sourcePreset

  if (input.type === 'visual' || input.type === 'group') return input
  const base: Record<string, unknown> = { ...input, type: 'visual' }
  if (input.type === 'image') {
    delete base.asset
    delete base.backAsset
    return {
      ...base,
      image: typeof input.asset === 'string' && input.asset ? input.asset : undefined,
      backImage: input.backAsset,
      backgroundColor: '#00000000', foregroundColor: '#2e241b', text: '',
      fontSize: .35, align: 'center', font: 'rounded', bold: true, italic: false, underline: false,
      particles: { enabled: false, color: '#fff3a0', count: 6, size: .45, drift: .05, period: 11 },
    }
  }
  if (input.type === 'text') {
    delete base.color
    return {
      ...base,
      billboard: false,
      backgroundColor: '#00000000', foregroundColor: input.color ?? '#2e241b',
      particles: { enabled: false, color: '#fff3a0', count: 6, size: .45, drift: .05, period: 11 },
    }
  }
  if (input.type === 'effect') {
    const extent = typeof input.size === 'number' ? input.size : 1
    delete base.effect
    delete base.color
    delete base.size
    return {
      ...base,
      width: extent, height: extent, billboard: false,
      backgroundColor: '#00000000', foregroundColor: '#2e241b', text: '',
      fontSize: .35, align: 'center', font: 'rounded', bold: true, italic: false, underline: false,
      particles: { enabled: true, color: input.color ?? '#fff3a0', count: 6, size: .45, drift: .05, period: 11 },
    }
  }
  return input
}

export const stageElementSchema = z.preprocess(
  (value) => migrateStageElementInput(value),
  currentStageElementSchema,
)

export type Transform = z.infer<typeof transformSchema>
export type ParentSpace = z.infer<typeof parentSpaceSchema>
export type ContentMotion = z.infer<typeof contentMotionSchema>
export type MotionTrack = z.infer<typeof motionTrackSchema>
export type StageElement = z.infer<typeof stageElementSchema>
export type StageElementType = StageElement['type']
export type VisualElement = Extract<StageElement, { type: 'visual' }>
export type TextFont = z.infer<typeof textFontSchema>
