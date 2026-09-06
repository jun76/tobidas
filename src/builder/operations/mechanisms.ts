import { z } from 'zod'
import { bookId, createStageElement } from '../../schema/bookDefaults'
import { makeMechanism, mechanismSchema, mechanismSurfaceIds, type MechanismSpec } from '../../schema/mechanism'
import type { AssemblyElement, StageElement } from '../../schema/stageElement'
import { elementDescendantIds } from '../hierarchy'
import { t } from '../i18n'
import { useBuilderStore } from '../store'
import type { BuilderCommandResult } from './types'
import { buildMechanismComposition, compositionKinds } from '../mechanismPresets'

export const mechanismKinds = ['panel', 'v-fold', 'beak', 'platform', 'box', 'accordion', 'curved-shell'] as const
const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
export const mechanismParametersInputSchema = z.object({
  width: z.number().positive().optional(), height: z.number().positive().optional(),
  depth: z.number().positive().optional(), segments: z.number().int().optional(), angleDeg: z.number().finite().optional(),
}).strict()
export const mechanismDeploymentInputSchema = z.object({ mode: z.enum(['page-constrained', 'virtual']).optional(), start: z.number().optional(), end: z.number().optional() }).strict()
export const mechanismStagingInputSchema = z.object({
  closedScale: z.number().optional(), closedPosition: vec3.optional(), floatAmplitude: vec3.optional(),
  floatPeriod: z.number().positive().optional(), floatPhase: z.number().finite().optional(), fadeStart: z.number().optional(), fadeEnd: z.number().optional(),
}).strict()
export const mechanismMountInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('page'), side: z.enum(['left', 'right']) }).strict(),
  z.object({ type: z.literal('gutter') }).strict(), z.object({ type: z.literal('space') }).strict(),
  z.object({ type: z.literal('surface'), elementId: z.string().min(1), surfaceId: z.string().min(1),
    u: z.number().min(0).max(1), v: z.number().min(0).max(1), offset: z.number().finite().default(0) }).strict(),
])
export const createMechanismInputSchema = z.object({
  spreadId: z.string().min(1), kind: z.enum(mechanismKinds), name: z.string().min(1).optional(),
  parameters: mechanismParametersInputSchema.optional(), mount: mechanismMountInputSchema.optional(),
  deployment: mechanismDeploymentInputSchema.optional(), staging: mechanismStagingInputSchema.optional(),
  position: vec3.optional(), rotation: vec3.optional(), color: z.string().optional(),
}).strict()
export const updateMechanismInputSchema = z.object({
  spreadId: z.string().min(1), elementId: z.string().min(1),
  parameters: mechanismParametersInputSchema.optional(), mount: mechanismMountInputSchema.optional(),
  deployment: mechanismDeploymentInputSchema.optional(), staging: mechanismStagingInputSchema.optional(),
}).strict()
export const setMechanismSurfaceInputSchema = z.object({
  spreadId: z.string().min(1), elementId: z.string().min(1), surfaceId: z.string().min(1),
  color: z.string().optional(), image: z.string().nullable().optional(), backImage: z.string().nullable().optional(),
  text: z.string().optional(), visible: z.boolean().optional(),
}).strict()
export const attachSurfaceInputSchema = z.object({
  spreadId: z.string().min(1), elementId: z.string().min(1), parentId: z.string().min(1), surfaceId: z.string().min(1),
  u: z.number().min(0).max(1), v: z.number().min(0).max(1), offset: z.number().finite().default(0),
}).strict()
export const placeSurfaceAssetInputSchema = attachSurfaceInputSchema.omit({ elementId: true }).extend({
  assetId: z.string().min(1), name: z.string().optional(), width: z.number().positive(), height: z.number().positive(),
  upright: z.boolean().default(true),
}).strict()
export const createCompositionInputSchema = z.object({
  spreadId: z.string().min(1), kind: z.enum(compositionKinds), name: z.string().optional(), count: z.number().int().min(1).max(12).default(3),
  spacing: z.number().positive().max(50).default(1.2), position: vec3.optional(), width: z.number().positive().default(6), depth: z.number().positive().default(4),
}).strict()
export const updateCompositionInputSchema = z.object({ spreadId: z.string().min(1), elementId: z.string().min(1),
  count: z.number().int().min(1).max(12), spacing: z.number().positive().max(50) }).strict()
