import { z } from 'zod'
import { connectedContentSchema, partContentSchema, type ConnectedContent } from '../../schema/content'
import { createStageElement } from '../../schema/bookDefaults'
import { validateBookProject } from '../../schema/bookValidate'
import { contentAsStage } from '../../parts/contents'
import { replanAutomaticSupports, designAutomaticDefinitionSupports } from '../../parts/supportPlanning'
import { contentEditIntentSchema, planContentEdit } from '../../parts/contentEdit'
import { paperShapeSchema } from '../../parts/shape'
import { validatePartDefinition } from '../../parts/validate'
import { useBuilderStore } from '../store'
import { usePartEditorStore } from './store'
import { publishOperationResult } from '../operations/result'
import type { BuilderCommandResult } from '../operations/types'
import { t } from '../i18n'

const done = (action: string, id: string): BuilderCommandResult => publishOperationResult({ ok: true, action,
  message: t().parts.operationDone, target: { kind: 'element', id }, corrections: [], validation: { errors: 0, warnings: 0 } })
const fail = (action: string, error: unknown): BuilderCommandResult => publishOperationResult({ ok: false, action,
  message: error instanceof Error ? error.message : String(error), fieldErrors: {} })
export const placeContentSchema = z.object({ spreadId: z.string(), element: connectedContentSchema }).strict()
export function placeContentCommand(value: z.input<typeof placeContentSchema>): BuilderCommandResult {
  try {
    const parsed = placeContentSchema.parse(value), state = useBuilderStore.getState()
    if (state.mode !== 'edit') throw new Error(t().operations.readOnly)
    const candidate = structuredClone(state.project), spread = candidate.book.spreads.find((item) => item.id === parsed.spreadId)
    if (!spread || spread.elements.some((item) => item.id === parsed.element.id)) throw new Error('Spread missing or content ID already exists')
    const element = contentAsStage(parsed.element); spread.elements.push(element)
    replanAutomaticSupports(candidate, spread, { preserveConnections: true, floatingIds: new Set([element.id]) })
    const validation = validateBookProject(candidate); if (!validation.ok) throw new Error(validation.errors[0])
    state.commit((project) => { const target = project.book.spreads.find(item => item.id === spread.id)!; target.elements = spread.elements; target.timeline.tracks = spread.timeline.tracks })
    state.select({ type: 'element', spreadId: spread.id, elementId: element.id })
    return done('place-content', element.id)
  } catch (error) { return fail('place-content', error) }
}
export const editConnectedContentSchema = z.object({ spreadId: z.string(), elementId: z.string(), intent: contentEditIntentSchema }).strict()
export function editConnectedContentCommand(value: z.input<typeof editConnectedContentSchema>): BuilderCommandResult {
  try {
    const parsed = editConnectedContentSchema.parse(value), state = useBuilderStore.getState()
    if (state.mode !== 'edit') throw new Error(t().operations.readOnly)
    const next = planContentEdit(state.project, parsed.spreadId, parsed.elementId, parsed.intent)
    state.commit((project) => { const target = project.book.spreads.find(item => item.id === parsed.spreadId)!; const source = next.book.spreads.find(item => item.id === parsed.spreadId)!; target.elements = source.elements; target.timeline.tracks = source.timeline.tracks })
    return done('edit-connected-content', parsed.elementId)
  } catch (error) { return fail('edit-connected-content', error) }
}
export const upsertPartContentSchema = z.object({ content: partContentSchema }).strict()
export function upsertPartContentCommand(value: z.input<typeof upsertPartContentSchema>): BuilderCommandResult {
  try {
    const { content } = upsertPartContentSchema.parse(value), store = usePartEditorStore.getState()
    const candidate = structuredClone(store.bundle)
    candidate.definition.schemaVersion = 2
    candidate.definition.contents = [...candidate.definition.contents?.filter((item) => item.element.id !== content.element.id) ?? [], content]
    designAutomaticDefinitionSupports(candidate.definition, candidate.definitions)
    const validation = validatePartDefinition(candidate.definition, candidate.definitions)
    if (!validation.ok) throw new Error(validation.errors[0])
    store.change((bundle) => { bundle.definition = candidate.definition })
    return done('upsert-part-content', content.element.id)
  } catch (error) { return fail('upsert-part-content', error) }
}
export function deletePartContentCommand(id: string): BuilderCommandResult {
  try {
    usePartEditorStore.getState().change((bundle) => {
      const removed = new Set([id]); let more = true
      while (more) { more = false; for (const { element } of bundle.definition.contents ?? []) if (element.attachment.type === 'visual' && removed.has(element.attachment.elementId) && !removed.has(element.id)) { removed.add(element.id); more = true } }
      bundle.definition.contents = bundle.definition.contents?.filter((item) => !removed.has(item.element.id))
    })
    return done('delete-part-content', id)
  } catch (error) { return fail('delete-part-content', error) }
}
export const setPartShapeSchema = z.object({ nodeId: z.string(), faceId: z.string(), shape: paperShapeSchema.nullable() }).strict()
export function setPartShapeCommand(value: z.input<typeof setPartShapeSchema>): BuilderCommandResult {
  try {
    const { nodeId, faceId, shape } = setPartShapeSchema.parse(value), store = usePartEditorStore.getState(), candidate = structuredClone(store.bundle)
    const node = candidate.definition.nodes.find((item) => item.id === nodeId)
    if (!node) throw new Error('Material node not found')
    candidate.definition.schemaVersion = 2; node.shapes = { ...node.shapes }
    if (shape) node.shapes[faceId] = shape; else delete node.shapes[faceId]
    designAutomaticDefinitionSupports(candidate.definition, candidate.definitions)
    const validation = validatePartDefinition(candidate.definition, candidate.definitions)
    if (!validation.ok) throw new Error(validation.errors[0])
    store.change((bundle) => { bundle.definition = candidate.definition })
    return done('set-part-shape', nodeId)
  } catch (error) { return fail('set-part-shape', error) }
}
export function newConnectedContent(kind: 'decal' | 'fiction' | 'particle', attachment: ConnectedContent['attachment']): ConnectedContent {
  const element = createStageElement(kind === 'particle' ? 'particle' : 'visual')
  return connectedContentSchema.parse({ ...element, name: t().parts.content[kind], attachment,
    presentation: kind === 'decal' ? { kind } : { kind: 'fiction', closing: 'shrink-to-anchor' },
    baseTransform: { position: [0, 0, kind === 'decal' ? 0 : .02], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ...(element.type === 'visual' ? { backgroundColor: kind === 'decal' ? '#fff8df' : '#799fca', text: kind === 'decal' ? t().parts.text : '' } : {}) })
}
