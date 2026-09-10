import { z } from 'zod'
import { transformSchema, contentMotionSchema, textFontSchema, particleSettingsSchema, visualFields, contentAttachmentSchema, presentationSchema } from './content'
export { transformSchema, contentMotionSchema, textFontSchema, particleSettingsSchema, particleLayerSchema } from './content'
import { mechanismSchema } from './mechanism'
import { partInstanceSchema } from '../parts/schema'

export const parentSpaceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('left-page') }),
  z.object({ type: z.literal('right-page') }),
  z.object({ type: z.literal('element'), elementId: z.string().min(1) }),
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
  attachment: contentAttachmentSchema.optional(),
  presentation: presentationSchema.optional(),
  /** 複合部品の面に取り付ける位置。親IDはparentが保持する。 */
  surfaceAttachment: z.object({
    surfaceId: z.string().min(1), u: z.number().min(0).max(1), v: z.number().min(0).max(1),
    offset: z.number().default(0),
  }).optional(),
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
const currentStageElementSchema = z.discriminatedUnion('type', [
  z.object({
    ...common,
    type: z.literal('visual'),
    ...visualFields,
  }),
  z.object({
    ...common,
    type: z.literal('particle'),
    width: z.number().positive(),
    height: z.number().positive(),
    billboard: z.boolean().default(false),
    particles: particleSettingsSchema.default(() => ({ color: '#fff3a0', count: 6, size: .45, drift: .05, period: 11 })),
  }),
  z.object({ ...common, type: z.literal('group') }),
  z.object({ ...common, type: z.literal('part'), part: partInstanceSchema }),
  z.object({
    ...common, type: z.literal('assembly'), mechanism: mechanismSchema,
    composition: z.object({
    kind: z.enum(['stage', 'meadow', 'arcade', 'steps', 'bridge', 'house', 'room', 'tree', 'cake', 'floating-stage', 'scene']),
      count: z.number().int().min(1).max(40), spacing: z.number().positive(),
    }).optional(),
  }),
])

/**
 * v0.1.0と初期v0.1.1の排他的な描画型を、単一の矩形ビジュアルへ移す。
 * pageWidthを受け取る版はbookSchemaの前処理が使い、単体parseは既定幅8で移行する。
 */
export function migrateStageElementInput(value: unknown, pageWidth = 8): unknown {
  if (!value || typeof value !== 'object') return value
  const input = structuredClone(value) as Record<string, unknown>
  const parsedAttachment = contentAttachmentSchema.safeParse(input.attachment)
  if (parsedAttachment.success) {
    const attachment = parsedAttachment.data
    const nodeId = attachment.type === 'surface' ? attachment.surface.nodeId : attachment.elementId
    input.parent = nodeId === '$book' && attachment.type === 'surface'
      ? { type: attachment.surface.portId === 'left-page' ? 'left-page' : 'right-page' }
      : { type: 'element', elementId: nodeId }
    delete input.surfaceAttachment; delete input.stowFlourish
  }
  if (input.type === 'part' && !input.parent) {
    const part = partInstanceSchema.safeParse(input.part)
    if (part.success) {
      const mount = part.data.mount
      input.parent = mount.type === 'output' && mount.nodeId !== '$book'
        ? { type: 'element', elementId: mount.nodeId }
        : { type: mount.type === 'output' && mount.portId === 'left-page' ? 'left-page' : 'right-page' }
    }
  }
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

  if (input.type === 'visual') {
    const particles = input.particles as { enabled?: unknown } | undefined
    const hasLegacyParticle = particles?.enabled === true
      && !input.image && !input.backImage && !input.text
      && (!input.backgroundColor || input.backgroundColor === '#00000000')
    if (hasLegacyParticle) {
      const { enabled: _enabled, ...settings } = particles as Record<string, unknown>
      return { ...input, type: 'particle', billboard: false, particles: settings }
    }
    return input
  }
  if (input.type === 'particle' || input.type === 'group' || input.type === 'assembly' || input.type === 'part') return input
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
      type: 'particle', width: extent, height: extent, billboard: false,
      particles: { color: input.color ?? '#fff3a0', count: 6, size: .45, drift: .05, period: 11 },
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
export type ParticleElement = Extract<StageElement, { type: 'particle' }>
export type AssemblyElement = Extract<StageElement, { type: 'assembly' }>
export type PartElement = Extract<StageElement, { type: 'part' }>
export type TextFont = z.infer<typeof textFontSchema>
