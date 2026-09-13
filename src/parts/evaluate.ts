import { builtinPart } from './catalog'
import { decorateFaces, evaluateBuiltin, fitUprightGroundContacts } from './builtins'
import { bindingDependencies, evaluateExpression, parameterValues, type PartBinding, type PartDefinitions,
  type PartMaterial, type PartNode, type PartReference } from './schema'
import { checkInput, EPSILON, faceContains, makeFace, pointOnFace, stackOnSurface, type BoundPaperContent, type PaperEvaluation, type PaperFace, type PartPort } from './geometry'
import type { Vector3 } from 'three'
import { extendPaperSurface } from './extensions'
import { paperSimilarity } from './similarity'
import { inspectShape } from './shape'

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

export function resolveBinding(binding: PartBinding, input: PartPort | undefined, output: (nodeId: string, portId: string) => PartPort,
  supports?: PaperEvaluation, prefix = 'mount'): PartPort {
  if (binding.type === 'input') {
    if (!input) throw new Error('Input is not connected to a real surface')
    if (!binding.face) return input
    if (input.kind !== 'fold-pair') throw new Error('Single surface input has no second face')
    return { kind: 'surface', face: input[binding.face] }
  }
  if (binding.type === 'output') {
    const port = output(binding.nodeId, binding.portId)
    if (!binding.extension && !binding.frame) return port
    const source = resolveSurface(port), extended = extendPaperSurface(source, binding.extension, `${prefix}/surface`, supports)
    if (!binding.frame) return { kind: 'surface', face: extended }
    const { origin, width, height, rotationDeg = 0 } = binding.frame
    const angle = rotationDeg * Math.PI / 180
    const u = source.u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(source.v, Math.sin(angle))
    const v = source.v.clone().multiplyScalar(Math.cos(angle)).addScaledVector(source.u, -Math.sin(angle))
    const face = makeFace(`${prefix}/frame`, pointOnFace(source, ...origin), u, v, width, height)
    face.surfaceStack = stackOnSurface(extended)
    face.contactRegions = extended.contactRegions ?? [source]
    if (supports) supports.contactSurfaces = [...supports.contactSurfaces ?? [], source, face]
    return { kind: 'surface', face }
  }
  const sourceA = resolveSurface(output(binding.a.nodeId, binding.a.portId)), sourceB = resolveSurface(output(binding.b.nodeId, binding.b.portId))
  const a = extendPaperSurface(sourceA, binding.extensions?.a, `${prefix}/a`, supports)
  const b = extendPaperSurface(sourceB, binding.extensions?.b, `${prefix}/b`, supports)
  const pa = binding.hingeA.map(([u, v]) => pointOnFace(sourceA, u, v)), pb = binding.hingeB.map(([u, v]) => pointOnFace(sourceB, u, v))
  // 延長した二面の交線は仮想でもよいが、材料座標が全角度で一致する必要がある。
  // 部品の接着辺は、下流のglueとinspectPaperが実際の支持紙まで検査する。
  // 交線は駆動を定義する仮想線。足の間の切り抜きを横切ってもよく、実接着は下流で別途検査する。
  const hingeWithin = (face: PaperFace, point: Vector3) => faceContains({ ...face, contactRegions: undefined, shape: undefined, outline: undefined }, point)
  if (pa.some((point, i) => point.distanceTo(pb[i]) > EPSILON) || !pa.every((point) => hingeWithin(a, point))
    || !pb.every((point) => hingeWithin(b, point))) throw new Error('The two material hinge lines must coincide on the actual faces')
  const width = pa[0].distanceTo(pa[1])
  if (width < EPSILON) throw new Error('Hinge line has zero length')
  const axis = pa[1].clone().sub(pa[0]).normalize()
  const rayA = a.u.clone().cross(a.v).cross(axis).normalize().multiplyScalar(binding.directionA === 'positive' ? 1 : -1)
  const rayB = b.u.clone().cross(b.v).cross(axis).normalize().multiplyScalar(binding.directionB === 'positive' ? 1 : -1)
  return { kind: 'fold-pair', a, b, origin: pa[0].clone().add(pa[1]).multiplyScalar(.5), axis, rayA, rayB, width,
    extentA: Math.min(...pa.map((point) => rayExtent(a, point, rayA))), extentB: Math.min(...pb.map((point) => rayExtent(b, point, rayB))),
    foldSign: binding.foldSign }
}