export type CreateMechanismInput = z.input<typeof createMechanismInputSchema>
export type UpdateMechanismInput = z.input<typeof updateMechanismInputSchema>

function fail(action: string, message: string, fieldErrors: Record<string, string> = {}): BuilderCommandResult {
  return { ok: false, action, message, fieldErrors }
}
function done(action: string, id: string): BuilderCommandResult {
  const state = useBuilderStore.getState()
  return { ok: true, action, message: t().operations.updated(id), target: { kind: 'element', id }, corrections: [],
    validation: { errors: state.issues.errors.length, warnings: state.issues.warnings.length } }
}
function invalid(action: string, error: z.ZodError): BuilderCommandResult {
  return fail(action, t().operations.invalidInput, Object.fromEntries(error.issues.map((issue) => [issue.path.join('.'), issue.message])))
}
function readOnly(action: string): BuilderCommandResult | undefined {
  return useBuilderStore.getState().mode === 'edit' ? undefined : fail(action, t().operations.readOnly)
}
function spreadFor(id: string) { return useBuilderStore.getState().project.book.spreads.find((spread) => spread.id === id) }
function parentFor(spec: MechanismSpec): StageElement['parent'] {
  return spec.mount.type === 'surface' ? { type: 'element', elementId: spec.mount.elementId }
    : { type: spec.mount.type === 'page' && spec.mount.side === 'left' ? 'left-page' : 'right-page' }
}
function surfaceExists(spreadId: string, parentId: string, surfaceId: string): boolean {
  const parent = spreadFor(spreadId)?.elements.find((element) => element.id === parentId)
  return parent?.type === 'assembly' && mechanismSurfaceIds(parent.mechanism).includes(surfaceId)
}
function checkMount(spreadId: string, spec: MechanismSpec, elementId?: string): string | undefined {
  if (spec.mount.type !== 'surface') return undefined
  if (!surfaceExists(spreadId, spec.mount.elementId, spec.mount.surfaceId)) return t().operations.notFound
  const spread = spreadFor(spreadId)!
  if (elementId && (elementId === spec.mount.elementId || elementDescendantIds(spread, elementId).has(spec.mount.elementId))) return t().operations.invalidParent
  return undefined
}

/** UIとWebMCPが共有する、定義に基づく部品の原子的な投入。 */
export function createMechanismCommand(input: CreateMechanismInput): BuilderCommandResult {
  const action = 'create-mechanism'
  const blocked = readOnly(action); if (blocked) return blocked
  const parsed = createMechanismInputSchema.safeParse(input)
  if (!parsed.success) return invalid(action, parsed.error)
  const value = parsed.data
  if (!spreadFor(value.spreadId)) return fail(action, t().operations.notFound)
  const base = makeMechanism(value.kind)
  if (value.deployment?.mode === 'page-constrained') {
    base.mount = value.kind === 'panel' ? { type: 'page', side: 'right' } : { type: 'gutter' }
    base.staging.closedScale = 1
  }
  const checked = mechanismSchema.safeParse({ ...base, parameters: { ...base.parameters, ...value.parameters }, mount: value.mount ?? base.mount,
    deployment: { ...base.deployment, ...value.deployment }, staging: { ...base.staging, ...value.staging } })
  if (!checked.success) return invalid(action, checked.error)
  const spec = checked.data
  const mountError = checkMount(value.spreadId, spec)
  if (mountError) return fail(action, mountError)
  if (value.color) for (const id of mechanismSurfaceIds(spec)) spec.surfaces[id] = { color: value.color, visible: true }
  const element = createStageElement('assembly', parentFor(spec)) as AssemblyElement
  element.name = value.name ?? t().mechanisms.kinds[value.kind]
  element.mechanism = spec
  element.baseTransform.position = value.position ?? [0, 0, 0]
  element.baseTransform.rotation = value.rotation ?? [0, 0, 0]
  if (spec.deployment.mode === 'page-constrained' && (element.baseTransform.rotation.some((n) => n !== 0)
    || spec.mount.type === 'gutter' && element.baseTransform.position.slice(0, 2).some((n) => n !== 0))) return fail(action, t().mechanisms.constrainedHint)
  const state = useBuilderStore.getState()
  state.commit((project) => project.book.spreads.find((spread) => spread.id === value.spreadId)!.elements.push(element))
  state.select({ type: 'element', spreadId: value.spreadId, elementId: element.id })
  return done(action, element.id)
}

