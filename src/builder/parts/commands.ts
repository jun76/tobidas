import { z } from 'zod'
import type { BookProject } from '../../schema/bookPackage'
import { createStageElement } from '../../schema/bookDefaults'
import type { PartElement } from '../../schema/stageElement'
import { builtinPart } from '../../parts/catalog'
import { dependentPartIds } from '../../parts/evaluate'
import { validateBookParts, spreadPartNodes } from '../../parts/book'
import { bindingDependencies, newPartDefinition, partBindingSchema, partInputSchema, partInstanceSchema, partMaterialSchema,
  partNodeSchema, partParameterSchema, partReferenceSchema, type PartBinding, type PartBundle, type PartDefinition, type PartReference } from '../../parts/schema'
import { validatePartDefinition } from '../../parts/validate'
import { useBuilderStore } from '../store'
import { t } from '../i18n'
import type { BuilderCommandResult } from '../operations/types'
import { publishOperationResult } from '../operations/result'
import { registerLibraryPart, forkPartBundle, type LibraryPart } from './repository'
import { usePartEditorStore, useWorkspaceStore } from './store'

const fail = (action: string, error: unknown): BuilderCommandResult => publishOperationResult({ ok: false, action,
  message: error instanceof Error ? error.message : String(error), fieldErrors: {} })
const done = (action: string, id: string): BuilderCommandResult => publishOperationResult({ ok: true, action,
  message: t().parts.operationDone, target: { kind: 'part', id }, corrections: [], validation: { errors: 0, warnings: 0 } })
function edit(action: string, mutate: (bundle: PartBundle) => void, id = ''): BuilderCommandResult {
  try { usePartEditorStore.getState().change(mutate); return done(action, id) } catch (error) { return fail(action, error) }
}
export const createPartDraftSchema = z.object({ name: z.string().min(1), input: partInputSchema }).strict()
export function createPartDraftCommand(value: z.input<typeof createPartDraftSchema>): BuilderCommandResult {
  try {
    const parsed = createPartDraftSchema.parse(value)
    const definition = newPartDefinition(parsed.name, parsed.input)
    usePartEditorStore.getState().open({ definition, definitions: {}, assets: [] })
    useWorkspaceStore.getState().setScreen('part')
    return done('create-part-draft', definition.id)
  } catch (error) { return fail('create-part-draft', error) }
}
export const updatePartDefinitionSchema = z.object({ name: z.string().min(1).optional(), description: z.string().optional(), author: z.string().optional(),
  license: z.string().optional(), input: partInputSchema.optional() }).strict()
