import type { ContentMotion, ParentSpace, ParticleElement, StageElement, VisualElement } from '../../schema/stageElement'
import { embeddedVideoAudioSchema, type EmbeddedVideoAudio } from '../../schema/audio'
import { elementDescendantIds } from '../hierarchy'
import { t } from '../i18n'
import type { VisualPresetId } from '../presets'
import { useBuilderStore } from '../store'
import type { AiCommandResult } from './types'
import { COLOR_PROPERTIES, DISCRETE_PROPERTIES, NUMBER_PROPERTIES, VEC3_PROPERTIES, type TimelineProperty, type TimelineTarget, type TimelineValue } from '../../schema/timeline'

type AssetPreset = Extract<VisualPresetId, 'paper-stack' | 'bottom-upright' | 'depth-layer'>

export const ELEMENT_TIMELINE_PROPERTIES: readonly TimelineProperty[] = [
  'position.x', 'position.y', 'position.z', 'rotation.x', 'rotation.y', 'rotation.z',
  'scale.x', 'scale.y', 'scale.z', 'scale', 'opacity', 'visible',
  'visual.image', 'visual.foregroundColor', 'visual.backgroundColor', 'visual.width', 'visual.height',
  'visual.particles.color', 'visual.particles.size',
]
export const ENVIRONMENT_TIMELINE_PROPERTIES: readonly TimelineProperty[] = [
  'background', 'ambient.color', 'ambient.intensity', 'directional.color', 'directional.intensity',
]
export const CAMERA_TIMELINE_PROPERTIES: readonly TimelineProperty[] = ['position', 'target', 'fov']

export function timelinePropertiesForTarget(target: TimelineTarget): readonly TimelineProperty[] {
  if (target.type === 'environment') return ENVIRONMENT_TIMELINE_PROPERTIES
  if (target.type === 'camera') return CAMERA_TIMELINE_PROPERTIES
  if (target.type === 'sound') return ['cue']
  return ELEMENT_TIMELINE_PROPERTIES
}

const failure = (action: string, message: string, fieldErrors: Record<string, string> = {}): AiCommandResult => ({
  ok: false,
  action,
  message,
  fieldErrors,
})

const success = (action: string, message: string, target?: { kind: string; id: string }, corrections: string[] = []): AiCommandResult => {
  const issues = useBuilderStore.getState().issues
  return {
    ok: true,
    action,
    target,
    message,
    corrections,
    validation: { errors: issues.errors.length, warnings: issues.warnings.length },
  }
}

export function placeAiAsset(input: {
  spreadId: string
  side: 'left' | 'right'
  assetId: string
  presetId: AssetPreset
  u: number
  v: number
}): AiCommandResult {
  const action = 'place-asset'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().ai.readOnly)
  const errors: Record<string, string> = {}
  if (!state.project.book.spreads.some((spread) => spread.id === input.spreadId)) errors.spreadId = t().ai.notFound
  const asset = state.project.assets.find((item) => item.id === input.assetId)
  if (!asset || !['image', 'svg', 'video'].includes(asset.type)) errors.assetId = t().ai.notFound
  if (!Number.isFinite(input.u) || input.u < 0 || input.u > 1) errors.u = t().ai.normalizedRange
  if (!Number.isFinite(input.v) || input.v < 0 || input.v > 1) errors.v = t().ai.normalizedRange
  if (Object.keys(errors).length) return failure(action, t().ai.invalidInput, errors)

  // storeのpoint.xはページローカル左端が0。左面だけuの向きを反転し、両面でu=0を背表紙に揃える。
  const point = { x: input.side === 'left' ? 1 - input.u : input.u, y: input.v }
  const id = state.placeAssetWithPreset(input.spreadId, input.side, input.assetId, input.presetId, point)
  if (!id) return failure(action, t().ai.commandFailed)
  const created = useBuilderStore.getState().project.book.spreads
    .find((spread) => spread.id === input.spreadId)?.elements.find((element) => element.id === id)
  const corrections = created && created.parent.type !== `${input.side}-page`
    ? [t().ai.pageCorrected(created.parent.type)]
    : []
  return success(action, t().ai.placed(created?.name ?? id), { kind: 'element', id }, corrections)
}

