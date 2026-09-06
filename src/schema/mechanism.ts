import { z } from 'zod'

const finite = () => z.number().finite()
const vector = () => z.tuple([finite(), finite(), finite()])

export const mechanismKindSchema = z.enum([
  'panel', 'v-fold', 'beak', 'platform', 'box', 'accordion', 'curved-shell',
])

export const surfaceAttachmentSchema = z.object({
  surfaceId: z.string().min(1),
  u: finite().min(0).max(1).default(.5),
  v: finite().min(0).max(1).default(.5),
  offset: finite().default(0),
})

export const mechanismMountSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page'), side: z.enum(['left', 'right']) }),
  z.object({ type: z.literal('gutter') }),
  z.object({ type: z.literal('surface'), elementId: z.string().min(1), ...surfaceAttachmentSchema.shape }),
  z.object({ type: z.literal('space') }),
])

export const mechanismSurfaceSchema = z.object({
  color: z.string().default('#f3c980'),
  image: z.string().min(1).optional(),
  backImage: z.string().min(1).optional(),
  text: z.string().optional(),
  visible: z.boolean().default(true),
})

/** 途中姿勢は保存せず、寸法、接続先、展開と演出の指定から導出する。 */
export const mechanismSchema = z.object({
  kind: mechanismKindSchema,
  parameters: z.object({
    width: finite().positive().max(200).default(3),
    height: finite().positive().max(200).default(2),
    depth: finite().positive().max(200).default(2),
    segments: finite().int().min(2).max(64).default(8),
    angleDeg: finite().min(1).max(175).default(90),
  }).default({}),
  mount: mechanismMountSchema.default({ type: 'space' }),
  deployment: z.object({
    mode: z.enum(['page-constrained', 'virtual']).default('virtual'),
    start: finite().min(0).max(.95).default(.12),
    end: finite().min(.01).max(1).default(.88),
  }).default({}),
  staging: z.object({
    closedScale: finite().positive().max(1).default(.2),
    /** 開姿勢の原点から収納先への変位。親面への取り付け位置とは独立。 */
    closedPosition: vector().default([0, 0, 0]),
    floatAmplitude: vector().default([0, 0, 0]),
    floatPeriod: finite().positive().default(5),
    floatPhase: finite().default(0),
    fadeStart: finite().min(0).max(.5).default(.01),
    fadeEnd: finite().min(.001).max(.6).default(.06),
  }).default({}),
  surfaces: z.record(mechanismSurfaceSchema).default({}),
}).superRefine((value, ctx) => {
  if (value.deployment.start >= value.deployment.end) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['deployment', 'end'], message: 'Deployment end must exceed start' })
  }
  if (value.staging.fadeStart >= value.staging.fadeEnd) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['staging', 'fadeEnd'], message: 'Fade end must exceed start' })
  }
  if (value.deployment.mode !== 'page-constrained') return
  const allowed = value.kind === 'panel' ? value.mount.type === 'page'
    : ['v-fold', 'platform', 'box'].includes(value.kind) && value.mount.type === 'gutter'
  if (!allowed) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mount'], message: 'This mechanism does not support this page-constrained mount' })
  }
  const stage = value.staging
  if (stage.closedScale !== 1 || stage.closedPosition.some((n) => n !== 0) || stage.floatAmplitude.some((n) => n !== 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['staging'], message: 'Page-constrained mechanisms cannot move or scale their real anchors' })
  }
})

export type MechanismKind = z.infer<typeof mechanismKindSchema>
export type MechanismSpec = z.infer<typeof mechanismSchema>
export type MechanismMount = MechanismSpec['mount']
export type MechanismSurface = z.infer<typeof mechanismSurfaceSchema>
export type SurfaceAttachment = z.infer<typeof surfaceAttachmentSchema>

export function mechanismSurfaceIds(spec: MechanismSpec): string[] {
  switch (spec.kind) {
    case 'panel': return ['panel']
    case 'v-fold': return ['wing-left', 'wing-right']
    case 'beak': return ['upper', 'lower']
    case 'platform': return ['top', 'wall-left', 'wall-right']
    case 'box': return ['front-left', 'front-right', 'back-left', 'back-right', 'wall-left', 'wall-right', 'top-left', 'top-right']
    case 'accordion': return Array.from({ length: spec.parameters.segments }, (_, i) => `fold-${i}`)
    case 'curved-shell': return [...Array.from({ length: Math.max(8, spec.parameters.segments * 2) }, (_, i) => `shell-${i}`), 'top']
  }
}

type MechanismOverrides = Omit<Partial<MechanismSpec>, 'kind' | 'parameters' | 'deployment' | 'staging'> & {
  parameters?: Partial<MechanismSpec['parameters']>
  deployment?: Partial<MechanismSpec['deployment']>
  staging?: Partial<MechanismSpec['staging']>
}

export function makeMechanism(kind: MechanismKind, overrides: MechanismOverrides = {}): MechanismSpec {
  const constrained = overrides.deployment?.mode === 'page-constrained'
  return mechanismSchema.parse({
    kind,
    ...overrides,
    mount: overrides.mount ?? (constrained ? kind === 'panel' ? { type: 'page', side: 'right' } : { type: 'gutter' } : { type: 'space' }),
    staging: { ...(constrained ? { closedScale: 1 } : {}), ...overrides.staging },
  })
}