/** 公開面を優先し、キャンバスで選んだ実面にも安定した材料面IDで接続する。 */
export function evaluatedOutput(result: PaperEvaluation, portId: string, prefix: string): PartPort | undefined {
  if (result.ports[portId]) return result.ports[portId]
  const face = portId.startsWith('face:') && result.faces.find((item) => item.id === `${prefix}/${portId.slice(5)}`)
  return face ? { kind: 'surface', face } : undefined
}

export function evaluatePartReference(reference: PartReference, input: PartPort, definitions: PartDefinitions,
  values: Record<string, number> = {}, materials: Record<string, PartMaterial> = {}, prefix = 'part', ancestors: string[] = [], uniformScale = 1): PaperEvaluation {
  if (!Number.isFinite(uniformScale) || uniformScale <= 0 || uniformScale > 100) throw new Error('Invalid uniform part scale')
  if (uniformScale !== 1) {
    const center = input.kind === 'surface' ? input.face.origin : input.origin
    const scaledInput = paperSimilarity(center, 1 / uniformScale).port(input)
    return paperSimilarity(center, uniformScale).evaluation(evaluatePartReference(reference, scaledInput, definitions, values, materials, prefix, ancestors))
  }
  if ('builtin' in reference) {
    const builtin = builtinPart(reference.builtin, reference.version)
    const evaluated = evaluateBuiltin(builtin.id, input, values, prefix, builtin.version)
    decorateFaces(evaluated, materials)
    return evaluated
  }
  const definition = definitions[reference.custom]
  if (!definition) throw new Error(`Missing part definition: ${reference.custom}`)
  if (ancestors.includes(reference.custom) || ancestors.length > 32) throw new Error('Cyclic or excessively deep part definitions')
  checkInput(definition.input, input)
  for (const name of Object.keys(materials)) if (!(name in definition.materialSlots)) throw new Error(`Unknown public material slot: ${name}`)
  const parameters = parameterValues(definition.parameters, values)
  const slots = { ...definition.materialSlots, ...materials }
  const graph = evaluatePartGraph(definition.nodes, definitions, input, {}, parameters, slots, prefix, [...ancestors, reference.custom])
  const output = (nodeId: string, portId: string): PartPort => {
    if (nodeId === '$input') {
      if (portId === 'mount') return input
      if (input.kind === 'fold-pair' && (portId === 'a' || portId === 'b')) return { kind: 'surface', face: input[portId] }
      if (input.kind === 'surface' && portId === 'surface') return input
    }
    const node = graph.nodes[nodeId]
    const port = node && evaluatedOutput(node, portId, `${prefix}/${nodeId}`)
    if (!port) throw new Error(`Unknown output: ${nodeId}/${portId}`)
    return port
  }
  const ports = Object.fromEntries(Object.entries(definition.outputs).map(([name, binding]) =>
    [name, resolveBinding(binding, input, output, graph, `${prefix}/output/${name}`)]))
  const contents: BoundPaperContent[] = (definition.contents ?? []).map(({ element, tracks }) => {
    const attachment = element.attachment
    const face = attachment.type === 'surface' ? resolveSurface(output(attachment.surface.nodeId, attachment.surface.portId)) : undefined
    return { id: prefix + '/content/' + element.id, ownerId: prefix.split('/')[0], element, tracks, face, unitScale: 1,
      parentId: attachment.type === 'visual' ? prefix + '/content/' + attachment.elementId : undefined }
  })
  return { ...graph, ports, contents: [...graph.contents ?? [], ...contents] }
}