export function createAiVisual(input: {
  spreadId: string
  side: 'left' | 'right'
  presetId: Extract<VisualPresetId, 'light-particles' | 'page-text'>
}): AiCommandResult {
  const action = 'create-visual'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().ai.readOnly)
  if (!state.project.book.spreads.some((spread) => spread.id === input.spreadId)) {
    return failure(action, t().ai.invalidInput, { spreadId: t().ai.notFound })
  }
  const id = state.addPresetVisual(input.spreadId, input.side, input.presetId)
  if (!id) return failure(action, t().ai.commandFailed)
  return success(action, t().ai.created(id), { kind: 'element', id })
}

export interface AiElementUpdate {
  name: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
  layer: number
  visible: boolean
  opacity: number
  pivot?: [number, number]
  width?: number
  height?: number
  billboard?: boolean
  image?: string | null
  backImage?: string | null
  backgroundColor?: string
  foregroundColor?: string
  text?: string
  fontSize?: number
  font?: VisualElement['font']
  align?: VisualElement['align']
  bold?: boolean
  italic?: boolean
  underline?: boolean
  particles?: Omit<VisualElement['particles'], 'enabled'> & { enabled?: boolean }
  motion?: ContentMotion[]
  videoAudio?: EmbeddedVideoAudio | null
  backVideoAudio?: EmbeddedVideoAudio | null
}

export function updateAiElement(spreadId: string, elementId: string, input: AiElementUpdate): AiCommandResult {
  const action = 'update-element'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().ai.readOnly)
  const element = state.project.book.spreads.find((spread) => spread.id === spreadId)?.elements.find((item) => item.id === elementId)
  if (!element) return failure(action, t().ai.notFound)
  const errors: Record<string, string> = {}
  if (!input.name.trim()) errors.name = t().ai.required
  for (const [group, values] of Object.entries({ position: input.position, rotation: input.rotation, scale: input.scale })) {
    values.forEach((value, index) => { if (!Number.isFinite(value)) errors[`${group}.${index}`] = t().ai.finiteNumber })
  }
  if (!Number.isFinite(input.layer)) errors.layer = t().ai.finiteNumber
  if (!Number.isFinite(input.opacity)) errors.opacity = t().ai.finiteNumber
  if (input.pivot && input.pivot.some((value) => !Number.isFinite(value))) errors.pivot = t().ai.finiteNumber
  if (input.width !== undefined && (!Number.isFinite(input.width) || input.width <= 0)) errors.width = t().ai.positiveNumber
  if (input.height !== undefined && (!Number.isFinite(input.height) || input.height <= 0)) errors.height = t().ai.positiveNumber
  if (input.fontSize !== undefined && (!Number.isFinite(input.fontSize) || input.fontSize <= 0)) errors.fontSize = t().ai.positiveNumber
  if (input.particles) {
    if (!Number.isInteger(input.particles.count) || input.particles.count < 1 || input.particles.count > 200) {
      errors.particleCount = t().ai.invalidInput
    }
    if (!Number.isFinite(input.particles.size) || input.particles.size <= 0) errors.particleSize = t().ai.positiveNumber
    if (!Number.isFinite(input.particles.drift) || input.particles.drift < 0) errors.particleDrift = t().ai.invalidInput
    if (!Number.isFinite(input.particles.period) || input.particles.period <= 0) errors.particlePeriod = t().ai.positiveNumber
  }
  for (const [field, value] of [['videoAudio', input.videoAudio], ['backVideoAudio', input.backVideoAudio]] as const) {
    if (value && !embeddedVideoAudioSchema.safeParse(value).success) errors[field] = t().ai.invalidInput
  }
  if (Object.keys(errors).length) return failure(action, t().ai.invalidInput, errors)

  state.updateElement(spreadId, elementId, (target) => {
    target.name = input.name.trim()
    target.baseTransform.position = [...input.position]
    target.baseTransform.rotation = [...input.rotation]
    target.baseTransform.scale = [...input.scale]
    if (input.pivot) target.pivot = [...input.pivot]
    target.layer = Math.round(input.layer)
    target.visible = input.visible
    target.opacity = Math.min(1, Math.max(0, input.opacity))
    if (target.type === 'visual') {
      if (input.width !== undefined) target.width = input.width
      if (input.height !== undefined) target.height = input.height
      if (input.billboard !== undefined) target.billboard = input.billboard
      if (input.image !== undefined) target.image = input.image ?? undefined
      if (input.backImage !== undefined) target.backImage = input.backImage ?? undefined
      if (input.backgroundColor !== undefined) target.backgroundColor = input.backgroundColor
      if (input.foregroundColor !== undefined) target.foregroundColor = input.foregroundColor
      if (input.text !== undefined) target.text = input.text
      if (input.fontSize !== undefined) target.fontSize = input.fontSize
      if (input.font !== undefined) target.font = input.font
      if (input.align !== undefined) target.align = input.align
      if (input.bold !== undefined) target.bold = input.bold
      if (input.italic !== undefined) target.italic = input.italic
      if (input.underline !== undefined) target.underline = input.underline
      if (input.motion !== undefined) target.motion = structuredClone(input.motion)
      if (input.videoAudio !== undefined) target.videoAudio = input.videoAudio ?? undefined
      if (input.backVideoAudio !== undefined) target.backVideoAudio = input.backVideoAudio ?? undefined
      if (input.particles !== undefined) target.particles = {
        ...target.particles,
        ...structuredClone(input.particles),
        enabled: input.particles.enabled ?? target.particles.enabled,
      }
    } else if (target.type === 'particle') {
      if (input.width !== undefined) target.width = input.width
      if (input.height !== undefined) target.height = input.height
      if (input.billboard !== undefined) target.billboard = input.billboard
      if (input.particles !== undefined) target.particles = {
        ...target.particles,
        ...structuredClone(input.particles),
      }
      if (input.motion !== undefined) target.motion = structuredClone(input.motion)
    }
  })
  const after = useBuilderStore.getState().project.book.spreads.find((spread) => spread.id === spreadId)
    ?.elements.find((item) => item.id === elementId)
  const requested = input.position.join(',')
  const actual = after?.baseTransform.position.join(',')
  const corrections = actual && actual !== requested ? [t().ai.positionCorrected(requested, actual)] : []
  return success(action, t().ai.updated(after?.name ?? elementId), { kind: 'element', id: elementId }, corrections)
}

