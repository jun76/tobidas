import { builtinPart } from './catalog'
import { decorateFaces, evaluateBuiltin } from './builtins'
import { bindingDependencies, evaluateExpression, parameterValues, type PartBinding, type PartDefinitions,
  type PartMaterial, type PartNode, type PartReference } from './schema'
import { checkInput, EPSILON, faceContains, pointOnFace, type PaperEvaluation, type PaperFace, type PartPort } from './geometry'
import type { Vector3 } from 'three'

export interface EvaluatedPartGraph extends PaperEvaluation { nodes: Record<string, PaperEvaluation> }

function resolveSurface(port: PartPort): PaperFace {
  if (port.kind !== 'surface') throw new Error('A face reference requires a single surface')
  return port.face
}
function rayExtent(face: PaperFace, origin: Vector3, ray: Vector3): number {
  const delta = origin.clone().sub(face.origin), limits: number[] = []
  for (const [axis, size] of [[face.u, face.width], [face.v, face.height]] as const) {
    const rate = ray.dot(axis), position = delta.dot(axis)
    if (rate > EPSILON) limits.push((size - position) / rate)
    if (rate < -EPSILON) limits.push(-position / rate)
  }
  return Math.max(0, Math.min(...limits))
}

export function resolveBinding(binding: PartBinding, input: PartPort | undefined, output: (nodeId: string, portId: string) => PartPort): PartPort {
  if (binding.type === 'input') {
    if (!input) throw new Error('Input is not connected to a real surface')
    if (!binding.face) return input
    if (input.kind !== 'fold-pair') throw new Error('Single surface input has no second face')
    return { kind: 'surface', face: input[binding.face] }
  }
  if (binding.type === 'output') return output(binding.nodeId, binding.portId)
  const a = resolveSurface(output(binding.a.nodeId, binding.a.portId))
  const b = resolveSurface(output(binding.b.nodeId, binding.b.portId))
  const pa = binding.hingeA.map(([u, v]) => pointOnFace(a, u, v)), pb = binding.hingeB.map(([u, v]) => pointOnFace(b, u, v))
  if (pa.some((point, i) => point.distanceTo(pb[i]) > EPSILON) || !pa.every((point) => faceContains(a, point))
    || !pb.every((point) => faceContains(b, point))) throw new Error('The two material hinge lines must coincide on the actual faces')
  const width = pa[0].distanceTo(pa[1])
  if (width < EPSILON) throw new Error('Hinge line has zero length')
  const axis = pa[1].clone().sub(pa[0]).normalize()
  const rayA = a.u.clone().cross(a.v).cross(axis).normalize().multiplyScalar(binding.directionA === 'positive' ? 1 : -1)
  const rayB = b.u.clone().cross(b.v).cross(axis).normalize().multiplyScalar(binding.directionB === 'positive' ? 1 : -1)
  return { kind: 'fold-pair', a, b, origin: pa[0].clone().add(pa[1]).multiplyScalar(.5), axis, rayA, rayB, width,
    extentA: Math.min(...pa.map((point) => rayExtent(a, point, rayA))), extentB: Math.min(...pb.map((point) => rayExtent(b, point, rayB))),
    foldSign: binding.foldSign }
}

export function evaluatePartReference(reference: PartReference, input: PartPort, definitions: PartDefinitions,
  values: Record<string, number> = {}, materials: Record<string, PartMaterial> = {}, prefix = 'part', ancestors: string[] = []): PaperEvaluation {
  if ('builtin' in reference) {
    const builtin = builtinPart(reference.builtin, reference.version)
    const evaluated = evaluateBuiltin(builtin.id, input, values, prefix)
    decorateFaces(evaluated, materials)
    return evaluated
  }
  const definition = definitions[reference.custom]
  if (!definition) throw new Error(`Missing part definition: ${reference.custom}`)
  if (ancestors.includes(reference.custom) || ancestors.length > 32) throw new Error('Cyclic or excessively deep part definitions')
  checkInput(definition.input, input)
  const parameters = parameterValues(definition.parameters, values)
  const slots = { ...definition.materialSlots, ...materials }
  const graph = evaluatePartGraph(definition.nodes, definitions, input, {}, parameters, slots, prefix, [...ancestors, reference.custom])
  const output = (nodeId: string, portId: string) => {
    const port = graph.nodes[nodeId]?.ports[portId]
    if (!port) throw new Error(`Unknown output: ${nodeId}/${portId}`)
    return port
  }
  return { ...graph, ports: Object.fromEntries(Object.entries(definition.outputs).map(([name, binding]) => [name, resolveBinding(binding, input, output)])) }
}

export function evaluatePartGraph(nodes: PartNode[], definitions: PartDefinitions, input?: PartPort,
  external: Record<string, Record<string, PartPort>> = {}, parameters: Record<string, number> = {},
  slots: Record<string, PartMaterial> = {}, prefix = '', ancestors: string[] = []): EvaluatedPartGraph {
  const evaluated: Record<string, PaperEvaluation> = {}, active = new Set<string>(), byId = new Map(nodes.map((node) => [node.id, node]))
  if (byId.size !== nodes.length) throw new Error('Duplicate part node id')
  const output = (nodeId: string, portId: string): PartPort => {
    if (external[nodeId]?.[portId]) return external[nodeId][portId]
    if (nodeId === '$input' && input) {
      if (portId === 'mount') return input
      if (input.kind === 'fold-pair' && (portId === 'a' || portId === 'b')) return { kind: 'surface', face: input[portId] }
      if (input.kind === 'surface' && portId === 'surface') return input
    }
    const result = visit(nodeId), port = result.ports[portId]
    if (!port) throw new Error(`Unknown output: ${nodeId}/${portId}`)
    return port
  }
  const visit = (id: string): PaperEvaluation => {
    if (evaluated[id]) return evaluated[id]
    if (active.has(id)) throw new Error(`Cyclic part connection: ${id}`)
    const node = byId.get(id)
    if (!node) throw new Error(`Unknown part node: ${id}`)
    active.add(id)
    const mount = resolveBinding(node.mount, input, output)
    const values = Object.fromEntries(Object.entries(node.parameters).map(([key, value]) => [key, evaluateExpression(value, parameters)]))
    const materials = Object.fromEntries(Object.entries(node.materials).map(([key, value]) => {
      if ('slot' in value && !slots[value.slot]) throw new Error(`Unknown material slot: ${value.slot}`)
      return [key, 'slot' in value ? slots[value.slot] : value]
    }))
    const result = evaluatePartReference(node.definition, mount, definitions, values, materials, prefix ? `${prefix}/${id}` : id, ancestors)
    if (node.outline) {
      if (node.outline.some(([u, v]) => u < 0 || u > 1 || v < 0 || v > 1)) throw new Error('Outline must stay within the material face')
      decorateFaces(result, {}, node.outline)
    }
    active.delete(id); evaluated[id] = result
    return result
  }
  for (const node of nodes) visit(node.id)
  return { nodes: evaluated, faces: Object.values(evaluated).flatMap((value) => value.faces),
    connections: Object.values(evaluated).flatMap((value) => value.connections), ports: {} }
}

export function dependentPartIds(nodes: Pick<PartNode, 'id' | 'mount'>[], id: string): Set<string> {
  const result = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) if (!result.has(node.id) && bindingDependencies(node.mount).some((parent) => result.has(parent))) {
      result.add(node.id); changed = true
    }
  }
  return result
}