export function updatePartDefinitionCommand(value: z.input<typeof updatePartDefinitionSchema>) {
  return edit('update-part-definition', (bundle) => { Object.assign(bundle.definition, updatePartDefinitionSchema.parse(value)) })
}
export const addPartNodeSchema = partNodeSchema.omit({ id: true }).extend({ id: z.string().min(1).optional() }).strict()
export function addPartNodeCommand(value: z.input<typeof addPartNodeSchema>) {
  let id = ''
  const result = edit('add-part-node', (bundle) => {
    const parsed = addPartNodeSchema.parse(value); id = parsed.id ?? crypto.randomUUID()
    if (bundle.definition.nodes.some((node) => node.id === id) || id.startsWith('$')) throw new Error('Part node ID already exists or is reserved')
    if ('custom' in parsed.definition && !bundle.definitions[parsed.definition.custom]) {
      const reference = parsed.definition
      const entry = usePartEditorStore.getState().library.find((item) => item.hash === reference.custom)
      if (!entry) throw new Error('Custom part is not in the library')
      bundle.definitions = { ...bundle.definitions, ...entry.bundle.definitions, [entry.hash]: structuredClone(entry.bundle.definition) }
      for (const asset of entry.bundle.assets) if (!bundle.assets.some((item) => item.id === asset.id)) bundle.assets.push(structuredClone(asset))
    }
    bundle.definition.nodes.push({ ...parsed, id })
  }, id)
  if (result.ok) usePartEditorStore.getState().select(id)
  return result.ok ? done('add-part-node', id) : result
}
export const updatePartNodeSchema = z.object({ nodeId: z.string(), changes: partNodeSchema.omit({ id: true, definition: true }).partial().strict() }).strict()
export function updatePartNodeCommand(value: z.input<typeof updatePartNodeSchema>) {
  return edit('update-part-node', (bundle) => {
    const parsed = updatePartNodeSchema.parse(value), node = bundle.definition.nodes.find((item) => item.id === parsed.nodeId)
    if (!node) throw new Error('Part node was not found')
    Object.assign(node, parsed.changes)
  }, value.nodeId)
}
export function deletePartNodeCommand(nodeId: string) {
  return edit('delete-part-node', (bundle) => {
    const ids = dependentPartIds(bundle.definition.nodes, nodeId)
    bundle.definition.nodes = bundle.definition.nodes.filter((node) => !ids.has(node.id))
    for (const [name, binding] of Object.entries(bundle.definition.outputs)) if (bindingDependencies(binding).some((id) => ids.has(id))) delete bundle.definition.outputs[name]
  }, nodeId)
}
export const exposePartParameterSchema = z.object({ name: z.string().min(1), nodeId: z.string(), parameter: z.string(), specification: partParameterSchema })
export function exposePartParameterCommand(value: z.input<typeof exposePartParameterSchema>) {
  return edit('expose-part-parameter', (bundle) => {
    const parsed = exposePartParameterSchema.parse(value), node = bundle.definition.nodes.find((item) => item.id === parsed.nodeId)
    if (!node) throw new Error('Part node was not found')
    bundle.definition.parameters[parsed.name] = parsed.specification
    node.parameters[parsed.parameter] = { parameter: parsed.name }
  })
}
export const exposePartMaterialSchema = z.object({ name: z.string().min(1), nodeId: z.string(), surface: z.string(), material: partMaterialSchema })
export function exposePartMaterialCommand(value: z.input<typeof exposePartMaterialSchema>) {
  return edit('expose-part-material', (bundle) => {
    const parsed = exposePartMaterialSchema.parse(value), node = bundle.definition.nodes.find((item) => item.id === parsed.nodeId)
    if (!node) throw new Error('Part node was not found')
    bundle.definition.materialSlots[parsed.name] = parsed.material
    node.materials[parsed.surface] = { slot: parsed.name }
  })
}
export const exposePartPortSchema = z.object({ name: z.string().min(1), binding: partBindingSchema.nullable() })
export function exposePartPortCommand(value: z.input<typeof exposePartPortSchema>) {
  return edit('expose-part-port', (bundle) => {
    const parsed = exposePartPortSchema.parse(value)
    if (parsed.binding) bundle.definition.outputs[parsed.name] = parsed.binding
    else delete bundle.definition.outputs[parsed.name]
  })
}
export async function savePartLibraryCommand() {
  try {
    const state = usePartEditorStore.getState(), bundle = structuredClone(state.bundle)
    const validation = validatePartDefinition(bundle.definition, bundle.definitions)
    if (!validation.ok) throw new Error(validation.errors.join('\n'))
    const revisions = state.library.filter((entry) => entry.bundle.definition.id === bundle.definition.id).map((entry) => entry.bundle.definition.revision)
    if (revisions.length) bundle.definition.revision = Math.max(...revisions) + 1
    const entry = await registerLibraryPart(bundle)
    state.open(entry.bundle); await state.refreshLibrary()
    return done('save-part-library', entry.hash)
  } catch (error) { return fail('save-part-library', error) }
}
export async function openPartLibraryCommand(hash: string, copy = false) {
  try {
    const state = usePartEditorStore.getState(), entry = state.library.find((part) => part.hash === hash)
    if (!entry) throw new Error('Library part was not found')
    state.open(copy ? await forkPartBundle(entry.bundle) : entry.bundle)
    useWorkspaceStore.getState().setScreen('part')
    return done('open-part-library', hash)
  } catch (error) { return fail('open-part-library', error) }
}