export function evaluatePartGraph(nodes: PartNode[], definitions: PartDefinitions, input?: PartPort,
  external: Record<string, Record<string, PartPort>> = {}, parameters: Record<string, number> = {},
  slots: Record<string, PartMaterial> = {}, prefix = '', ancestors: string[] = []): EvaluatedPartGraph {
  const evaluated: Record<string, PaperEvaluation> = {}, active = new Set<string>(), byId = new Map(nodes.map((node) => [node.id, node]))
  if (byId.size !== nodes.length) throw new Error('Duplicate part node id')
  if (nodes.some((node) => node.id.startsWith('$'))) throw new Error('Part node ID is reserved')
  const output = (nodeId: string, portId: string): PartPort => {
    if (external[nodeId]?.[portId]) return external[nodeId][portId]
    if (nodeId === '$input' && input) {
      if (portId === 'mount') return input
      if (input.kind === 'fold-pair' && (portId === 'a' || portId === 'b')) return { kind: 'surface', face: input[portId] }
      if (input.kind === 'surface' && portId === 'surface') return input
    }
    const result = visit(nodeId), port = evaluatedOutput(result, portId, prefix ? `${prefix}/${nodeId}` : nodeId)
    if (!port) throw new Error(`Unknown output: ${nodeId}/${portId}`)
    return port
  }
  const visit = (id: string): PaperEvaluation => {
    if (evaluated[id]) return evaluated[id]
    if (active.has(id)) throw new Error(`Cyclic part connection: ${id}`)
    const node = byId.get(id)
    if (!node) throw new Error(`Unknown part node: ${id}`)
    active.add(id)
    const supports: PaperEvaluation = { faces: [], connections: [], ports: {} }
    const mount = resolveBinding(node.mount, input, output, supports, `${prefix ? `${prefix}/` : ''}${id}/mount`)
    const values = Object.fromEntries(Object.entries(node.parameters).map(([key, value]) => [key, evaluateExpression(value, parameters)]))
    const materials = Object.fromEntries(Object.entries(node.materials).map(([key, value]) => {
      if ('slot' in value && !slots[value.slot]) throw new Error(`Unknown material slot: ${value.slot}`)
      return [key, 'slot' in value ? slots[value.slot] : value]
    }))
    const result = evaluatePartReference(node.definition, mount, definitions, values, materials, prefix ? `${prefix}/${id}` : id, ancestors, node.uniformScale)
    result.inputPort = mount
    result.faces.push(...supports.faces); result.connections.push(...supports.connections)
    result.contactSurfaces = [...result.contactSurfaces ?? [], ...supports.contactSurfaces ?? []]
    if (node.outline) {
      if (node.outline.some(([u, v]) => u < 0 || u > 1 || v < 0 || v > 1)) throw new Error('Outline must stay within the material face')
      decorateFaces(result, {}, node.outline)
    }
    for (const [faceId, shape] of Object.entries(node.shapes ?? {})) {
      const target = result.faces.find((face) => face.id === (prefix ? prefix + '/' : '') + id + '/' + faceId)
      if (!target || target.support) throw new Error('Unknown or supporting material face: ' + faceId)
      const errors = inspectShape(shape); if (errors.length) throw new Error(errors.join('; '))
      target.shape = shape
    }
    if ('builtin' in node.definition && node.definition.builtin === 'upright') fitUprightGroundContacts(result)
    active.delete(id); evaluated[id] = result
    return result
  }
  for (const node of nodes) visit(node.id)
  return { nodes: evaluated, contents: Object.values(evaluated).flatMap((value) => value.contents ?? []), faces: Object.values(evaluated).flatMap((value) => value.faces),
    connections: Object.values(evaluated).flatMap((value) => value.connections),
    contactSurfaces: Object.values(evaluated).flatMap((value) => value.contactSurfaces ?? []), ports: {} }
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
