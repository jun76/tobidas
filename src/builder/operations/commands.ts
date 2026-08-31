import type { ContentMotion, ParentSpace, ParticleElement, StageElement, VisualElement } from '../../schema/stageElement'
import { embeddedVideoAudioSchema, type EmbeddedVideoAudio } from '../../schema/audio'
import { elementDescendantIds } from '../hierarchy'
import { t } from '../i18n'
import type { VisualPresetId } from '../presets'
import { useBuilderStore } from '../store'
import type { BuilderCommandResult } from './types'
import { COLOR_PROPERTIES, DISCRETE_PROPERTIES, NUMBER_PROPERTIES, VEC3_PROPERTIES, type TimelineKey, type TimelineProperty, type TimelineTarget, type TimelineValue } from '../../schema/timeline'

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

const failure = (action: string, message: string, fieldErrors: Record<string, string> = {}): BuilderCommandResult => ({
  ok: false,
  action,
  message,
  fieldErrors,
})

const success = (action: string, message: string, target?: { kind: string; id: string }, corrections: string[] = []): BuilderCommandResult => {
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

export function placeAssetCommand(input: {
  spreadId: string
  side: 'left' | 'right'
  assetId: string
  presetId: AssetPreset
  u: number
  v: number
}): BuilderCommandResult {
  const action = 'place-asset'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  const errors: Record<string, string> = {}
  if (!state.project.book.spreads.some((spread) => spread.id === input.spreadId)) errors.spreadId = t().operations.notFound
  const asset = state.project.assets.find((item) => item.id === input.assetId)
  if (!asset || !['image', 'svg', 'video'].includes(asset.type)) errors.assetId = t().operations.notFound
  if (!Number.isFinite(input.u) || input.u < 0 || input.u > 1) errors.u = t().operations.normalizedRange
  if (!Number.isFinite(input.v) || input.v < 0 || input.v > 1) errors.v = t().operations.normalizedRange
  if (Object.keys(errors).length) return failure(action, t().operations.invalidInput, errors)

  // storeのpoint.xはページローカル左端が0。左面だけuの向きを反転し、両面でu=0を背表紙に揃える。
  const point = { x: input.side === 'left' ? 1 - input.u : input.u, y: input.v }
  const id = state.placeAssetWithPreset(input.spreadId, input.side, input.assetId, input.presetId, point)
  if (!id) return failure(action, t().operations.commandFailed)
  const created = useBuilderStore.getState().project.book.spreads
    .find((spread) => spread.id === input.spreadId)?.elements.find((element) => element.id === id)
  const corrections = created && created.parent.type !== `${input.side}-page`
    ? [t().operations.pageCorrected(created.parent.type)]
    : []
  return success(action, t().operations.placed(created?.name ?? id), { kind: 'element', id }, corrections)
}

export function createVisualCommand(input: {
  spreadId: string
  side: 'left' | 'right'
  presetId: Extract<VisualPresetId, 'light-particles' | 'page-text'>
}): BuilderCommandResult {
  const action = 'create-visual'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  if (!state.project.book.spreads.some((spread) => spread.id === input.spreadId)) {
    return failure(action, t().operations.invalidInput, { spreadId: t().operations.notFound })
  }
  const id = state.addPresetVisual(input.spreadId, input.side, input.presetId)
  if (!id) return failure(action, t().operations.commandFailed)
  return success(action, t().operations.created(id), { kind: 'element', id })
}

export interface ElementUpdateInput {
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

export function updateElementCommand(spreadId: string, elementId: string, input: ElementUpdateInput): BuilderCommandResult {
  const action = 'update-element'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  const element = state.project.book.spreads.find((spread) => spread.id === spreadId)?.elements.find((item) => item.id === elementId)
  if (!element) return failure(action, t().operations.notFound)
  const errors: Record<string, string> = {}
  if (!input.name.trim()) errors.name = t().operations.required
  for (const [group, values] of Object.entries({ position: input.position, rotation: input.rotation, scale: input.scale })) {
    values.forEach((value, index) => { if (!Number.isFinite(value)) errors[`${group}.${index}`] = t().operations.finiteNumber })
  }
  if (!Number.isFinite(input.layer)) errors.layer = t().operations.finiteNumber
  if (!Number.isFinite(input.opacity)) errors.opacity = t().operations.finiteNumber
  if (input.pivot && input.pivot.some((value) => !Number.isFinite(value))) errors.pivot = t().operations.finiteNumber
  if (input.width !== undefined && (!Number.isFinite(input.width) || input.width <= 0)) errors.width = t().operations.positiveNumber
  if (input.height !== undefined && (!Number.isFinite(input.height) || input.height <= 0)) errors.height = t().operations.positiveNumber
  if (input.fontSize !== undefined && (!Number.isFinite(input.fontSize) || input.fontSize <= 0)) errors.fontSize = t().operations.positiveNumber
  if (input.particles) {
    if (!Number.isInteger(input.particles.count) || input.particles.count < 1 || input.particles.count > 200) {
      errors.particleCount = t().operations.invalidInput
    }
    if (!Number.isFinite(input.particles.size) || input.particles.size <= 0) errors.particleSize = t().operations.positiveNumber
    if (!Number.isFinite(input.particles.drift) || input.particles.drift < 0) errors.particleDrift = t().operations.invalidInput
    if (!Number.isFinite(input.particles.period) || input.particles.period <= 0) errors.particlePeriod = t().operations.positiveNumber
  }
  for (const [field, value] of [['videoAudio', input.videoAudio], ['backVideoAudio', input.backVideoAudio]] as const) {
    if (value && !embeddedVideoAudioSchema.safeParse(value).success) errors[field] = t().operations.invalidInput
  }
  if (Object.keys(errors).length) return failure(action, t().operations.invalidInput, errors)

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
  const corrections = actual && actual !== requested ? [t().operations.positionCorrected(requested, actual)] : []
  return success(action, t().operations.updated(after?.name ?? elementId), { kind: 'element', id: elementId }, corrections)
}

export function moveElementCommand(spreadId: string, elementId: string, parent: ParentSpace): BuilderCommandResult {
  const action = 'move-element'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  const spread = state.project.book.spreads.find((item) => item.id === spreadId)
  const element = spread?.elements.find((item) => item.id === elementId)
  if (!spread || !element) return failure(action, t().operations.notFound)
  if (parent.type === 'element') {
    const descendants = elementDescendantIds(spread, elementId)
    if (parent.elementId === elementId || descendants.has(parent.elementId)) return failure(action, t().operations.invalidParent)
    if (!spread.elements.some((item) => item.id === parent.elementId)) return failure(action, t().operations.notFound)
  }
  state.moveElement(spreadId, elementId, parent)
  return success(action, t().operations.moved(element.name), { kind: 'element', id: elementId })
}

export function setPageBackgroundCommand(spreadId: string, side: 'left' | 'right', assetId: string): BuilderCommandResult {
  const action = 'set-page-background'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  const spread = state.project.book.spreads.find((item) => item.id === spreadId)
  if (!spread) return failure(action, t().operations.notFound, { spreadId: t().operations.notFound })
  const asset = state.project.assets.find((item) => item.id === assetId)
  if (!asset || !['image', 'svg', 'video'].includes(asset.type)) {
    return failure(action, t().operations.notFound, { assetId: t().operations.notFound })
  }
  state.commit((project) => {
    const target = project.book.spreads.find((item) => item.id === spreadId)
    if (!target) return
    target[side === 'left' ? 'leftPage' : 'rightPage'].backgroundAsset = assetId
  })
  state.select({ type: 'page', spreadId, side })
  return success(action, t().operations.pageBackgroundSet, { kind: 'page', id: `${spreadId}:${side}` })
}

export function clearPageBackgroundCommand(spreadId: string, side: 'left' | 'right'): BuilderCommandResult {
  const action = 'clear-page-background'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  const spread = state.project.book.spreads.find((item) => item.id === spreadId)
  if (!spread) return failure(action, t().operations.notFound, { spreadId: t().operations.notFound })
  state.commit((project) => {
    const target = project.book.spreads.find((item) => item.id === spreadId)
    if (!target) return
    const page = target[side === 'left' ? 'leftPage' : 'rightPage']
    page.backgroundAsset = undefined
    page.backgroundVideoAudio = undefined
  })
  state.select({ type: 'page', spreadId, side })
  return success(action, t().operations.pageBackgroundCleared, { kind: 'page', id: `${spreadId}:${side}` })
}

export function deleteElementCommand(spreadId: string, elementId: string): BuilderCommandResult {
  const action = 'delete-element'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  const spread = state.project.book.spreads.find((item) => item.id === spreadId)
  const element = spread?.elements.find((item) => item.id === elementId)
  if (!spread || !element) return failure(action, t().operations.notFound, { elementId: t().operations.notFound })
  state.removeElement(spreadId, elementId)
  return success(action, t().operations.elementDeleted, { kind: 'spread', id: spreadId })
}

export function addTimelineKeyCommand(input: {
  spreadId: string
  target: TimelineTarget
  property: TimelineProperty
  time: number
  value: TimelineValue
  ease?: TimelineKey['ease']
}): BuilderCommandResult {
  const action = 'add-timeline-key'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  const spread = state.project.book.spreads.find((item) => item.id === input.spreadId)
  if (!spread) return failure(action, t().operations.notFound, { spreadId: t().operations.notFound })
  const errors: Record<string, string> = {}
  if (!Number.isFinite(input.time) || input.time < 0 || input.time > spread.sequence.holdSeconds) {
    errors.time = t().operations.timelineTimeRange
  }
  if (!timelinePropertiesForTarget(input.target).includes(input.property)) errors.property = t().operations.invalidInput
  if (input.target.type === 'element') {
    const elementId = input.target.elementId
    if (!spread.elements.some((element) => element.id === elementId)) errors.target = t().operations.notFound
  }
  if (input.target.type === 'sound') {
    const assetId = input.target.assetId
    if (!state.project.assets.some((asset) => asset.id === assetId && asset.type === 'audio')) errors.target = t().operations.notFound
  }
  const valueError = timelineValueError(input.property, input.value, state.project.assets)
  if (valueError) errors.value = valueError
  if (Object.keys(errors).length) return failure(action, t().operations.invalidInput, errors)

  state.upsertTimelineKey(input.spreadId, input.target, input.property, input.time, input.value)
  if (input.ease) {
    const current = useBuilderStore.getState()
    const track = current.project.book.spreads.find((item) => item.id === input.spreadId)?.timeline.tracks
      .find((item) => JSON.stringify(item.target) === JSON.stringify(input.target) && item.property === input.property)
    const key = track?.keys.find((item) => Math.abs(item.time - input.time) < .001)
    if (track && key) current.setTimelineKeyEase(input.spreadId, track.id, key.id, input.ease)
  }
  return success(action, t().operations.timelineKeyAdded, {
    kind: 'timeline',
    id: `${timelineTargetValue(input.target)}:${input.property}:${input.time}`,
  })
}

export function updateTimelineKeyCommand(input: {
  spreadId: string
  trackId: string
  keyId: string
  time?: number
  value?: TimelineValue
  ease?: TimelineKey['ease']
}): BuilderCommandResult {
  const action = 'update-timeline-key'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  const spread = state.project.book.spreads.find((item) => item.id === input.spreadId)
  const track = spread?.timeline.tracks.find((item) => item.id === input.trackId)
  const key = track?.keys.find((item) => item.id === input.keyId)
  if (!spread || !track || !key) return failure(action, t().operations.notFound)
  const errors: Record<string, string> = {}
  if (input.time !== undefined && (!Number.isFinite(input.time) || input.time < 0 || input.time > spread.sequence.holdSeconds)) {
    errors.time = t().operations.timelineTimeRange
  }
  if (input.value !== undefined) {
    const valueError = timelineValueError(track.property, input.value, state.project.assets)
    if (valueError) errors.value = valueError
  }
  if (Object.keys(errors).length) return failure(action, t().operations.invalidInput, errors)
  state.commit((project) => {
    const targetSpread = project.book.spreads.find((item) => item.id === input.spreadId)
    const targetTrack = targetSpread?.timeline.tracks.find((item) => item.id === input.trackId)
    const targetKey = targetTrack?.keys.find((item) => item.id === input.keyId)
    if (!targetSpread || !targetTrack || !targetKey) return
    if (input.time !== undefined) targetKey.time = input.time
    if (input.value !== undefined) targetKey.value = structuredClone(input.value)
    if (input.ease !== undefined) targetKey.ease = input.ease
    if (input.time !== undefined) {
      targetTrack.keys = targetTrack.keys.filter((item) => item.id === input.keyId || Math.abs(item.time - input.time!) >= 0.001)
      targetTrack.keys.sort((a, b) => a.time - b.time)
    }
  })
  return success(action, t().operations.timelineKeyUpdated, { kind: 'timeline', id: input.keyId })
}

export function deleteTimelineKeyCommand(spreadId: string, trackId: string, keyId: string): BuilderCommandResult {
  const action = 'delete-timeline-key'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  const track = state.project.book.spreads.find((item) => item.id === spreadId)
    ?.timeline.tracks.find((item) => item.id === trackId)
  if (!track?.keys.some((item) => item.id === keyId)) return failure(action, t().operations.notFound)
  state.removeTimelineKey(spreadId, trackId, keyId)
  return success(action, t().operations.timelineKeyDeleted, { kind: 'spread', id: spreadId })
}

export function setCameraCommand(input: {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}): BuilderCommandResult {
  const action = 'set-camera'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  const errors = cameraErrors(input)
  if (Object.keys(errors).length) return failure(action, t().operations.invalidInput, errors)
  state.commit((project) => { project.book.camera = structuredClone(input) })
  state.select({ type: 'book' })
  return success(action, t().operations.cameraUpdated, { kind: 'camera', id: 'camera' })
}

export function addCameraKeyCommand(input: {
  spreadId: string
  time: number
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}): BuilderCommandResult {
  const action = 'add-camera-key'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  const spread = state.project.book.spreads.find((item) => item.id === input.spreadId)
  const errors = cameraErrors(input)
  if (!spread) errors.spreadId = t().operations.notFound
  else if (!Number.isFinite(input.time) || input.time < 0 || input.time > spread.sequence.holdSeconds) errors.time = t().operations.timelineTimeRange
  if (Object.keys(errors).length) return failure(action, t().operations.invalidInput, errors)
  state.upsertCameraKeys(input.spreadId, input.time, {
    position: input.position,
    target: input.target,
    fov: input.fov,
  })
  return success(action, t().operations.cameraKeyAdded, { kind: 'timeline', id: `${input.spreadId}:camera:${input.time}` })
}

export function assignBgmCommand(assetId: string): BuilderCommandResult {
  const action = 'assign-bgm'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  const asset = state.project.assets.find((item) => item.id === assetId)
  if (!asset || asset.type !== 'audio') return failure(action, t().operations.notFound, { asset: t().operations.notFound })
  state.assignBgm(asset)
  return success(action, t().operations.bgmAssigned, { kind: 'bgm', id: asset.id })
}

export function clearBgmCommand(): BuilderCommandResult {
  const action = 'clear-bgm'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  state.clearBgm()
  return success(action, t().operations.bgmCleared)
}

export function addSpreadCommand(): BuilderCommandResult {
  const action = 'add-spread'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  state.addSpread()
  return success(action, t().operations.spreadAdded, { kind: 'spread', id: useBuilderStore.getState().activeSpreadId })
}

export function duplicateSpreadCommand(spreadId: string): BuilderCommandResult {
  const action = 'duplicate-spread'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  if (!state.project.book.spreads.some((spread) => spread.id === spreadId)) return failure(action, t().operations.notFound)
  state.duplicateSpread(spreadId)
  return success(action, t().operations.spreadDuplicated, { kind: 'spread', id: useBuilderStore.getState().activeSpreadId })
}

export function moveSpreadCommand(spreadId: string, direction: -1 | 1): BuilderCommandResult {
  const action = direction < 0 ? 'move-spread-earlier' : 'move-spread-later'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  if (!state.project.book.spreads.some((spread) => spread.id === spreadId)) return failure(action, t().operations.notFound)
  const index = state.project.book.spreads.findIndex((spread) => spread.id === spreadId)
  if (index + direction < 0 || index + direction >= state.project.book.spreads.length) {
    return failure(action, t().operations.invalidInput, { direction: t().operations.invalidInput })
  }
  state.moveSpread(spreadId, direction)
  return success(action, direction < 0 ? t().operations.spreadMovedEarlier : t().operations.spreadMovedLater, { kind: 'spread', id: spreadId })
}

export function deleteSpreadCommand(spreadId: string): BuilderCommandResult {
  const action = 'delete-spread'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  if (!state.project.book.spreads.some((spread) => spread.id === spreadId)) return failure(action, t().operations.notFound)
  if (state.project.book.spreads.length < 2) return failure(action, t().operations.lastSpread)
  state.removeSpread(spreadId)
  return success(action, t().operations.spreadDeleted, { kind: 'spread', id: useBuilderStore.getState().activeSpreadId })
}

export function undoCommand(): BuilderCommandResult {
  const action = 'undo'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  if (!state.undoStack.length) return failure(action, t().operations.commandFailed)
  state.undo()
  return success(action, 'Undid the last edit')
}

export function redoCommand(): BuilderCommandResult {
  const action = 'redo'
  const state = useBuilderStore.getState()
  if (state.mode !== 'edit') return failure(action, t().operations.readOnly)
  if (!state.redoStack.length) return failure(action, t().operations.commandFailed)
  state.redo()
  return success(action, 'Redid the last edit')
}

function timelineTargetValue(target: TimelineTarget): string {
  if (target.type === 'element') return `element:${target.elementId}`
  if (target.type === 'sound') return `sound:${target.assetId}`
  return target.type
}

function timelineValueError(property: TimelineProperty, value: TimelineValue, assets: ReturnType<typeof useBuilderStore.getState>['project']['assets']): string | undefined {
  if (NUMBER_PROPERTIES.has(property) && typeof value !== 'number') return t().operations.invalidInput
  if (COLOR_PROPERTIES.has(property) && typeof value !== 'string') return t().operations.invalidInput
  if (DISCRETE_PROPERTIES.has(property) && typeof value !== 'boolean' && property !== 'visual.image') return t().operations.invalidInput
  if (VEC3_PROPERTIES.has(property) && (!Array.isArray(value) || value.length !== 3
    || value.some((item) => !Number.isFinite(item)))) return t().operations.invalidInput
  if (property === 'visual.image' && (typeof value !== 'string'
    || !assets.some((asset) => asset.id === value && ['image', 'svg', 'video'].includes(asset.type)))) return t().operations.notFound
  return undefined
}

function cameraErrors(input: { position: [number, number, number]; target: [number, number, number]; fov: number }): Record<string, string> {
  const errors: Record<string, string> = {}
  if (input.position.some((value) => !Number.isFinite(value))) errors.position = t().operations.finiteNumber
  if (input.target.some((value) => !Number.isFinite(value))) errors.target = t().operations.finiteNumber
  if (!Number.isFinite(input.fov) || input.fov <= 0 || input.fov >= 180) errors.fov = t().operations.invalidInput
  return errors
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
