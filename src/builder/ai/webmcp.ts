import { useEffect } from 'react'
import { z } from 'zod'
import { contentMotionSchema, parentSpaceSchema, type ParentSpace } from '../../schema/stageElement'
import { embeddedVideoAudioSchema } from '../../schema/audio'
import { vec3Schema } from '../../schema/geometry'
import { timelinePropertySchema, timelineTargetSchema, timelineValueSchema } from '../../schema/timeline'
import { analyzeBookContainment, analyzeSpreadContainment } from '../../runtime/stow/containment'
import { useBuilderStore } from '../store'
import { t } from '../i18n'
import {
  addAiSpread,
  addAiTimelineKey,
  assignAiBgm,
  clearAiBgm,
  clearAiPageBackground,
  createAiVisual,
  deleteAiElement,
  deleteAiSpread,
  deleteAiTimelineKey,
  duplicateAiSpread,
  addAiCameraKey,
  moveAiElement,
  moveAiSpread,
  parseParent,
  placeAiAsset,
  redoAi,
  setAiCamera,
  setAiPageBackground,
  undoAi,
  updateAiTimelineKey,
  updateAiElement,
} from './commands'
import type { AiElementUpdate } from './commands'
import { buildAiStateSummary } from './stateSummary'
import type { AiCommandResult, AiElementSummary, AiSpreadSummary, AiStateSummary } from './types'
import { getWebMcpModelContext, type WebMcpModelContext, type WebMcpTool } from './webmcpTypes'

const aiElementUpdateSchema = z.object({
  name: z.string(),
  position: vec3Schema,
  rotation: vec3Schema,
  scale: vec3Schema,
  layer: z.number().finite(),
  visible: z.boolean(),
  opacity: z.number().finite(),
  pivot: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  width: z.number().finite().optional(),
  height: z.number().finite().optional(),
  billboard: z.boolean().optional(),
  image: z.string().nullable().optional(),
  backImage: z.string().nullable().optional(),
  backgroundColor: z.string().optional(),
  foregroundColor: z.string().optional(),
  text: z.string().optional(),
  fontSize: z.number().finite().optional(),
  font: z.enum(['rounded', 'sans', 'serif', 'mono']).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  particles: z.object({
    enabled: z.boolean().optional(),
    color: z.string(),
    count: z.number().finite(),
    size: z.number().finite(),
    drift: z.number().finite(),
    period: z.number().finite(),
  }).optional(),
  motion: z.preprocess((value) => Array.isArray(value)
    ? value.map((item) => isRecord(item) && item.type !== 'spin' && item.phase === undefined ? { ...item, phase: 0 } : item)
    : value, z.array(contentMotionSchema)).optional(),
  videoAudio: embeddedVideoAudioSchema.nullable().optional(),
  backVideoAudio: embeddedVideoAudioSchema.nullable().optional(),
})

const placeAssetSchema = z.object({
  spreadId: z.string().min(1),
  side: z.enum(['left', 'right']),
  assetId: z.string().min(1),
  presetId: z.enum(['paper-stack', 'bottom-upright', 'depth-layer']),
  u: z.number().finite(),
  v: z.number().finite(),
})

const createVisualSchema = z.object({
  spreadId: z.string().min(1),
  side: z.enum(['left', 'right']),
  presetId: z.enum(['light-particles', 'page-text']),
})

const selectTargetSchema = z.object({
  type: z.enum(['book', 'light', 'cover', 'spread', 'page', 'element']),
  id: z.string().optional(),
  spreadId: z.string().optional(),
  elementId: z.string().optional(),
  side: z.enum(['left', 'right', 'front', 'back']).optional(),
})

const previewSchema = z.object({
  progress: z.number().finite().optional(),
  spreadId: z.string().optional(),
  seconds: z.number().finite().optional(),
}).refine((input) => input.progress !== undefined || input.spreadId !== undefined, {
  message: 'progress or spreadId is required',
})

const timelineSchema = z.object({
  spreadId: z.string().min(1),
  target: timelineTargetSchema,
  property: z.string().transform((value): import('../../schema/timeline').TimelineProperty => timelinePropertySchema.parse(value)),
  time: z.number().finite(),
  value: timelineValueSchema,
})

const spreadSchema = z.object({
  operation: z.enum(['add', 'duplicate', 'move']),
  spreadId: z.string().optional(),
  direction: z.union([z.literal(-1), z.literal(1)]).optional(),
})

const pageBackgroundSchema = z.object({
  spreadId: z.string().min(1),
  side: z.enum(['left', 'right']),
  assetId: z.string().min(1),
})

const pageRefSchema = z.object({
  spreadId: z.string().min(1),
  side: z.enum(['left', 'right']),
})

const elementParentSchema = z.object({
  spreadId: z.string().min(1),
  elementId: z.string().min(1),
  parent: parentSpaceSchema,
})

const confirmedElementSchema = z.object({
  spreadId: z.string().min(1),
  elementId: z.string().min(1),
  confirm: z.literal(true),
})

const confirmedSpreadSchema = z.object({
  spreadId: z.string().min(1),
  confirm: z.literal(true),
})