export function moveAiElement(spreadId: string, elementId: string, parent: ParentSpace): AiCommandResult {
  const action = 'move-element'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().ai.readOnly)
  const spread = state.project.book.spreads.find((item) => item.id === spreadId)
  const element = spread?.elements.find((item) => item.id === elementId)
  if (!spread || !element) return failure(action, t().ai.notFound)
  if (parent.type === 'element') {
    const descendants = elementDescendantIds(spread, elementId)
    if (parent.elementId === elementId || descendants.has(parent.elementId)) return failure(action, t().ai.invalidParent)
    if (!spread.elements.some((item) => item.id === parent.elementId)) return failure(action, t().ai.notFound)
  }
  state.moveElement(spreadId, elementId, parent)
  return success(action, t().ai.moved(element.name), { kind: 'element', id: elementId })
}

export function addAiTimelineKey(input: {
  spreadId: string
  target: TimelineTarget
  property: TimelineProperty
  time: number
  value: TimelineValue
}): AiCommandResult {
  const action = 'add-timeline-key'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().ai.readOnly)
  const spread = state.project.book.spreads.find((item) => item.id === input.spreadId)
  if (!spread) return failure(action, t().ai.notFound, { spreadId: t().ai.notFound })
  const errors: Record<string, string> = {}
  if (!Number.isFinite(input.time) || input.time < 0 || input.time > spread.sequence.holdSeconds) {
    errors.time = t().ai.timelineTimeRange
  }
  if (!timelinePropertiesForTarget(input.target).includes(input.property)) errors.property = t().ai.invalidInput
  if (input.target.type === 'element') {
    const elementId = input.target.elementId
    if (!spread.elements.some((element) => element.id === elementId)) errors.target = t().ai.notFound
  }
  if (input.target.type === 'sound') {
    const assetId = input.target.assetId
    if (!state.project.assets.some((asset) => asset.id === assetId && asset.type === 'audio')) errors.target = t().ai.notFound
  }
  if (NUMBER_PROPERTIES.has(input.property) && typeof input.value !== 'number') errors.value = t().ai.invalidInput
  if (COLOR_PROPERTIES.has(input.property) && typeof input.value !== 'string') errors.value = t().ai.invalidInput
  if (DISCRETE_PROPERTIES.has(input.property) && typeof input.value !== 'boolean' && input.property !== 'visual.image') {
    errors.value = t().ai.invalidInput
  }
  if (VEC3_PROPERTIES.has(input.property) && (!Array.isArray(input.value) || input.value.length !== 3
    || input.value.some((value) => !Number.isFinite(value)))) errors.value = t().ai.invalidInput
  if (input.property === 'visual.image' && (typeof input.value !== 'string'
    || !state.project.assets.some((asset) => asset.id === input.value && ['image', 'svg', 'video'].includes(asset.type)))) {
    errors.value = t().ai.notFound
  }
  if (Object.keys(errors).length) return failure(action, t().ai.invalidInput, errors)

  state.upsertTimelineKey(input.spreadId, input.target, input.property, input.time, input.value)
  return success(action, t().ai.timelineKeyAdded, {
    kind: 'timeline',
    id: `${timelineTargetValue(input.target)}:${input.property}:${input.time}`,
  })
}