function ownership(binding: PartBinding): PartElement['parent'] {
  const parent = bindingDependencies(binding).find((id) => id !== '$book')
  return parent ? { type: 'element', elementId: parent } : { type: binding.type === 'output' && binding.portId === 'left-page' ? 'left-page' : 'right-page' }
}
function embedDefinition(project: BookProject, reference: PartReference) {
  if ('builtin' in reference) { builtinPart(reference.builtin, reference.version); return }
  if (project.partDefinitions?.[reference.custom]) return
  const entry = usePartEditorStore.getState().library.find((item) => item.hash === reference.custom)
  if (!entry) throw new Error('Custom part is not in the library')
  project.partDefinitions = { ...project.partDefinitions, ...structuredClone(entry.bundle.definitions), [entry.hash]: structuredClone(entry.bundle.definition) }
  for (const asset of entry.bundle.assets) {
    const existing = project.assets.find((item) => item.id === asset.id)
    if (existing && existing.data !== asset.data) throw new Error(`Conflicting book asset: ${asset.id}`)
    if (!existing) project.assets.push(structuredClone(asset))
  }
}
export const placePartSchema = z.object({ spreadId: z.string(), name: z.string().min(1), ...partInstanceSchema.shape }).strict()
export function placePartCommand(value: z.input<typeof placePartSchema>): BuilderCommandResult {
  try {
    const parsed = placePartSchema.parse(value), state = useBuilderStore.getState()
    if (state.mode !== 'edit') throw new Error(t().operations.readOnly)
    const next = structuredClone(state.project), spread = next.book.spreads.find((item) => item.id === parsed.spreadId)
    if (!spread) throw new Error('Spread was not found')
    embedDefinition(next, parsed.definition)
    const element = createStageElement('part', ownership(parsed.mount)) as PartElement
    element.name = parsed.name; element.part = partInstanceSchema.parse(parsed)
    spread.elements.push(element)
    const errors = validateBookParts(next)
    if (errors.length) throw new Error(errors.join('\n'))
    state.commit((project) => { project.partDefinitions = next.partDefinitions; project.assets = next.assets
      project.book.spreads.find((item) => item.id === parsed.spreadId)!.elements.push(element) })
    state.select({ type: 'element', spreadId: parsed.spreadId, elementId: element.id })
    return done('place-part', element.id)
  } catch (error) { return fail('place-part', error) }
}
export const updatePlacedPartSchema = z.object({ spreadId: z.string(), elementId: z.string(),
  name: z.string().min(1).optional(), changes: partInstanceSchema.partial().strict() }).strict()
export function updatePlacedPartCommand(value: z.input<typeof updatePlacedPartSchema>): BuilderCommandResult {
  try {
    const parsed = updatePlacedPartSchema.parse(value), state = useBuilderStore.getState(), next = structuredClone(state.project)
    if (state.mode !== 'edit') throw new Error(t().operations.readOnly)
    const element = next.book.spreads.find((item) => item.id === parsed.spreadId)?.elements.find((item) => item.id === parsed.elementId)
    if (element?.type !== 'part') throw new Error('Placed part was not found')
    if (parsed.changes.definition) embedDefinition(next, parsed.changes.definition)
    element.part = partInstanceSchema.parse({ ...element.part, ...parsed.changes })
    element.parent = ownership(element.part.mount)
    if (parsed.name) element.name = parsed.name
    const errors = validateBookParts(next)
    if (errors.length) throw new Error(errors.join('\n'))
    state.commit((project) => {
      project.partDefinitions = next.partDefinitions; project.assets = next.assets
      const spread = project.book.spreads.find((item) => item.id === parsed.spreadId)!
      spread.elements[spread.elements.findIndex((item) => item.id === parsed.elementId)] = element
    })
    return done('update-placed-part', element.id)
  } catch (error) { return fail('update-placed-part', error) }
}
export function deletePlacedPartCommand(spreadId: string, elementId: string) {
  try {
    const state = useBuilderStore.getState()
    if (state.mode !== 'edit') throw new Error(t().operations.readOnly)
    const spread = state.project.book.spreads.find((item) => item.id === spreadId)
    if (!spread) throw new Error('Spread was not found')
    const ids = dependentPartIds(spreadPartNodes(spread), elementId)
    state.commit((project) => {
      const target = project.book.spreads.find((item) => item.id === spreadId)!
      target.elements = target.elements.filter((element) => !ids.has(element.id))
      target.timeline.tracks = target.timeline.tracks.filter((track) => track.target.type !== 'element' || !ids.has(track.target.elementId))
    })
    state.select({ type: 'spread', spreadId }); return done('delete-placed-part', elementId)
  } catch (error) { return fail('delete-placed-part', error) }
}
export function referenceDefinition(reference: PartReference, definitions: Record<string, PartDefinition>) {
  if ('builtin' in reference) return builtinPart(reference.builtin, reference.version)
  const definition = definitions[reference.custom]
  if (!definition) throw new Error('Part definition was not found')
  return definition
}
