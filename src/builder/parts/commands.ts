import { z } from 'zod'
import type { BookProject } from '../../schema/bookPackage'
import { createStageElement } from '../../schema/bookDefaults'
import type { PartElement } from '../../schema/stageElement'
import { builtinPart } from '../../parts/catalog'
import { elementDescendantIds } from '../hierarchy'
import { dependentPartIds } from '../../parts/evaluate'
import { validateBookParts, spreadPartNodes, evaluateBookParts } from '../../parts/book'
import { planSupportedPart } from '../../parts/supportPlanning'
import { bindingDependencies, evaluateExpression, newPartDefinition, partBindingSchema, partInputSchema, partInstanceSchema, partMaterialSchema,
  partNodeSchema, partParameterSchema, partReferenceSchema, partSurfaceRefSchema, partEditHandleSchema, type PartBinding, type PartBundle, type PartDefinition, type PartReference } from '../../parts/schema'
import { planPartPlacement, type SurfacePick } from '../../parts/placement'
import { fixtureInput, syncDefinitionRequirements, validatePartDefinition } from '../../parts/validate'
import { useBuilderStore } from '../store'
import { t } from '../i18n'
import type { BuilderCommandResult } from '../operations/types'
import { publishOperationResult } from '../operations/result'
import { registerLibraryPart, forkPartBundle, type LibraryPart } from './repository'
import { usePartEditorStore, useWorkspaceStore } from './store'
import { evaluateEditScene, partEditIntentSchema, planPartEdit, type PartEditScene } from '../../parts/edit'
import { faceCorners, pointOnFace } from '../../parts/geometry'
import { applyBookEditPlan, bookEditScene } from '../../parts/bookEdit'

const fail = (action: string, error: unknown): BuilderCommandResult => publishOperationResult({ ok: false, action,
  message: error instanceof Error ? error.message : String(error), fieldErrors: {} })
const done = (action: string, id: string, validation = { errors: 0, warnings: 0 }): BuilderCommandResult => publishOperationResult({ ok: true, action,
  message: t().parts.operationDone, target: { kind: 'part', id }, corrections: [], validation })