const cameraPoseSchema = z.object({
  position: vec3Schema,
  target: vec3Schema,
  fov: z.number().finite(),
})

const cameraKeySchema = cameraPoseSchema.extend({
  spreadId: z.string().min(1),
  time: z.number().finite(),
})

const timelineKeyRefSchema = z.object({
  spreadId: z.string().min(1),
  trackId: z.string().min(1),
  keyId: z.string().min(1),
})

const updateTimelineKeySchema = timelineKeyRefSchema.extend({
  time: z.number().finite().optional(),
  value: timelineValueSchema.optional(),
  ease: z.enum(['linear', 'easeInOut', 'hold']).optional(),
}).refine((input) => input.time !== undefined || input.value !== undefined || input.ease !== undefined, {
  message: 'time, value, or ease is required',
})

const selectFailure = (action: string, message = t().ai.invalidInput, fieldErrors: Record<string, string> = {}): AiCommandResult => ({
  ok: false,
  action,
  message,
  fieldErrors,
})

function parseInput<T>(schema: z.ZodTypeAny, input: Record<string, unknown>, action: string): T | AiCommandResult {
  const parsed = schema.safeParse(input)
  if (parsed.success) return parsed.data
  const fieldErrors: Record<string, string> = {}
  for (const issue of parsed.error.issues) fieldErrors[issue.path.join('.') || 'input'] = t().ai.invalidInput
  return selectFailure(action, t().ai.invalidInput, fieldErrors)
}

function checkAborted(signal?: AbortSignal) {
  if (!signal || !signal.aborted) return
  throw signal.reason ?? new DOMException('WebMCP tool execution was cancelled', 'AbortError')
}

function summary(): AiStateSummary {
  return buildAiStateSummary(useBuilderStore.getState())
}

function commandResponse(result: AiCommandResult, after?: unknown) {
  const payload = after === undefined ? result : { ...result, after }
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
}

function readResponse(action: string, data: unknown) {
  return commandResponse({
    ok: true,
    action,
    message: action,
    corrections: [],
    validation: {
      errors: useBuilderStore.getState().issues.errors.length,
      warnings: useBuilderStore.getState().issues.warnings.length,
    },
  }, data)
}

function findElement(state: AiStateSummary, spreadId: string, elementId: string): AiElementSummary | undefined {
  return state.spreads.find((spread) => spread.id === spreadId)?.elements.find((element) => element.id === elementId)
}

function findSpread(state: AiStateSummary, spreadId: string): AiSpreadSummary | undefined {
  return state.spreads.find((spread) => spread.id === spreadId)
}

function afterForCommand(result: AiCommandResult): unknown {
  if (!result.ok) return undefined
  const state = summary()
  if (result.target?.kind === 'element') {
    for (const spread of state.spreads) {
      const element = spread.elements.find((item) => item.id === result.target?.id)
      if (element) return element
    }
  }
  if (result.target?.kind === 'spread') return findSpread(state, result.target.id)
  if (result.target?.kind === 'page') {
    const separator = result.target.id.lastIndexOf(':')
    const spreadId = result.target.id.slice(0, separator)
    const side = result.target.id.slice(separator + 1)
    const spread = findSpread(state, spreadId)
    return side === 'left' ? spread?.leftPage : side === 'right' ? spread?.rightPage : undefined
  }
  if (result.target?.kind === 'camera') return state.book.camera
  if (result.target?.kind === 'bgm') {
    return { audio: state.audio, asset: state.assets.find((asset) => asset.id === result.target?.id) }
  }
  if (result.action === 'clear-bgm') return { audio: state.audio }
  return {
    selection: state.selection,
    activeSpread: state.activeSpread,
    previewProgress: state.previewProgress,
    spreadTime: state.spreadTime,
  }
}

function resultFromCommand(result: AiCommandResult) {
  return commandResponse(result, afterForCommand(result))
}

function targetToSelection(input: z.infer<typeof selectTargetSchema>): Parameters<ReturnType<typeof useBuilderStore.getState>['select']>[0] | AiCommandResult {
  if (input.type === 'book') return { type: 'book' }
  if (input.type === 'light') return { type: 'light' }
  if (input.type === 'cover') {
    const side = input.side ?? input.id
    if (side !== 'front' && side !== 'back') return selectFailure('select-target', t().ai.invalidInput, { side: t().ai.invalidInput })
    return { type: 'cover', side }
  }
  const spreadId = input.spreadId ?? (input.type === 'spread' ? input.id : undefined)
  if (!spreadId) return selectFailure('select-target', t().ai.invalidInput, { spreadId: t().ai.notFound })
  if (input.type === 'spread') return { type: 'spread', spreadId }
  if (input.type === 'page') {
    if (input.side !== 'left' && input.side !== 'right') return selectFailure('select-target', t().ai.invalidInput, { side: t().ai.invalidInput })
    return { type: 'page', spreadId, side: input.side }
  }
  const elementId = input.elementId ?? input.id
  if (!elementId) return selectFailure('select-target', t().ai.invalidInput, { elementId: t().ai.notFound })
  return { type: 'element', spreadId, elementId }
}

