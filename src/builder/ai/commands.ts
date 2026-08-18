import type { ParentSpace, StageElement } from '../../schema/stageElement'
import { embeddedVideoAudioSchema, type EmbeddedVideoAudio } from '../../schema/audio'
import { elementDescendantIds } from '../hierarchy'
import { t } from '../i18n'
import type { VisualPresetId } from '../presets'
import { useBuilderStore } from '../store'
import type { AiCommandResult } from './types'

type AssetPreset = Extract<VisualPresetId, 'paper-stack' | 'bottom-upright' | 'depth-layer'>

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
  width?: number
  height?: number
  text?: string
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
  if (input.width !== undefined && (!Number.isFinite(input.width) || input.width <= 0)) errors.width = t().ai.positiveNumber
  if (input.height !== undefined && (!Number.isFinite(input.height) || input.height <= 0)) errors.height = t().ai.positiveNumber
  for (const [field, value] of [['videoAudio', input.videoAudio], ['backVideoAudio', input.backVideoAudio]] as const) {
    if (value && !embeddedVideoAudioSchema.safeParse(value).success) errors[field] = t().ai.invalidInput
  }
  if (Object.keys(errors).length) return failure(action, t().ai.invalidInput, errors)

  state.updateElement(spreadId, elementId, (target) => {
    target.name = input.name.trim()
    target.baseTransform.position = [...input.position]
    target.baseTransform.rotation = [...input.rotation]
    target.baseTransform.scale = [...input.scale]
    target.layer = Math.round(input.layer)
    target.visible = input.visible
    target.opacity = Math.min(1, Math.max(0, input.opacity))
    if (target.type === 'visual') {
      if (input.width !== undefined) target.width = input.width
      if (input.height !== undefined) target.height = input.height
      if (input.text !== undefined) target.text = input.text
      if (input.videoAudio !== undefined) target.videoAudio = input.videoAudio ?? undefined
      if (input.backVideoAudio !== undefined) target.backVideoAudio = input.backVideoAudio ?? undefined
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