export const editPlacedPartSchema = z.object({ spreadId: z.string(), elementId: z.string(), intent: partEditIntentSchema }).strict()
export function editPlacedPartCommand(value: z.input<typeof editPlacedPartSchema>): BuilderCommandResult {
  try {
    const parsed = editPlacedPartSchema.parse(value), state = useBuilderStore.getState()
    if (state.mode !== 'edit') throw new Error(t().operations.readOnly)
    const plan = planPartEdit(bookEditScene(state.project, parsed.spreadId), parsed.elementId, parsed.intent)
    if (!plan.ok) throw new Error(plan.detail)
    const next = applyBookEditPlan(state.project, parsed.spreadId, plan)
    const errors = validateBookParts(next)
    if (errors.length) throw new Error(errors[0])
    state.commit((project) => { project.book.spreads.find((item) => item.id === parsed.spreadId)!.elements = next.book.spreads.find((item) => item.id === parsed.spreadId)!.elements })
    return done('edit-placed-part', parsed.elementId)
  } catch (error) { return fail('edit-placed-part', error) }
}
function edit(action: string, mutate: (bundle: PartBundle) => void, id = ''): BuilderCommandResult {
  try {
    const previous = usePartEditorStore.getState().bundle
    if (previous.definition.contents?.length || Object.values(previous.definitions).some((definition) => definition.contents?.length)) {
      const candidate = structuredClone(previous); mutate(candidate); syncDefinitionRequirements(candidate.definition)
      if (candidate.definition.nodes.length) {
        const validation = validatePartDefinition(candidate.definition, candidate.definitions)
        if (!validation.ok) throw new Error(validation.errors[0])
      }
      usePartEditorStore.getState().change((bundle) => { Object.assign(bundle, candidate) })
    } else usePartEditorStore.getState().change(mutate)
    const { bundle } = usePartEditorStore.getState(), validation = validatePartDefinition(bundle.definition, bundle.definitions)
    return done(action, id, { errors: validation.errors.length, warnings: 0 })
  } catch (error) { return fail(action, error) }
}
export const createPartDraftSchema = z.object({ name: z.string().min(1), input: partInputSchema }).strict()
export function createPartDraftCommand(value: z.input<typeof createPartDraftSchema>): BuilderCommandResult {
  try {
    const parsed = createPartDraftSchema.parse(value)
    const definition = newPartDefinition(parsed.name, parsed.input)
    usePartEditorStore.getState().open({ definition, definitions: {}, assets: [] })
    useWorkspaceStore.getState().setScreen('part')
    return done('create-part-draft', definition.id, { errors: 1, warnings: 0 })
  } catch (error) { return fail('create-part-draft', error) }
}
export const updatePartDefinitionSchema = z.object({ name: z.string().min(1).optional(), description: z.string().optional(), author: z.string().optional(),
  license: z.string().optional(), input: partInputSchema.optional(), parameters: z.record(partParameterSchema).optional(), editHandles: z.array(partEditHandleSchema).optional() }).strict()
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
  return result.ok ? done('add-part-node', id, result.validation) : result
}
export const updatePartNodeSchema = z.object({ nodeId: z.string(), changes: partNodeSchema.omit({ id: true, definition: true }).partial().strict() }).strict()
export function updatePartNodeCommand(value: z.input<typeof updatePartNodeSchema>) {
  return edit('update-part-node', (bundle) => {
    const parsed = updatePartNodeSchema.parse(value), node = bundle.definition.nodes.find((item) => item.id === parsed.nodeId)
    if (!node) throw new Error('Part node was not found')
    Object.assign(node, parsed.changes)
  }, value.nodeId)
}
export function draftEditScene(bundle: PartBundle): PartEditScene {
  const input = bundle.definition.input
  return { nodes: bundle.definition.nodes, definitions: bundle.definitions, maxAngle: input.kind === 'fold-pair' ? input.maxOpeningAngleDeg : 0,
    parameters: Object.fromEntries(Object.entries(bundle.definition.parameters).map(([id, p]) => [id, p.default])), slots: bundle.definition.materialSlots,
    at: (angle) => ({ input: fixtureInput(input, angle, 8) }) }
}
export const editPartNodeSchema = z.object({ nodeId: z.string(), intent: partEditIntentSchema }).strict()
export function editPartNodeCommand(value: z.input<typeof editPartNodeSchema>) {
  try {
    const parsed = editPartNodeSchema.parse(value), bundle = usePartEditorStore.getState().bundle
    const plan = planPartEdit(draftEditScene(bundle), parsed.nodeId, parsed.intent)
    if (!plan.ok) throw new Error(plan.detail)
    const candidate = structuredClone(bundle), changedDefaults = new Map<string, number>()
    candidate.definition.nodes = structuredClone(plan.nodes)
    // 公開済みの直接参照は切断せず、作者が編集している既定値へ書き戻す。
    for (const node of candidate.definition.nodes) {
      const before = bundle.definition.nodes.find((item) => item.id === node.id)!
      for (const [key, expression] of Object.entries(before.parameters)) {
        const value = node.parameters[key]
        if (typeof expression === 'number' || typeof value !== 'number') continue
        const defaults = Object.fromEntries(Object.entries(bundle.definition.parameters).map(([id, p]) => [id, p.default]))
        if (Math.abs(evaluateExpression(expression, defaults) - value) < 1e-8) { node.parameters[key] = expression; continue }
        if (!('parameter' in expression)) throw new Error('This dimension is defined by a formula; edit its public parameters')
        const previous = changedDefaults.get(expression.parameter)
        if (previous !== undefined && Math.abs(previous - value) > 1e-7) throw new Error('The shared public parameter requires conflicting dimensions')
        changedDefaults.set(expression.parameter, value)
        const specification = candidate.definition.parameters[expression.parameter]
        candidate.definition.parameters[expression.parameter] = partParameterSchema.parse({ ...specification, default: value })
        node.parameters[key] = expression
      }
    }
    if (changedDefaults.size) {
      const validation = validatePartDefinition(candidate.definition, candidate.definitions)
      if (!validation.ok) throw new Error(validation.errors[0])
      // 同じ公開値を別の部品も使う場合、検査していない形状変更を確定しない。
      for (const angle of plan.checkedAngles) {
        const expected = evaluateEditScene(draftEditScene(bundle), plan.nodes, angle).faces.flatMap(faceCorners)
        const actual = evaluateEditScene(draftEditScene(candidate), candidate.definition.nodes, angle).faces.flatMap(faceCorners)
        if (expected.length !== actual.length || expected.some((point, i) => point.distanceTo(actual[i]) > 1e-6)) throw new Error('This public parameter also changes another part; edit the shared default explicitly')
      }
    }
    return edit('edit-part-node', (target) => { target.definition = candidate.definition }, parsed.nodeId)
  } catch (error) { return fail('edit-part-node', error) }
}
export const exposePartEditHandleSchema = z.object({ name: z.string().min(1), label: z.string().min(1), nodeId: z.string(), operation: z.string() }).strict()
export function exposePartEditHandleCommand(value: z.input<typeof exposePartEditHandleSchema>) {
  return edit('expose-part-edit-handle', (bundle) => {
    const parsed = exposePartEditHandleSchema.parse(value), node = bundle.definition.nodes.find((item) => item.id === parsed.nodeId)
    if (!node) throw new Error('Part node was not found')
    const definition = referenceDefinition(node.definition, bundle.definitions)
    const parameter = 'builtin' in node.definition ? parsed.operation
      : bundle.definitions[node.definition.custom]?.editHandles?.find((h) => h.id === parsed.operation)?.parameter
    const spec = parameter && definition.parameters[parameter]
    if (!spec || spec.type !== 'angle' || 'builtin' in node.definition && !['splayAngle', 'tiltAngle', 'yawAngle'].includes(parsed.operation)) throw new Error('Unsupported design angle')
    const previous = node.parameters[parameter!]
    const defaults = Object.fromEntries(Object.entries(bundle.definition.parameters).map(([id, p]) => [id, p.default]))
    bundle.definition.parameters[parsed.name] = { ...spec, label: parsed.label, default: evaluateExpression(previous ?? spec.default, defaults) }
    node.parameters[parameter!] = { parameter: parsed.name }
    bundle.definition.editHandles = [...bundle.definition.editHandles?.filter((h) => h.id !== parsed.name) ?? [],
      { id: parsed.name, label: parsed.label, parameter: parsed.name, nodeId: node.id, operation: parsed.operation, kind: 'angle' }]
  })
}
export function deletePartNodeCommand(nodeId: string) {
  return edit('delete-part-node', (bundle) => {
    const ids = dependentPartIds(bundle.definition.nodes, nodeId)
    const removedContents = new Set<string>()
    let more = true
    while (more) { more = false; for (const { element } of bundle.definition.contents ?? []) {
      const attachment = element.attachment
      if (!removedContents.has(element.id) && (attachment.type === 'surface' ? ids.has(attachment.surface.nodeId) : removedContents.has(attachment.elementId))) { removedContents.add(element.id); more = true }
    } }
    bundle.definition.contents = bundle.definition.contents?.filter((item) => !removedContents.has(item.element.id))
    bundle.definition.nodes = bundle.definition.nodes.filter((node) => !ids.has(node.id))
    bundle.definition.editHandles = bundle.definition.editHandles?.filter((handle) => !ids.has(handle.nodeId))
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
export function placementProject(): BookProject {
  const project = useBuilderStore.getState().project, library = usePartEditorStore.getState().library
  return { ...project, partDefinitions: { ...Object.fromEntries(library.flatMap((entry) => [[entry.hash, entry.bundle.definition], ...Object.entries(entry.bundle.definitions)])), ...project.partDefinitions },
    assets: [...new Map([...library.flatMap((entry) => entry.bundle.assets), ...project.assets].map((asset) => [asset.id, asset])).values()] }
}
export function previewSurfacePlacement(spreadId: string, reference: PartReference, first: SurfacePick, second?: SurfacePick) {
  return planPartPlacement(placementProject(), spreadId, reference, first, second)
}
export const surfacePickSchema = z.object({ surface: partSurfaceRefSchema, point: z.tuple([z.number().finite(), z.number().finite()]) }).strict()
export const placePartOnSurfacesSchema = z.object({ spreadId: z.string(), name: z.string().min(1), definition: partReferenceSchema,
  first: surfacePickSchema, second: surfacePickSchema.optional() }).strict()
export function placePartOnSurfacesCommand(value: z.input<typeof placePartOnSurfacesSchema>): BuilderCommandResult {
  try {
    const parsed = placePartOnSurfacesSchema.parse(value)
    const plan = previewSurfacePlacement(parsed.spreadId, parsed.definition, parsed.first, parsed.second)
    if (!plan.ok) throw new Error(plan.detail)
    return placePartCommand({ spreadId: parsed.spreadId, name: parsed.name, ...plan.instance })
  } catch (error) { return fail('place-part', error) }
}
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
    const parsed = updatePlacedPartSchema.parse(value), state = useBuilderStore.getState()
    let next = structuredClone(state.project)
    if (state.mode !== 'edit') throw new Error(t().operations.readOnly)
    let element = next.book.spreads.find((item) => item.id === parsed.spreadId)?.elements.find((item) => item.id === parsed.elementId)
    if (element?.type !== 'part') throw new Error('Placed part was not found')
    if (parsed.changes.definition) embedDefinition(next, parsed.changes.definition)
    const sameMount = !parsed.changes.mount || JSON.stringify(parsed.changes.mount) === JSON.stringify(element.part.mount)
    const sameDefinition = !parsed.changes.definition || JSON.stringify(parsed.changes.definition) === JSON.stringify(element.part.definition)
    if (sameMount && sameDefinition && (parsed.changes.parameters || parsed.changes.uniformScale !== undefined)) {
      const operations = [
        ...(parsed.changes.parameters ? [{ type: 'parameters' as const, values: parsed.changes.parameters }] : []),
        ...(parsed.changes.uniformScale !== undefined ? [{ type: 'scale' as const, value: parsed.changes.uniformScale }] : []),
      ]
      for (const intent of operations) {
        const plan = planPartEdit(bookEditScene(next, parsed.spreadId), parsed.elementId, intent)
        if (!plan.ok) throw new Error(plan.detail)
        next = applyBookEditPlan(next, parsed.spreadId, plan)
      }
      element = next.book.spreads.find((item) => item.id === parsed.spreadId)!.elements.find((item) => item.id === parsed.elementId)!
      if (element.type !== 'part') throw new Error('Placed part was not found')
      if (parsed.changes.materials) element.part.materials = parsed.changes.materials
    } else element.part = partInstanceSchema.parse({ ...element.part, ...parsed.changes })
    if (parsed.changes.shapes && element.part.supportDesign === 'automatic' && 'builtin' in element.part.definition && element.part.definition.builtin === 'upright') {
      const original = state.project.book.spreads.find(item => item.id === parsed.spreadId)!
      const panel = evaluateBookParts(state.project, original, Math.PI, 0).nodes[element.id].ports.panel
      if (panel.kind !== 'surface') throw new Error('Upright panel is missing')
      const mount = element.part.mount
      const planned = planSupportedPart(next, original, { ...element, part: { ...element.part, shapes: parsed.changes.shapes } }, {
        position: pointOnFace(panel.face, panel.face.width / 2, 0).toArray(), surfaces: mount.type === 'pair' ? [mount.a, mount.b] : undefined })
      element.part = planned.part
    }
    element.parent = ownership(element.part.mount)
    if (parsed.name) element.name = parsed.name
    const errors = validateBookParts(next)
    if (errors.length) throw new Error(errors.join('\n'))
    state.commit((project) => {
      project.partDefinitions = next.partDefinitions; project.assets = next.assets
      const spread = project.book.spreads.find((item) => item.id === parsed.spreadId)!
      spread.elements = next.book.spreads.find((item) => item.id === parsed.spreadId)!.elements
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
    const ids = new Set([elementId, ...elementDescendantIds(spread, elementId)])
    state.commit((project) => {
      const target = project.book.spreads.find((item) => item.id === spreadId)!
      target.elements = target.elements.filter((element) => !ids.has(element.id))
      target.timeline.tracks = target.timeline.tracks.filter((track) => (track.target.type !== 'element' && track.target.type !== 'part-content') || !ids.has(track.target.elementId))
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