function makeTools(): WebMcpTool[] {
  return [
    {
      name: 'tobidas-get-state',
      title: 'Get tobidas state',
      description: 'Read the current tobidas project state without asset binary data. Use this first to obtain stable spread and element IDs; scope defaults to full and can be active-spread or selection.',
      inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['full', 'active-spread', 'selection'], description: 'Return the full project, the active spread, or the current selection. Defaults to full.' } } },
      annotations: { readOnlyHint: true },
      execute: async (input, options) => {
        checkAborted(options?.signal)
        const state = summary()
        const scope = input.scope === 'active-spread' || input.scope === 'selection' ? input.scope : 'full'
        if (scope === 'active-spread') return readResponse('get-state', { scope, state: state.activeSpread ? findSpread(state, state.activeSpread.id) : undefined })
        if (scope === 'selection') {
          const selected = state.selectedElement ?? state.selection
          return readResponse('get-state', { scope, selection: state.selection, selected })
        }
        return readResponse('get-state', state)
      },
    },
    {
      name: 'tobidas-get-spread',
      title: 'Get tobidas spread',
      description: 'Read one spread including its pages, elements, and timeline. Pass a spreadId returned by tobidas-get-state.',
      inputSchema: { type: 'object', properties: { spreadId: { type: 'string', description: 'Stable ID of an existing spread.' } }, required: ['spreadId'] },
      annotations: { readOnlyHint: true },
      execute: async (input, options) => {
        checkAborted(options?.signal)
        const spreadId = typeof input.spreadId === 'string' ? input.spreadId : ''
        const state = summary()
        const spread = findSpread(state, spreadId)
        return spread ? readResponse('get-spread', spread) : commandResponse(selectFailure('get-spread', t().ai.notFound, { spreadId: t().ai.notFound }))
      },
    },
    {
      name: 'tobidas-get-element',
      title: 'Get tobidas element',
      description: 'Read one element using its stable spread and element IDs. Pass IDs returned by tobidas-get-state or tobidas-get-spread.',
      inputSchema: { type: 'object', properties: { spreadId: { type: 'string', description: 'Stable ID of the spread containing the element.' }, elementId: { type: 'string', description: 'Stable ID of the element to read.' } }, required: ['spreadId', 'elementId'] },
      annotations: { readOnlyHint: true },
      execute: async (input, options) => {
        checkAborted(options?.signal)
        const spreadId = typeof input.spreadId === 'string' ? input.spreadId : ''
        const elementId = typeof input.elementId === 'string' ? input.elementId : ''
        const element = findElement(summary(), spreadId, elementId)
        return element ? readResponse('get-element', element) : commandResponse(selectFailure('get-element', t().ai.notFound, { elementId: t().ai.notFound }))
      },
    },
    {
      name: 'tobidas-list-assets',
      title: 'List tobidas assets',
      description: 'List imported asset metadata and references for later placement or BGM assignment; never returns binary asset data or uploads files.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: async (_input, options) => {
        checkAborted(options?.signal)
        const state = summary()
        return readResponse('list-assets', state.assets)
      },
    },
    {
      name: 'tobidas-validate-book',
      title: 'Validate tobidas book',
      description: 'Read the latest tobidas validation errors and warnings. An optional spreadId limits the returned spread context.',
      inputSchema: { type: 'object', properties: { spreadId: { type: 'string', description: 'Optional stable ID of a spread whose context should be returned.' } } },
      annotations: { readOnlyHint: true },
      execute: async (input, options) => {
        checkAborted(options?.signal)
        const state = summary()
        const requestedSpreadId = typeof input.spreadId === 'string' ? input.spreadId : undefined
        const spread = requestedSpreadId ? findSpread(state, requestedSpreadId) : undefined
        if (requestedSpreadId && !spread) return commandResponse(selectFailure('validate-book', t().ai.notFound, { spreadId: t().ai.notFound }))
        return readResponse('validate-book', { validation: state.validation, spread })
      },
    },
    {
      name: 'tobidas-audit-layout',
      title: 'Audit tobidas layout',
      description: 'Run deterministic paper-containment and stow-layout checks for one spread or the whole book. Returns page overflow, stow warnings, airborne-part budget warnings, and page-background assignments. This structural audit complements, but does not replace, a visual screenshot review.',
      inputSchema: { type: 'object', properties: { spreadId: { type: 'string', description: 'Optional stable spread ID. Omit it to audit the whole book.' } } },
      annotations: { readOnlyHint: true },
      execute: async (input, options) => {
        checkAborted(options?.signal)
        const state = useBuilderStore.getState()
        const spreadId = typeof input.spreadId === 'string' ? input.spreadId : undefined
        const spread = spreadId ? state.project.book.spreads.find((item) => item.id === spreadId) : undefined
        if (spreadId && !spread) return commandResponse(selectFailure('audit-layout', t().ai.notFound, { spreadId: t().ai.notFound }))
        const report = spread ? analyzeSpreadContainment(state.project.book, spread) : analyzeBookContainment(state.project.book)
        const spreads = (spread ? [spread] : state.project.book.spreads).map((item) => ({
          spreadId: item.id,
          name: item.name,
          pages: {
            left: { backgroundAsset: item.leftPage.backgroundAsset },
            right: { backgroundAsset: item.rightPage.backgroundAsset },
          },
          elementCount: item.elements.length,
        }))
        return readResponse('audit-layout', { report, spreads, visualReviewRequired: true })
      },
    },
    {
      name: 'tobidas-select-target',
      title: 'Select tobidas target',
      description: 'Select a book, light, cover, spread, page, or element for human-visible supervision. Use the corresponding ID fields for spread, page, and element targets.',
      inputSchema: { type: 'object', properties: {
        type: { type: 'string', enum: ['book', 'light', 'cover', 'spread', 'page', 'element'], description: 'Target kind. Use book or light without an ID, cover with front/back, or spread/page/element with the corresponding ID fields.' },
        id: { type: 'string', description: 'Target ID; for a cover target this may be front or back.' },
        spreadId: { type: 'string', description: 'Stable ID of the spread for spread, page, or element targets.' },
        elementId: { type: 'string', description: 'Stable ID of the element for an element target.' },
        side: { type: 'string', enum: ['left', 'right', 'front', 'back'], description: 'Page side for a page target, or cover side for a cover target.' },
      }, required: ['type'] },
      execute: async (input, options) => {
        checkAborted(options?.signal)
        const parsed = parseInput<z.infer<typeof selectTargetSchema>>(selectTargetSchema, input, 'select-target')
        if (!isCommandResult(parsed)) {
          const selection = targetToSelection(parsed)
          if (isCommandResult(selection)) return commandResponse(selection)
          const state = useBuilderStore.getState()
          if (selection.type === 'spread' && !state.project.book.spreads.some((spread) => spread.id === selection.spreadId)) {
            return commandResponse(selectFailure('select-target', t().ai.notFound, { spreadId: t().ai.notFound }))
          }
          if (selection.type === 'element') {
            const spread = state.project.book.spreads.find((item) => item.id === selection.spreadId)
            if (!spread?.elements.some((element) => element.id === selection.elementId)) return commandResponse(selectFailure('select-target', t().ai.notFound, { elementId: t().ai.notFound }))
          }
          if (selection.type === 'page' && !state.project.book.spreads.some((spread) => spread.id === selection.spreadId)) {
            return commandResponse(selectFailure('select-target', t().ai.notFound, { spreadId: t().ai.notFound }))
          }
          state.select(selection)
          return readResponse('select-target', { selection: summary().selection })
        }
        return commandResponse(parsed)
      },
    },
    {
      name: 'tobidas-set-preview',
      title: 'Set tobidas preview',
      description: 'Move the visible preview to a normalized book progress or a spread hold time. Provide progress, or provide spreadId with seconds within that spread hold interval.',
      inputSchema: { type: 'object', properties: { progress: { type: 'number', minimum: 0, maximum: 1, description: 'Whole-book progress from 0 to 1.' }, spreadId: { type: 'string', description: 'Stable ID of the spread whose hold time should be previewed.' }, seconds: { type: 'number', minimum: 0, description: 'Seconds from the start of the selected spread hold interval.' } } },
      execute: async (input, options) => {
        checkAborted(options?.signal)
        const parsed = parseInput<z.infer<typeof previewSchema>>(previewSchema, input, 'set-preview')
        if (isCommandResult(parsed)) return commandResponse(parsed)
        const state = useBuilderStore.getState()
        if (parsed.progress !== undefined) {
          if (parsed.progress < 0 || parsed.progress > 1) return commandResponse(selectFailure('set-preview', t().ai.invalidInput, { progress: t().ai.normalizedRange }))
          state.setPreviewProgress(parsed.progress)
        } else {
          const spread = state.project.book.spreads.find((item) => item.id === parsed.spreadId)
          if (!spread) return commandResponse(selectFailure('set-preview', t().ai.notFound, { spreadId: t().ai.notFound }))
          if (parsed.seconds === undefined || parsed.seconds < 0 || parsed.seconds > spread.sequence.holdSeconds) {
            return commandResponse(selectFailure('set-preview', t().ai.timelineTimeRange, { seconds: t().ai.timelineTimeRange }))
          }
          state.setSpreadTime(spread.id, parsed.seconds)
        }
        return readResponse('set-preview', { mode: summary().mode, previewProgress: summary().previewProgress, spreadTime: summary().spreadTime })
      },
    },
    {
      name: 'tobidas-enter-play', title: 'Enter tobidas play mode',
      description: 'Enter playback mode so the person can inspect the book. This changes only the visible editing session.', inputSchema: { type: 'object', properties: {} },
      execute: async (_input, options) => { checkAborted(options?.signal); useBuilderStore.getState().setMode('play'); return readResponse('enter-play', { mode: summary().mode }) },
    },
    {
      name: 'tobidas-enter-edit', title: 'Enter tobidas edit mode',
      description: 'Return to edit mode so structured book changes can be made. This changes only the visible editing session.', inputSchema: { type: 'object', properties: {} },
      execute: async (_input, options) => { checkAborted(options?.signal); useBuilderStore.getState().setMode('edit'); return readResponse('enter-edit', { mode: summary().mode }) },
    },
    {
      name: 'tobidas-place-asset', title: 'Place tobidas asset',
      description: 'Place an already imported image, SVG, or video with a tobidas visual preset and normalized page coordinates. The asset must already be imported through the AI-mode file input; placement is committed through normal validation and undo history.',
      inputSchema: { type: 'object', properties: {
        spreadId: { type: 'string', description: 'Stable ID of the spread receiving the asset.' },
        side: { type: 'string', enum: ['left', 'right'], description: 'Page side where the asset is placed.' },
        assetId: { type: 'string', description: 'ID of an already imported image, SVG, or video asset.' },
        presetId: { type: 'string', enum: ['paper-stack', 'bottom-upright', 'depth-layer'], description: 'Placement preset controlling the initial visual type and pose.' },
        u: { type: 'number', minimum: 0, maximum: 1, description: 'Normalized horizontal page coordinate from 0 at the spine to 1 at the outer edge.' },
        v: { type: 'number', minimum: 0, maximum: 1, description: 'Normalized vertical page coordinate from 0 at the back to 1 at the front.' },
      }, required: ['spreadId', 'side', 'assetId', 'presetId', 'u', 'v'] },
      execute: async (input, options) => { checkAborted(options?.signal); const parsed = parseInput<z.infer<typeof placeAssetSchema>>(placeAssetSchema, input, 'place-asset'); return isCommandResult(parsed) ? commandResponse(parsed) : resultFromCommand(placeAiAsset(parsed)) },
    },
    {
      name: 'tobidas-set-page-background', title: 'Set tobidas page background',
      description: 'Assign an already imported image, SVG, or video directly to one page surface. Use this for full-page artwork instead of creating a flat paper-stack element. The page surface fills the whole page without element placement coordinates.',
      inputSchema: { type: 'object', properties: {
        spreadId: { type: 'string', description: 'Stable ID of the spread containing the page.' },
        side: { type: 'string', enum: ['left', 'right'], description: 'Page side receiving the background.' },
        assetId: { type: 'string', description: 'ID of an already imported image, SVG, or video asset.' },
      }, required: ['spreadId', 'side', 'assetId'] },
      execute: async (input, options) => { checkAborted(options?.signal); const parsed = parseInput<z.infer<typeof pageBackgroundSchema>>(pageBackgroundSchema, input, 'set-page-background'); return isCommandResult(parsed) ? commandResponse(parsed) : resultFromCommand(setAiPageBackground(parsed.spreadId, parsed.side, parsed.assetId)) },
    },
    {
      name: 'tobidas-clear-page-background', title: 'Clear tobidas page background',
      description: 'Remove the assigned page-surface artwork and its video-audio settings from one page through the normal undo path.',
      inputSchema: { type: 'object', properties: {
        spreadId: { type: 'string', description: 'Stable ID of the spread containing the page.' },
        side: { type: 'string', enum: ['left', 'right'], description: 'Page side whose background is cleared.' },
      }, required: ['spreadId', 'side'] },
      execute: async (input, options) => { checkAborted(options?.signal); const parsed = parseInput<z.infer<typeof pageRefSchema>>(pageRefSchema, input, 'clear-page-background'); return isCommandResult(parsed) ? commandResponse(parsed) : resultFromCommand(clearAiPageBackground(parsed.spreadId, parsed.side)) },
    },
    {
      name: 'tobidas-create-visual', title: 'Create tobidas visual',
      description: 'Create a text visual or an independent light-particle part using an existing tobidas preset. A particle part has no image or text and is committed through normal layout validation and undo history.',
      inputSchema: { type: 'object', properties: { spreadId: { type: 'string', description: 'Stable ID of the spread receiving the new part.' }, side: { type: 'string', enum: ['left', 'right'], description: 'Page side where the new part is created.' }, presetId: { type: 'string', enum: ['light-particles', 'page-text'], description: 'Preset: page-text creates a text visual, and light-particles creates an independent particle part without image or text.' } }, required: ['spreadId', 'side', 'presetId'] },
      execute: async (input, options) => { checkAborted(options?.signal); const parsed = parseInput<z.infer<typeof createVisualSchema>>(createVisualSchema, input, 'create-visual'); return isCommandResult(parsed) ? commandResponse(parsed) : resultFromCommand(createAiVisual(parsed)) },
    },
    {
      name: 'tobidas-update-element', title: 'Update tobidas element',
      description: 'Update one tobidas element through layout normalization and validation. The input is a full typed update, not an arbitrary JSON patch; omitted fields keep their current values.',
      inputSchema: { type: 'object', properties: {
        spreadId: { type: 'string', description: 'Stable ID of the spread containing the element.' },
        elementId: { type: 'string', description: 'Stable ID of the element to update.' },
        input: { type: 'object', description: 'Typed element fields such as name, position, rotation, scale, layer, visibility, opacity, dimensions, camera-facing, text, colors, particle settings, motion, or video audio. For a particle part, provide only its dimensions, camera-facing setting, and particle settings; do not pass image or text fields. Do not pass arbitrary project JSON.' },
      }, required: ['spreadId', 'elementId', 'input'] },
      execute: async (input, options) => {
        checkAborted(options?.signal)
        const spreadId = typeof input.spreadId === 'string' ? input.spreadId : ''
        const elementId = typeof input.elementId === 'string' ? input.elementId : ''
        const parsed = parseInput<AiElementUpdate>(aiElementUpdateSchema, isRecord(input.input) ? input.input : {}, 'update-element')
        return isCommandResult(parsed) ? commandResponse(parsed) : resultFromCommand(updateAiElement(spreadId, elementId, parsed))
      },
    },
    {
      name: 'tobidas-move-element', title: 'Move tobidas element',
      description: 'Reparent one tobidas element to a page or another element while preserving normal constraints. The move is committed through the common edit, validation, and undo path.',
      inputSchema: { type: 'object', properties: { spreadId: { type: 'string', description: 'Stable ID of the spread containing the element.' }, elementId: { type: 'string', description: 'Stable ID of the element to move.' }, parent: { type: 'object', description: 'Typed page or element parent reference accepted by tobidas; use the existing parent schema rather than arbitrary JSON.' } }, required: ['spreadId', 'elementId', 'parent'] },
      execute: async (input, options) => {
        checkAborted(options?.signal)
        const spreadId = typeof input.spreadId === 'string' ? input.spreadId : ''
        const elementId = typeof input.elementId === 'string' ? input.elementId : ''
        const parsed = parseInput<ParentSpace>(parentSpaceSchema, isRecord(input.parent) ? input.parent : {}, 'move-element')
        return isCommandResult(parsed) ? commandResponse(parsed) : resultFromCommand(moveAiElement(spreadId, elementId, parsed))
      },
    },
    {
      name: 'tobidas-set-element-parent', title: 'Set tobidas element parent',
      description: 'Explicit parent-changing alias for tobidas-move-element. Attach an element to the left page, right page, or another element while preserving layout constraints and undo history.',
      inputSchema: { type: 'object', properties: {
        spreadId: { type: 'string', description: 'Stable ID of the spread containing the element.' },
        elementId: { type: 'string', description: 'Stable ID of the element whose parent changes.' },
        parent: { type: 'object', description: 'Typed page or element parent reference.' },
      }, required: ['spreadId', 'elementId', 'parent'] },
      execute: async (input, options) => { checkAborted(options?.signal); const parsed = parseInput<z.infer<typeof elementParentSchema>>(elementParentSchema, input, 'set-element-parent'); return isCommandResult(parsed) ? commandResponse(parsed) : resultFromCommand(moveAiElement(parsed.spreadId, parsed.elementId, parsed.parent)) },
    },
    {
      name: 'tobidas-delete-element', title: 'Delete tobidas element',
      description: 'Delete one element, all of its descendants, and their timeline tracks through normal undo history. Pass confirm=true after inspecting the target with tobidas-get-element.',
      inputSchema: { type: 'object', properties: {
        spreadId: { type: 'string', description: 'Stable ID of the spread containing the element.' },
        elementId: { type: 'string', description: 'Stable ID of the element to delete.' },
        confirm: { type: 'boolean', description: 'Must be true to acknowledge descendant and timeline-track deletion.' },
      }, required: ['spreadId', 'elementId', 'confirm'] },
      execute: async (input, options) => { checkAborted(options?.signal); const parsed = parseInput<z.infer<typeof confirmedElementSchema>>(confirmedElementSchema, input, 'delete-element'); return isCommandResult(parsed) ? commandResponse(parsed) : resultFromCommand(deleteAiElement(parsed.spreadId, parsed.elementId)) },
    },
    {
      name: 'tobidas-add-timeline-key', title: 'Add tobidas timeline key',
      description: 'Add or replace one typed timeline key in a spread hold interval. The time and value are validated against the selected target property.',
      inputSchema: { type: 'object', properties: { spreadId: { type: 'string', description: 'Stable ID of the spread whose hold timeline is edited.' }, target: { type: 'object', description: 'Typed target reference for the element, background, light, or camera track.' }, property: { type: 'string', description: 'Timeline property supported by the selected target.' }, time: { type: 'number', description: 'Time in seconds within the spread hold interval.' }, value: { description: 'Typed value matching the selected timeline property.' } }, required: ['spreadId', 'target', 'property', 'time', 'value'] },
      execute: async (input, options) => { checkAborted(options?.signal); const parsed = parseInput<z.infer<typeof timelineSchema>>(timelineSchema, input, 'add-timeline-key'); return isCommandResult(parsed) ? commandResponse(parsed) : resultFromCommand(addAiTimelineKey(parsed)) },
    },
    {
      name: 'tobidas-list-timeline-keys', title: 'List tobidas timeline keys',
      description: 'List the typed tracks and stable track/key IDs for one spread before updating or deleting keys.',
      inputSchema: { type: 'object', properties: { spreadId: { type: 'string', description: 'Stable ID of the spread whose timeline is read.' } }, required: ['spreadId'] },
      annotations: { readOnlyHint: true },
      execute: async (input, options) => {
        checkAborted(options?.signal)
        const spreadId = typeof input.spreadId === 'string' ? input.spreadId : ''
        const spread = findSpread(summary(), spreadId)
        return spread ? readResponse('list-timeline-keys', spread.timeline) : commandResponse(selectFailure('list-timeline-keys', t().ai.notFound, { spreadId: t().ai.notFound }))
      },
    },
    {
      name: 'tobidas-update-timeline-key', title: 'Update tobidas timeline key',
      description: 'Update the time, typed value, or easing of one existing timeline key. Obtain stable trackId and keyId values from tobidas-list-timeline-keys.',
      inputSchema: { type: 'object', properties: {
        spreadId: { type: 'string' }, trackId: { type: 'string' }, keyId: { type: 'string' },
        time: { type: 'number', description: 'Optional replacement time within the spread hold interval.' },
        value: { description: 'Optional typed replacement value matching the track property.' },
        ease: { type: 'string', enum: ['linear', 'easeInOut', 'hold'], description: 'Optional replacement easing.' },
      }, required: ['spreadId', 'trackId', 'keyId'] },
      execute: async (input, options) => { checkAborted(options?.signal); const parsed = parseInput<z.infer<typeof updateTimelineKeySchema>>(updateTimelineKeySchema, input, 'update-timeline-key'); return isCommandResult(parsed) ? commandResponse(parsed) : resultFromCommand(updateAiTimelineKey(parsed)) },
    },
    {
      name: 'tobidas-delete-timeline-key', title: 'Delete tobidas timeline key',
      description: 'Delete one existing timeline key. If it is the last key, its empty track is removed as well.',
      inputSchema: { type: 'object', properties: { spreadId: { type: 'string' }, trackId: { type: 'string' }, keyId: { type: 'string' } }, required: ['spreadId', 'trackId', 'keyId'] },
      execute: async (input, options) => { checkAborted(options?.signal); const parsed = parseInput<z.infer<typeof timelineKeyRefSchema>>(timelineKeyRefSchema, input, 'delete-timeline-key'); return isCommandResult(parsed) ? commandResponse(parsed) : resultFromCommand(deleteAiTimelineKey(parsed.spreadId, parsed.trackId, parsed.keyId)) },
    },
    {
      name: 'tobidas-set-camera', title: 'Set tobidas default camera',
      description: 'Set the project default author camera position, target, and field of view. Spreads without camera timeline keys use this pose.',
      inputSchema: { type: 'object', properties: { position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, target: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, fov: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 180 } }, required: ['position', 'target', 'fov'] },
      execute: async (input, options) => { checkAborted(options?.signal); const parsed = parseInput<z.infer<typeof cameraPoseSchema>>(cameraPoseSchema, input, 'set-camera'); return isCommandResult(parsed) ? commandResponse(parsed) : resultFromCommand(setAiCamera(parsed)) },
    },
    {
      name: 'tobidas-add-camera-key', title: 'Add tobidas camera key',
      description: 'Save a complete camera pose at one spread hold time by updating the position, target, and fov camera tracks together.',
      inputSchema: { type: 'object', properties: { spreadId: { type: 'string' }, time: { type: 'number' }, position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, target: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, fov: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 180 } }, required: ['spreadId', 'time', 'position', 'target', 'fov'] },
      execute: async (input, options) => { checkAborted(options?.signal); const parsed = parseInput<z.infer<typeof cameraKeySchema>>(cameraKeySchema, input, 'add-camera-key'); return isCommandResult(parsed) ? commandResponse(parsed) : resultFromCommand(addAiCameraKey(parsed)) },
    },
    {
      name: 'tobidas-assign-bgm', title: 'Assign tobidas BGM',
      description: 'Assign one already imported audio asset as the project BGM. The audio must be imported through the AI-mode file input before this tool is called.',
      inputSchema: { type: 'object', properties: { assetId: { type: 'string', description: 'ID of an already imported audio asset.' } }, required: ['assetId'] },
      execute: async (input, options) => { checkAborted(options?.signal); const assetId = typeof input.assetId === 'string' ? input.assetId : ''; return resultFromCommand(assignAiBgm(assetId)) },
    },
    {
      name: 'tobidas-clear-bgm', title: 'Clear tobidas BGM',
      description: 'Clear the project BGM through the normal edit, validation, and undo path.', inputSchema: { type: 'object', properties: {} },
      execute: async (_input, options) => { checkAborted(options?.signal); return resultFromCommand(clearAiBgm()) },
    },
    {
      name: 'tobidas-add-spread', title: 'Change tobidas spreads',
      description: 'Add, duplicate, or move a spread through the normal edit and undo path. Explicit duplicate and reorder tools are also registered for easier discovery.',
      inputSchema: { type: 'object', properties: { operation: { type: 'string', enum: ['add', 'duplicate', 'move'], description: 'Spread operation: add a new spread, duplicate an existing spread, or move an existing spread.' }, spreadId: { type: 'string', description: 'Stable ID of the spread to duplicate or move.' }, direction: { type: 'number', enum: [-1, 1], description: 'For move, use -1 to move earlier or 1 to move later.' } }, required: ['operation'] },
      execute: async (input, options) => {
        checkAborted(options?.signal)
        const parsed = parseInput<z.infer<typeof spreadSchema>>(spreadSchema, input, 'add-spread')
        if (isCommandResult(parsed)) return commandResponse(parsed)
        if (parsed.operation === 'add') return resultFromCommand(addAiSpread())
        if (!parsed.spreadId) return commandResponse(selectFailure('add-spread', t().ai.invalidInput, { spreadId: t().ai.notFound }))
        if (parsed.operation === 'duplicate') return resultFromCommand(duplicateAiSpread(parsed.spreadId))
        if (parsed.direction !== -1 && parsed.direction !== 1) return commandResponse(selectFailure('add-spread', t().ai.invalidInput, { direction: t().ai.invalidInput }))
        return resultFromCommand(moveAiSpread(parsed.spreadId, parsed.direction))
      },
    },
    {
      name: 'tobidas-duplicate-spread', title: 'Duplicate tobidas spread',
      description: 'Duplicate one spread, remapping element, track, and key IDs, then select the copy.',
      inputSchema: { type: 'object', properties: { spreadId: { type: 'string' } }, required: ['spreadId'] },
      execute: async (input, options) => { checkAborted(options?.signal); return resultFromCommand(duplicateAiSpread(typeof input.spreadId === 'string' ? input.spreadId : '')) },
    },
    {
      name: 'tobidas-reorder-spread', title: 'Reorder tobidas spread',
      description: 'Move one spread one position earlier or later through the normal undo path.',
      inputSchema: { type: 'object', properties: { spreadId: { type: 'string' }, direction: { type: 'number', enum: [-1, 1], description: '-1 moves earlier; 1 moves later.' } }, required: ['spreadId', 'direction'] },
      execute: async (input, options) => {
        checkAborted(options?.signal)
        const spreadId = typeof input.spreadId === 'string' ? input.spreadId : ''
        const direction = input.direction === -1 || input.direction === 1 ? input.direction : undefined
        return direction ? resultFromCommand(moveAiSpread(spreadId, direction)) : commandResponse(selectFailure('reorder-spread', t().ai.invalidInput, { direction: t().ai.invalidInput }))
      },
    },
    {
      name: 'tobidas-delete-spread', title: 'Delete tobidas spread',
      description: 'Delete one spread and its elements and timeline. At least one spread remains. Pass confirm=true after inspecting the spread.',
      inputSchema: { type: 'object', properties: { spreadId: { type: 'string' }, confirm: { type: 'boolean', description: 'Must be true to acknowledge deletion of all spread content.' } }, required: ['spreadId', 'confirm'] },
      execute: async (input, options) => { checkAborted(options?.signal); const parsed = parseInput<z.infer<typeof confirmedSpreadSchema>>(confirmedSpreadSchema, input, 'delete-spread'); return isCommandResult(parsed) ? commandResponse(parsed) : resultFromCommand(deleteAiSpread(parsed.spreadId)) },
    },
    {
      name: 'tobidas-undo', title: 'Undo tobidas edit', description: 'Undo the last tobidas edit through the normal history. The result includes the current selection and preview state after undo.', inputSchema: { type: 'object', properties: {} },
      execute: async (_input, options) => { checkAborted(options?.signal); return resultFromCommand(undoAi()) },
    },
    {
      name: 'tobidas-redo', title: 'Redo tobidas edit', description: 'Redo the last undone tobidas edit through the normal history. The result includes the current selection and preview state after redo.', inputSchema: { type: 'object', properties: {} },
      execute: async (_input, options) => { checkAborted(options?.signal); return resultFromCommand(redoAi()) },
    },
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCommandResult(value: unknown): value is AiCommandResult {
  return isRecord(value) && typeof value.ok === 'boolean' && typeof value.action === 'string'
}

export function createTobidasWebMcpTools(): WebMcpTool[] {
  return makeTools()
}

export async function registerTobidasWebMcpTools(
  context: WebMcpModelContext | null,
  signal: AbortSignal,
): Promise<boolean> {
  if (!context) return false
  for (const tool of makeTools()) {
    checkAborted(signal)
    await context.registerTool(tool, { signal })
  }
  return true
}

/** アプリ起動中はWebMCPを有効にする。非対応環境では何もしない。 */
export function AiWebMcpBridge() {
  useEffect(() => {
    const controller = new AbortController()
    void registerTobidasWebMcpTools(getWebMcpModelContext(), controller.signal).catch(() => {
      // API未実装、権限ポリシー拒否、登録競合のいずれでもDOM経路を使い続ける。
      controller.abort()
    })
    return () => controller.abort()
  }, [])
  return null
}
