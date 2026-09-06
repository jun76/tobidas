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
  z.object({ type: z.literal('bridge'), elementId: z.string().min(1), bridgeId: z.literal('deck'), v: finite().min(0).max(1).default(.5) }),
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
  mount: mechanismMountSchema.default({ type: 'gutter' }),
  deployment: z.object({
    mode: z.enum(['page-constrained', 'virtual']).default('page-constrained'),
  }).strict().default({}),
  staging: z.object({
    openScale: finite().positive().max(20).default(1),
    closedScale: finite().positive().max(1).default(1),
    openPosition: vector().default([0, 0, 0]),
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
  if (value.staging.fadeStart >= value.staging.fadeEnd) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['staging', 'fadeEnd'], message: 'Fade end must exceed start' })
  }
  const allowed = value.mount.type === 'gutter' || value.mount.type === 'bridge'
    || value.kind === 'panel' && ['page', 'surface'].includes(value.mount.type)
  if (!allowed) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mount'], message: 'Folding mechanisms require a real gutter or a parent bridge; a single surface supports panels only' })
  }
  if (value.deployment.mode !== 'page-constrained') return
  const stage = value.staging
  if (stage.openScale !== 1 || stage.closedScale !== 1 || stage.openPosition.some((n) => n !== 0) || stage.closedPosition.some((n) => n !== 0) || stage.floatAmplitude.some((n) => n !== 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['staging'], message: 'Page-constrained mechanisms cannot move or scale their real anchors' })
  }
})

export type MechanismKind = z.infer<typeof mechanismKindSchema>
export type MechanismSpec = z.infer<typeof mechanismSchema>
export type MechanismMount = MechanismSpec['mount']
export type MechanismSurface = z.infer<typeof mechanismSurfaceSchema>
export type SurfaceAttachment = z.infer<typeof surfaceAttachmentSchema>

export function mechanismSurfaceIds(spec: MechanismSpec): string[] {
  const support = ['mount-left', 'mount-center', 'mount-right', 'base-left', 'base-right']
  switch (spec.kind) {
    case 'panel': return [...support, 'panel']
    case 'v-fold': return [...support, 'wing-left', 'wing-right']
    case 'beak': return [...support, 'upper', 'lower', 'jaw-support-left', 'jaw-support-right']
    case 'platform': return [...support, 'top', 'wall-left', 'wall-right']
    case 'box': return [...support, 'front-left', 'front-right', 'back-left', 'back-right', 'wall-left', 'wall-right', 'top-left', 'top-right']
    case 'accordion': return [...support, ...Array.from({ length: spec.parameters.segments }, (_, i) => `fold-${i}`)]
    case 'curved-shell': return [...support, ...Array.from({ length: Math.max(8, spec.parameters.segments * 2) }, (_, i) => `shell-${i}`), 'top']
  }
}

/** 左右の面と実際の折り線を持つ、子機構の接続先。 */
export function mechanismBridgeIds(spec: MechanismSpec): string[] {
  return ['box', 'platform', 'v-fold', 'curved-shell'].includes(spec.kind) ? ['deck'] : []
}

/** 全開の面UVが占める長さ。ヒンジの寸法指定と保存時検証が共有する。 */
export function mechanismSurfaceSize(spec: MechanismSpec, surfaceId: string): { width: number; height: number } {
  const p = spec.parameters, scale = spec.staging.openScale
  let width = p.width, height = p.height
  if (surfaceId === 'top' || surfaceId.startsWith('base-')) { width = surfaceId.startsWith('base-') ? p.width / 2 : p.width; height = p.depth }
  if (surfaceId === 'top-left' || surfaceId === 'top-right') { width = p.width / 2; height = p.depth }
  if (surfaceId.startsWith('wall-')) width = p.depth
  if (/^(front|back)-(left|right)$/.test(surfaceId)) width = p.width / 2
  if (surfaceId.startsWith('wing-')) { width = Math.hypot(p.width / 2, p.height); height = p.depth }
  if (surfaceId.startsWith('fold-')) width = Math.hypot(p.width / p.segments, p.depth)
  if (surfaceId.startsWith('shell-')) {
    const count = Math.max(8, p.segments * 2), i = Number(surfaceId.slice(6)), a = i / count * Math.PI * 2, b = (i + 1) / count * Math.PI * 2
    width = Math.hypot(p.width / 2 * (Math.cos(b) - Math.cos(a)), p.depth / 2 * (Math.sin(b) - Math.sin(a)))
  }
  return { width: width * scale, height: height * scale }
}

type MechanismOverrides = Omit<Partial<MechanismSpec>, 'kind' | 'parameters' | 'deployment' | 'staging'> & {
  parameters?: Partial<MechanismSpec['parameters']>
  deployment?: Partial<MechanismSpec['deployment']>
  staging?: Partial<MechanismSpec['staging']>
}

export function makeMechanism(kind: MechanismKind, overrides: MechanismOverrides = {}): MechanismSpec {
  return mechanismSchema.parse({
    kind,
    ...overrides,
    mount: overrides.mount ?? (kind === 'panel' ? { type: 'page', side: 'right' } : { type: 'gutter' }),
    staging: overrides.staging,
  })
}