export function updateMechanismCommand(input: UpdateMechanismInput): BuilderCommandResult {
  const action = 'update-mechanism'
  const blocked = readOnly(action); if (blocked) return blocked
  const parsed = updateMechanismInputSchema.safeParse(input)
  if (!parsed.success) return invalid(action, parsed.error)
  const value = parsed.data
  const spread = spreadFor(value.spreadId)
  const element = spread?.elements.find((item) => item.id === value.elementId)
  if (!spread || element?.type !== 'assembly') return fail(action, t().operations.notFound)
  const current = element.mechanism
  const checked = mechanismSchema.safeParse({ ...current, parameters: { ...current.parameters, ...value.parameters }, mount: value.mount ?? current.mount,
    deployment: { ...current.deployment, ...value.deployment }, staging: { ...current.staging, ...value.staging } })
  if (!checked.success) return invalid(action, checked.error)
  const next = checked.data
  const mountError = checkMount(value.spreadId, next, element.id)
  if (mountError) return fail(action, mountError)
  const remaining = new Set(mechanismSurfaceIds(next))
  next.surfaces = Object.fromEntries(Object.entries(next.surfaces).filter(([id]) => remaining.has(id)))
  if (next.deployment.mode === 'page-constrained' && spread.timeline.tracks.some((track) => track.target.type === 'element'
    && track.target.elementId === element.id && /^(position|rotation|scale)(\.|$)/.test(track.property))) {
    return fail(action, t().mechanisms.constrainedTimeline)
  }
  const affected = spread.elements.filter((child) => child.parent.type === 'element' && child.parent.elementId === element.id &&
    !remaining.has(child.type === 'assembly' && child.mechanism.mount.type === 'surface' ? child.mechanism.mount.surfaceId : child.surfaceAttachment?.surfaceId ?? ''))
  if (affected.length) return fail(action, t().mechanisms.occupiedSurface(affected.map((child) => child.name).join(', ')), { parameters: t().mechanisms.moveChildrenFirst })
  useBuilderStore.getState().commit((project) => {
    const target = project.book.spreads.find((item) => item.id === value.spreadId)!.elements.find((item) => item.id === value.elementId) as AssemblyElement
    target.mechanism = next
    target.parent = parentFor(next)
    if (value.mount?.type === 'surface') target.baseTransform.position = [0, 0, 0]
    if (next.deployment.mode === 'page-constrained') {
      target.baseTransform.rotation = [0, 0, 0]; target.baseTransform.scale = [1, 1, 1]; target.motion = []
      if (next.mount.type === 'gutter') target.baseTransform.position = [0, 0, target.baseTransform.position[2]]
    }
    if (target.composition && value.parameters) {
      const spread = project.book.spreads.find((item) => item.id === value.spreadId)!
      const oldIds = new Set(buildMechanismComposition(element, target.composition).map((part) => part.id))
      const generated = buildMechanismComposition(target, target.composition)
      for (const part of generated) {
        const old = spread.elements.find((item) => item.id === part.id)
        if (old?.type === 'assembly') { part.name = old.name; part.mechanism.surfaces = old.mechanism.surfaces }
      }
      spread.elements = spread.elements.filter((part) => !oldIds.has(part.id)).concat(generated)
    }
  })
  return done(action, element.id)
}

