import { z } from 'zod'
import { BUILTIN_PARTS } from '../../parts/catalog'
import { evaluateBookParts } from '../../parts/book'
import { placementSurfaces } from '../../parts/placement'
import { openingAngle, type PartPort } from '../../parts/geometry'
import { number, string, object, record, ref, partToolSchema } from '../../parts/jsonSchema'
import { validatePartDefinition } from '../../parts/validate'
import * as commands from '../operations/commands'
import type { BuilderCommandResult } from '../operations/types'
import { usePartEditorStore, useWorkspaceStore } from '../parts/store'
import { useBuilderStore } from '../store'
import type { WebMcpTool } from './types'
import { describePartEdit } from '../../parts/edit'
import { bookEditScene } from '../../parts/bookEdit'

const response = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })
const portSummary = (port: PartPort) => port.kind === 'surface' ? { kind: port.kind, width: port.face.width, height: port.face.height }
  : { kind: port.kind, openingAngleDeg: openingAngle(port), width: port.width, extentA: port.extentA, extentB: port.extentB }
export function partDraftSummary() {
  const state = usePartEditorStore.getState(), { bundle } = state
  return { screen: useWorkspaceStore.getState().screen, definition: bundle.definition, definitions: bundle.definitions,
    assets: bundle.assets.map(({ data: _data, ...meta }) => meta), selectedId: state.selectedId,
    canUndo: state.undo.length > 0, canRedo: state.redo.length > 0, status: state.status,
    validation: validatePartDefinition(bundle.definition, bundle.definitions) }
}
export function makePartTools(): WebMcpTool[] {
  const tool = <T,>(name: string, description: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, properties: Record<string, unknown>,
    required: string[], run: (input: T) => BuilderCommandResult | Promise<BuilderCommandResult>): WebMcpTool => ({
    name: `tobidas-${name}`, description, inputSchema: partToolSchema(properties, required), execute: async (input, options) => {
      if (options?.signal?.aborted) throw new Error('Operation aborted')
      const parsed = schema.safeParse(input)
      if (!parsed.success) return response({ ok: false, action: name, errors: parsed.error.issues })
      return response(await run(parsed.data))
    },
  })
  const node = { id: string, name: string, definition: ref('reference'), mount: ref('binding'), parameters: record(ref('expression')),
    materials: record({ oneOf: [ref('material'), object({ slot: string })] }), outline: ref('outline'), uniformScale: ref('uniformScale') }
  const instance = { definition: ref('reference'), mount: ref('binding'), parameters: record(number), materials: record(ref('material')), uniformScale: ref('uniformScale') }
  return [
    { name: 'tobidas-get-part-edit-controls', description: 'Read connected placement controls, actual placement axes, design angles, uniform scale and bounds. Translation uses these material axes; it never creates animation keys.',
      inputSchema: object({ spreadId: string, elementId: string }), annotations: { readOnlyHint: true }, execute: (input) => {
        try { const d = describePartEdit(bookEditScene(useBuilderStore.getState().project, String(input.spreadId)), String(input.elementId))
          return response({ ok: true, pivot: d.pivot.toArray(), x: d.x.toArray(), y: d.y.toArray(), translateY: d.translateY, angles: d.angles, scale: d.scale, size: d.size })
        } catch (error) { return response({ ok: false, error: String(error) }) }
      } },
    tool('edit-placed-part', 'Move, rotate an exposed design angle, or uniformly scale a part while preserving its real attachment faces. Rebuilds supports and downstream connections, checks the folding path and stowage, and commits one undo step.', commands.editPlacedPartSchema,
      { spreadId: string, elementId: string, intent: ref('editIntent') }, ['spreadId', 'elementId', 'intent'], commands.editPlacedPartCommand),
    { name: 'tobidas-get-part-catalog', description: 'Read built-in parts, typed dimensions, input angle capacities, public ports, and the user library (initially empty). All folding parts require two real connected faces. No binary assets.',
      inputSchema: object({}), annotations: { readOnlyHint: true }, execute: () => response({ builtins: BUILTIN_PARTS,
        library: usePartEditorStore.getState().library.map(({ hash, bundle }) => ({ hash, definition: bundle.definition, validation: validatePartDefinition(bundle.definition, bundle.definitions) })) }) },
    { name: 'tobidas-get-part-draft', description: 'Read the separate custom-part editor document, typed graph, public parameters and material slots, asset metadata, undo state, and physical-model diagnostics.',
      inputSchema: object({}), annotations: { readOnlyHint: true }, execute: () => response(partDraftSummary()) },
    { name: 'tobidas-get-part-mounts', description: 'Read evaluated public faces and fold pairs for a book spread. Angle is the actual opening, never a normalized progress. The book gutter accepts 0–180 degrees. Placement checks the entire opening path.',
      inputSchema: object({ spreadId: string }), annotations: { readOnlyHint: true }, execute: (input) => {
        const project = useBuilderStore.getState().project, spread = project.book.spreads.find((item) => item.id === input.spreadId)
        if (!spread) return response({ ok: false, error: 'Spread not found' })
        try { const result = evaluateBookParts(project, spread, Math.PI, 0)
          return response({ book: { nodeId: '$book', ports: ['gutter', 'left-page', 'right-page'] },
            surfaces: placementSurfaces(project, spread).map(({ reference, face }) => ({ reference, width: face.width, height: face.height, outline: face.outline })),
            nodes: Object.fromEntries(Object.entries(result.nodes).map(([id, node]) => [id, Object.fromEntries(Object.entries(node.ports).map(([key, port]) => [key, portSummary(port)]))])) })
        } catch (error) { return response({ ok: false, error: String(error) }) }
      } },
    tool('create-part-draft', 'Create a custom-part document in the separate editor. This never replaces the book. No built-in themed presets are seeded.', commands.createPartDraftSchema,
      { name: string, input: ref('input') }, ['name', 'input'], commands.createPartDraftCommand),
    tool('update-part-definition', 'Edit draft metadata and the input capacity. A 180-degree part on a 90-degree host remains partly open; a 150-degree part cannot be placed on a 180-degree host.', commands.updatePartDefinitionSchema,
      { name: string, description: string, author: string, license: string, input: ref('input'), parameters: { type: 'object', additionalProperties: ref('parameter') }, editHandles: { type: 'array', items: ref('editHandle'), maxItems: 32 } }, [], commands.updatePartDefinitionCommand),
    tool('add-part-node', 'Add a built-in or library part to the draft graph. Bind to input, an upstream public output, or two coincident material hinge lines. Use get-part-catalog first. Assets must already be imported in the standard UI.', commands.addPartNodeSchema,
      node, ['name', 'definition', 'mount'], commands.addPartNodeCommand),
    tool('update-part-node', 'Edit an internal node through the same typed command, undo and autosave as the inspector. Parameters allow literals, public parameter references, addition and multiplication; no executable code.', commands.updatePartNodeSchema,
      { nodeId: string, changes: object({ name: node.name, mount: node.mount, parameters: node.parameters, materials: node.materials, outline: node.outline, uniformScale: node.uniformScale }, []) }, ['nodeId', 'changes'], commands.updatePartNodeCommand),
    tool('edit-part-node', 'Edit connected placement in the custom-part editor with the same movement, design rotation and uniform scale planner used by canvas gizmos. Preserves real input faces and validates dependent nodes.', commands.editPartNodeSchema,
      { nodeId: string, intent: ref('editIntent') }, ['nodeId', 'intent'], commands.editPartNodeCommand),
    tool('expose-part-edit-handle', 'Declare an angle handle bound to a supported internal part operation. Stores a portable declaration and binds its public parameter; never stores executable code.', commands.exposePartEditHandleSchema,
      { name: string, label: string, nodeId: string, operation: string }, ['name', 'label', 'nodeId', 'operation'], commands.exposePartEditHandleCommand),
    tool('delete-part-node', 'Delete a draft node and nodes driven by either of its faces. Cleans affected public ports in one undo step.', z.object({ nodeId: z.string() }),
      { nodeId: string }, ['nodeId'], ({ nodeId }) => commands.deletePartNodeCommand(nodeId)),
    tool('expose-part-parameter', 'Expose a typed editable dimension, with label, bounds and default, and bind an internal parameter to it.', commands.exposePartParameterSchema,
      { name: string, nodeId: string, parameter: string, specification: ref('parameter') }, ['name', 'nodeId', 'parameter', 'specification'], commands.exposePartParameterCommand),
    tool('expose-part-material', 'Expose a replaceable artwork slot. Use only existing asset IDs, colors and text; import files through the standard UI.', commands.exposePartMaterialSchema,
      { name: string, nodeId: string, surface: string, material: ref('material') }, ['name', 'nodeId', 'surface', 'material'], commands.exposePartMaterialCommand),
    tool('expose-part-port', 'Publish a face or pair for downstream parts, or remove it with binding null. The saved ID remains the public contract.', commands.exposePartPortSchema,
      { name: string, binding: { oneOf: [ref('binding'), { type: 'null' }] } }, ['name', 'binding'], commands.exposePartPortCommand),
    tool('save-part-library', 'Validate the draft and register an immutable local library revision. File import/export uses the standard UI, not WebMCP payloads.', z.object({}), {}, [], commands.savePartLibraryCommand),
    tool('open-part-library', 'Open an existing library definition in the separate editor. copy=true creates a new identity and preserves source attribution.', z.object({ hash: z.string(), copy: z.boolean().default(false) }),
      { hash: string, copy: { type: 'boolean' } }, ['hash'], ({ hash, copy }) => commands.openPartLibraryCommand(hash, copy)),
    tool('place-part', 'Place a built-in or custom library part on real book faces. Checks all opening angles, connections and closed-page fit before a single commit. Custom definitions and assets are embedded immutably in the book.', commands.placePartSchema,
      { spreadId: string, name: string, ...instance }, ['spreadId', 'name', 'definition', 'mount'], commands.placePartCommand),
    tool('place-part-on-surfaces', 'Choose one or two actual faces and material points, just like clicking in the canvas. Automatically completes attachment bridges, checks the full opening path, and places the part in one undo step. Read surface references with get-part-mounts first.', commands.placePartOnSurfacesSchema,
      { spreadId: string, name: string, definition: ref('reference'),
        first: object({ surface: ref('surfaceRef'), point: { type: 'array', items: number, minItems: 2, maxItems: 2 } }),
        second: object({ surface: ref('surfaceRef'), point: { type: 'array', items: number, minItems: 2, maxItems: 2 } }) },
      ['spreadId', 'name', 'definition', 'first'], commands.placePartOnSurfacesCommand),
    tool('update-placed-part', 'Edit instance dimensions, mount or public artwork. Explicitly change definition.custom to update a library revision. Existing placements never auto-update. Transforming an independent local fold is unsupported.', commands.updatePlacedPartSchema,
      { spreadId: string, elementId: string, name: string, changes: object(instance, []) }, ['spreadId', 'elementId', 'changes'], commands.updatePlacedPartCommand),
    ...(['undo', 'redo'] as const).map((action): WebMcpTool => ({ name: `tobidas-part-${action}`, description: `${action} the separate custom-part draft using its own history.`, inputSchema: object({}), execute: () => {
      const state = usePartEditorStore.getState(); if (action === 'undo') state.undoEdit(); else state.redoEdit(); return response(partDraftSummary())
    } })),
  ]
}