export function assignAiBgm(assetId: string): AiCommandResult {
  const action = 'assign-bgm'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().ai.readOnly)
  const asset = state.project.assets.find((item) => item.id === assetId)
  if (!asset || asset.type !== 'audio') return failure(action, t().ai.notFound, { asset: t().ai.notFound })
  state.assignBgm(asset)
  return success(action, t().ai.bgmAssigned, { kind: 'bgm', id: asset.id })
}

export function clearAiBgm(): AiCommandResult {
  const action = 'clear-bgm'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().ai.readOnly)
  state.clearBgm()
  return success(action, t().ai.bgmCleared)
}

export function addAiSpread(): AiCommandResult {
  const action = 'add-spread'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().ai.readOnly)
  state.addSpread()
  return success(action, t().ai.spreadAdded, { kind: 'spread', id: useBuilderStore.getState().activeSpreadId })
}

export function duplicateAiSpread(spreadId: string): AiCommandResult {
  const action = 'duplicate-spread'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().ai.readOnly)
  if (!state.project.book.spreads.some((spread) => spread.id === spreadId)) return failure(action, t().ai.notFound)
  state.duplicateSpread(spreadId)
  return success(action, t().ai.spreadDuplicated, { kind: 'spread', id: useBuilderStore.getState().activeSpreadId })
}

export function moveAiSpread(spreadId: string, direction: -1 | 1): AiCommandResult {
  const action = direction < 0 ? 'move-spread-earlier' : 'move-spread-later'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().ai.readOnly)
  if (!state.project.book.spreads.some((spread) => spread.id === spreadId)) return failure(action, t().ai.notFound)
  const index = state.project.book.spreads.findIndex((spread) => spread.id === spreadId)
  if (index + direction < 0 || index + direction >= state.project.book.spreads.length) {
    return failure(action, t().ai.invalidInput, { direction: t().ai.invalidInput })
  }
  state.moveSpread(spreadId, direction)
  return success(action, direction < 0 ? t().ai.spreadMovedEarlier : t().ai.spreadMovedLater, { kind: 'spread', id: spreadId })
}

export function undoAi(): AiCommandResult {
  const action = 'undo'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().ai.readOnly)
  if (!state.undoStack.length) return failure(action, t().ai.commandFailed)
  state.undo()
  return success(action, 'Undid the last edit')
}

export function redoAi(): AiCommandResult {
  const action = 'redo'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().ai.readOnly)
  if (!state.redoStack.length) return failure(action, t().ai.commandFailed)
  state.redo()
  return success(action, 'Redid the last edit')
}

function timelineTargetValue(target: TimelineTarget): string {
  if (target.type === 'element') return `element:${target.elementId}`
  if (target.type === 'sound') return `sound:${target.assetId}`
  return target.type
}

export function parseFinite(value: FormDataEntryValue | null): number {
  if (typeof value !== 'string' || value.trim() === '') return Number.NaN
  return Number(value)
}

export function parentValue(parent: ParentSpace): string {
  return parent.type === 'element' ? `element:${parent.elementId}` : parent.type
}

export function parseParent(value: string): ParentSpace | null {
  if (value === 'left-page' || value === 'right-page') return { type: value }
  if (value.startsWith('element:') && value.length > 'element:'.length) return { type: 'element', elementId: value.slice('element:'.length) }
  return null
}

export function visualElement(element: StageElement | undefined): element is Extract<StageElement, { type: 'visual' }> {
  return element?.type === 'visual'
}

export function particleElement(element: StageElement | undefined): element is ParticleElement {
  return element?.type === 'particle'
}