export function setMechanismSurfaceCommand(input: z.input<typeof setMechanismSurfaceInputSchema>): BuilderCommandResult {
  const action = 'set-mechanism-surface'
  const blocked = readOnly(action); if (blocked) return blocked
  const parsed = setMechanismSurfaceInputSchema.safeParse(input)
  if (!parsed.success) return invalid(action, parsed.error)
  const value = parsed.data
  if (!surfaceExists(value.spreadId, value.elementId, value.surfaceId)) return fail(action, t().operations.notFound)
  const state = useBuilderStore.getState()
  for (const id of [value.image, value.backImage]) if (id && !state.project.assets.some((asset) => asset.id === id && ['image', 'svg'].includes(asset.type))) return fail(action, t().operations.notFound)
  state.commit((project) => {
    const target = project.book.spreads.find((spread) => spread.id === value.spreadId)!.elements.find((element) => element.id === value.elementId) as AssemblyElement
    const slot = target.mechanism.surfaces[value.surfaceId] ?? { color: '#e8c391', visible: true }
    if (value.color !== undefined) slot.color = value.color
    if (value.visible !== undefined) slot.visible = value.visible
    if (value.text !== undefined) slot.text = value.text
    if (value.image !== undefined) slot.image = value.image ?? undefined
    if (value.backImage !== undefined) slot.backImage = value.backImage ?? undefined
    target.mechanism.surfaces[value.surfaceId] = slot
  })
  return done(action, value.elementId)
}

export function attachToSurfaceCommand(input: z.input<typeof attachSurfaceInputSchema>): BuilderCommandResult {
  const action = 'attach-to-surface'
  const blocked = readOnly(action); if (blocked) return blocked
  const parsed = attachSurfaceInputSchema.safeParse(input)
  if (!parsed.success) return invalid(action, parsed.error)
  const value = parsed.data
  const spread = spreadFor(value.spreadId)
  const element = spread?.elements.find((item) => item.id === value.elementId)
  if (!spread || !element || !surfaceExists(value.spreadId, value.parentId, value.surfaceId)) return fail(action, t().operations.notFound)
  if (element.id === value.parentId || elementDescendantIds(spread, element.id).has(value.parentId)) return fail(action, t().operations.invalidParent)
  if (element.type === 'assembly') return updateMechanismCommand({ spreadId: value.spreadId, elementId: element.id,
    mount: { type: 'surface', elementId: value.parentId, surfaceId: value.surfaceId, u: value.u, v: value.v, offset: value.offset },
    deployment: { mode: 'virtual' } })
  useBuilderStore.getState().commit((project) => {
    const target = project.book.spreads.find((item) => item.id === value.spreadId)!.elements.find((item) => item.id === value.elementId)!
    target.parent = { type: 'element', elementId: value.parentId }
    target.surfaceAttachment = { surfaceId: value.surfaceId, u: value.u, v: value.v, offset: value.offset }
    target.baseTransform.position = [0, 0, 0]
  })
  return done(action, element.id)
}

export function placeSurfaceAssetCommand(input: z.input<typeof placeSurfaceAssetInputSchema>): BuilderCommandResult {
  const action = 'place-surface-asset'
  const blocked = readOnly(action); if (blocked) return blocked
  const parsed = placeSurfaceAssetInputSchema.safeParse(input)
  if (!parsed.success) return invalid(action, parsed.error)
  const value = parsed.data
  const state = useBuilderStore.getState()
  const asset = state.project.assets.find((item) => item.id === value.assetId && ['image', 'svg', 'video'].includes(item.type))
  if (!asset || !surfaceExists(value.spreadId, value.parentId, value.surfaceId)) return fail(action, t().operations.notFound)
  const child = createStageElement('visual', { type: 'element', elementId: value.parentId })
  if (child.type !== 'visual') return fail(action, t().operations.commandFailed)
  child.name = value.name ?? asset.name
  child.image = value.assetId; child.width = value.width; child.height = value.height
  child.surfaceAttachment = { surfaceId: value.surfaceId, u: value.u, v: value.v, offset: value.offset }
  child.baseTransform = { position: [0, 0, 0], rotation: [value.upright ? 0 : -90, 0, 0], scale: [1, 1, 1] }
  state.commit((project) => project.book.spreads.find((spread) => spread.id === value.spreadId)!.elements.push(child))
  state.select({ type: 'element', spreadId: value.spreadId, elementId: child.id })
  return done(action, child.id)
}

