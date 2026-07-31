import { z } from 'zod'
import { vec3Schema } from './geometry'

export const transformSchema = z.object({
  position: vec3Schema,
  rotation: vec3Schema,
  scale: vec3Schema,
})

export const parentSpaceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('spread') }),
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

/**
 * 収納ヒント (docs/006 §10)。
 * 制作者の意図だけを表す。支持機構の内部構造(接着線、折り目、支持片、
 * 縮小カーブ)は保存せず、収納コンパイラが決定的に再導出する。
 */
export const stowMechanismSchema = z.enum(['auto', 'page-glue', 'flap', 'v-fold', 'strut'])
export const sourcePresetSchema = z.enum([
  'paper-stack',
  'bottom-upright',
  'spine-arch',
  'depth-layer',
  'floating-character',
  'light-particles',
  'page-text',
  'custom',
])

export const stowHintSchema = z.object({
  mechanism: stowMechanismSchema.default('auto'),
  /** v-foldの折り目位置 (0..1)。既定はPivot X */
  crease: z.number().min(0.05).max(0.95).optional(),
  /** 倒す方向。autoはコンパイラが包含検証で決める */
  fallDirection: z.enum(['auto', 'back', 'front', 'spine', 'outward']).default('auto'),
  /** 開き始めの位相 (0..1)。包含検証による自動位相へ加算される */
  stagger: z.number().min(0).max(1).default(0),
})

/**
 * 装飾トラック (docs/005 §6.4)。
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
  /** ビルダーで投入したプリセット。後から姿勢や機構を変更しても投入元を保持する。 */
  sourcePreset: sourcePresetSchema,
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

export const stageElementSchema = z.discriminatedUnion('type', [
  // assetの空文字は「未割り当て」。スキーマでは許し、bookValidateが警告する
  z.object({ ...common, type: z.literal('image'), asset: z.string(), backAsset: z.string().min(1).optional(), width: z.number().positive(), height: z.number().positive(), billboard: z.boolean().default(false) }),
  z.object({ ...common, type: z.literal('text'), text: z.string(), width: z.number().positive(), height: z.number().positive(), fontSize: z.number().positive(), color: z.string(), align: z.enum(['left', 'center', 'right']), ...textStyleFields }),
  z.object({ ...common, type: z.literal('group') }),
  z.object({ ...common, type: z.literal('effect'), effect: z.literal('sparkles'), color: z.string(), size: z.number().positive() }),
])

export type Transform = z.infer<typeof transformSchema>
export type ParentSpace = z.infer<typeof parentSpaceSchema>
export type ContentMotion = z.infer<typeof contentMotionSchema>
export type StowMechanism = z.infer<typeof stowMechanismSchema>
export type SourcePreset = z.infer<typeof sourcePresetSchema>
export type MotionTrack = z.infer<typeof motionTrackSchema>
export type StageElement = z.infer<typeof stageElementSchema>
export type StageElementType = StageElement['type']
export type TextElement = Extract<StageElement, { type: 'text' }>
export type TextFont = z.infer<typeof textFontSchema>