export function createCompositionCommand(input: z.input<typeof createCompositionInputSchema>): BuilderCommandResult {
  const action = 'create-composition'
  const blocked = readOnly(action); if (blocked) return blocked
  const parsed = createCompositionInputSchema.safeParse(input)
  if (!parsed.success) return invalid(action, parsed.error)
  const value = parsed.data
  if (!spreadFor(value.spreadId)) return fail(action, t().operations.notFound)
  const root = createStageElement('assembly') as AssemblyElement
  root.name = value.name ?? t().mechanisms.compositions[value.kind]
  root.mechanism = makeMechanism('platform', { parameters: { width: value.width, depth: value.depth, height: .25 } })
  root.baseTransform = { position: value.position ?? [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
  root.composition = { kind: value.kind, count: value.count, spacing: value.spacing }
  const children = buildMechanismComposition(root, root.composition)
  const state = useBuilderStore.getState()
  state.commit((project) => {
    const spread = project.book.spreads.find((spread) => spread.id === value.spreadId)!
    spread.elements.push(root, ...children)
    if (value.kind === 'scene') {
      spread.sequence.holdSeconds = Math.max(12, spread.sequence.holdSeconds)
      const center = root.baseTransform.position
      const pose = { position: [center[0], center[1] + 7, center[2] + 12] as [number, number, number], target: [center[0], center[1] + 1, center[2]] as [number, number, number], fov: 45 }
      // 舞台セットに対応する構図と保持時間を、部品の投入と同じundo単位で保存する。
      spread.timeline.tracks = spread.timeline.tracks.filter((track) => track.target.type !== 'camera')
      for (const property of ['position', 'target', 'fov'] as const) spread.timeline.tracks.push({ id: bookId('track'), target: { type: 'camera' }, property,
        keys: [{ id: bookId('key'), time: 0, value: pose[property], ease: 'linear' }] })
    }
  })
  state.select({ type: 'element', spreadId: value.spreadId, elementId: root.id })
  return done(action, root.id)
}

export function updateCompositionCommand(input: z.input<typeof updateCompositionInputSchema>): BuilderCommandResult {
  const action = 'update-composition'
  const blocked = readOnly(action); if (blocked) return blocked
  const parsed = updateCompositionInputSchema.safeParse(input)
  if (!parsed.success) return invalid(action, parsed.error)
  const value = parsed.data
  const spread = spreadFor(value.spreadId)
  const root = spread?.elements.find((item) => item.id === value.elementId)
  if (!spread || root?.type !== 'assembly' || !root.composition) return fail(action, t().operations.notFound)
  const settings = { ...root.composition, count: value.count, spacing: value.spacing }
  const generated = buildMechanismComposition(root, settings)
  const oldGenerated = new Set(buildMechanismComposition(root, root.composition).map((item) => item.id))
  const nextIds = new Set(generated.map((item) => item.id))
  const removedIds = new Set([...oldGenerated].filter((id) => !nextIds.has(id)))
  const affected = spread.elements.filter((item) => !oldGenerated.has(item.id) && item.parent.type === 'element' && removedIds.has(item.parent.elementId))
  if (affected.length) return fail(action, t().mechanisms.occupiedSurface(affected.map((item) => item.name).join(', ')))
  useBuilderStore.getState().commit((project) => {
    const target = project.book.spreads.find((item) => item.id === value.spreadId)!
    for (const part of generated) {
      const old = target.elements.find((item) => item.id === part.id)
      if (old?.type === 'assembly') { part.name = old.name; part.mechanism.surfaces = old.mechanism.surfaces }
    }
    target.elements = target.elements.filter((item) => !oldGenerated.has(item.id)).concat(generated)
    const targetRoot = target.elements.find((item) => item.id === root.id) as AssemblyElement
    targetRoot.composition = settings
    target.timeline.tracks = target.timeline.tracks.filter((track) => track.target.type !== 'element' || !removedIds.has(track.target.elementId))
  })
  return done(action, root.id)
}
