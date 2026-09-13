import { Vector3 } from 'three'
import { z } from 'zod'
import { builtinPart } from './catalog'
import { dependentPartIds, evaluatedOutput, evaluatePartGraph, evaluatePartReference, resolveBinding } from './evaluate'
import { faceCorners, makeFace, openingAngle, pointOnFace, type PaperEvaluation, type PaperFace, type PartPort } from './geometry'
import { bindingDependencies, evaluateExpression, parameterValues, type PartDefinitions, type PartNode, type PartSurfaceRef, type PartMaterial } from './schema'
import { extensionFor, materialPoint } from './mountGeometry'
import { createPaperMotionInspector, inspectClosedLayout, validationAngles } from './validate'
import { inspectIntersections, nearbyPaperPairs } from './intersections'

export const partEditIntentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('translate'), delta: z.tuple([z.number().finite(), z.number().finite()]) }).strict(),
  z.object({ type: z.literal('rotate'), handle: z.string(), value: z.number().finite() }).strict(),
  z.object({ type: z.literal('scale'), value: z.number().finite().positive().max(100) }).strict(),
  z.object({ type: z.literal('parameters'), values: z.record(z.number().finite()) }).strict(),
])
export type PartEditIntent = z.infer<typeof partEditIntentSchema>
export interface PartEditScene {
  nodes: PartNode[]; definitions: PartDefinitions
  at: (angle: number) => { input?: PartPort; external?: Record<string, Record<string, PartPort>> }
  maxAngle: number; closedBounds?: { width: number; depth: number }
  validateContents?: (result: PaperEvaluation, nodes: PartNode[], angle: number) => string[]
  redesignSupports?: (nodes: PartNode[], affected: Set<string>) => void
  parameters?: Record<string, number>; slots?: Record<string, PartMaterial>
}
export interface PartEditAngle {
  id: string; label: string; parameter?: string; value: number; min: number; max: number; axis?: Vector3; pivot?: Vector3
  tilt?: { inputAngle: number; distance: number; supportHeight: number }
}
export interface PartEditDescription {
  pivot: Vector3; x: Vector3; y: Vector3; normal: Vector3; translateY: boolean
  angles: PartEditAngle[]; scale: number; size: [number, number, number]; input: PartPort
}
export type PartEditPlan = { ok: true; nodes: PartNode[]; affected: string[]; checkedAngles: number[] }
  | { ok: false; detail: string }

export function evaluateEditScene(scene: PartEditScene, nodes = scene.nodes, angle = scene.maxAngle) {
  const { input, external } = scene.at(angle)
  return evaluatePartGraph(nodes, scene.definitions, input, external, scene.parameters, scene.slots)
}
function resolver(scene: PartEditScene, nodes: PartNode[], angle: number) {
  const context = scene.at(angle), graph = evaluateEditScene(scene, nodes, angle)
  const output = (id: string, portId: string): PartPort => {
    if (context.external?.[id]?.[portId]) return context.external[id][portId]
    if (id === '$input' && context.input) {
      if (portId === 'mount') return context.input
      if (context.input.kind === 'surface' && portId === 'surface') return context.input
      if (context.input.kind === 'fold-pair' && (portId === 'a' || portId === 'b')) return { kind: 'surface', face: context.input[portId] }
    }
    const port = graph.nodes[id] && evaluatedOutput(graph.nodes[id], portId, id)
    if (!port) throw new Error(`Missing edit surface: ${id}/${portId}`)
    return port
  }
  return { ...context, graph, output }
}
function definitionOf(node: PartNode, definitions: PartDefinitions) {
  const def = 'builtin' in node.definition ? builtinPart(node.definition.builtin, node.definition.version) : definitions[node.definition.custom]
  if (!def) throw new Error('Missing edited part definition')
  return def
}
const numeric = (scene: PartEditScene, node: PartNode) => {
  const def = definitionOf(node, scene.definitions)
  const values = Object.fromEntries(Object.entries(node.parameters).map(([key, value]) => {
    return [key, evaluateExpression(value, scene.parameters ?? {})]
  }))
  return parameterValues(def.parameters, values)
}
function angleGeometry(operation: string, result: PaperEvaluation) {
  const input = result.inputPort, panel = result.ports.panel
  if (input?.kind !== 'fold-pair' || panel?.kind !== 'surface') return {}
  return { axis: operation === 'tiltAngle' ? input.axis : operation === 'splayAngle' ? panel.face.v : input.axis.clone().cross(input.rayA).normalize(),
    pivot: pointOnFace(panel.face, operation === 'tiltAngle' ? panel.face.width / 2 : 0, 0) }
}
function tiltDescription(operation: string, result: PaperEvaluation, p: Record<string, number>): Partial<PartEditAngle> {
  const input = result.inputPort, output = result.ports['ground-panel']
  return operation === 'tiltAngle' && input?.kind === 'fold-pair' && output?.kind === 'fold-pair'
    ? { value: openingAngle(output), min: 1, max: 179, tilt: { inputAngle: openingAngle(input), distance: p.distance, supportHeight: p.supportHeight } } : {}
}
function customAngleGeometry(reference: PartNode['definition'], id: string, result: PaperEvaluation, definitions: PartDefinitions, values: Record<string, number>, depth = 0): Partial<PartEditAngle> {
  if ('builtin' in reference) return { ...angleGeometry(id, result), ...tiltDescription(id, result, parameterValues(builtinPart(reference.builtin, reference.version).parameters, values)) }
  if (depth > 32) throw new Error('Edit handle nesting is too deep')
  const def = definitions[reference.custom], handle = def?.editHandles?.find((item) => item.id === id)
  const node = handle && def.nodes.find((item) => item.id === handle.nodeId), evaluated = node && result.nodes?.[node.id]
  const p = parameterValues(def.parameters, values)
  return node && handle && evaluated ? customAngleGeometry(node.definition, handle.operation, evaluated, definitions,
    Object.fromEntries(Object.entries(node.parameters).map(([key, expression]) => [key, evaluateExpression(expression, p)])), depth + 1) : {}
}
function boundsCenter(faces: PaperFace[], port: PartPort) {
  const points = faces.filter((face) => !face.support).flatMap(faceCorners)
  if (!points.length) throw new Error('Edited part has no material face')
  if (port.kind !== 'surface') return port.origin.clone()
  const uv = points.map((point) => materialPoint(port.face, point))
  return pointOnFace(port.face, ...[0, 1].map((axis) => (Math.min(...uv.map((p) => p[axis])) + Math.max(...uv.map((p) => p[axis]))) / 2) as [number, number])
}
export function describePartEdit(scene: PartEditScene, id: string): PartEditDescription {
  const node = scene.nodes.find((item) => item.id === id)
  if (!node) throw new Error('Edited part was not found')
  const { input, output, graph } = resolver(scene, scene.nodes, scene.maxAngle)
  const port = resolveBinding(node.mount, input, output), p = numeric(scene, node), scale = node.uniformScale ?? 1
  const pivot = boundsCenter(graph.nodes[id].faces, port)
  const basis = port.kind === 'surface' && node.mount.type === 'output' ? requireSurface(output(node.mount.nodeId, node.mount.portId)) : port.kind === 'surface' ? port.face : null
  const x = basis ? basis.u.clone() : port.kind === 'fold-pair' ? port.axis.clone() : port.face.u.clone()
  const y = basis ? basis.v.clone() : port.kind === 'fold-pair' ? port.rayA.clone() : port.face.v.clone()
  if (port.kind === 'fold-pair') pivot.addScaledVector(x, (p.offset ?? 0) * scale)
  const upright = 'builtin' in node.definition && node.definition.builtin === 'upright'
  if (port.kind === 'fold-pair' && upright) pivot.addScaledVector(y, p.distance * scale)
  const angles: PartEditAngle[] = []
  if (port.kind === 'surface') angles.push({ id: 'surface-angle', label: 'surfaceAngle', value: (node.mount.type === 'output' ? node.mount.frame?.rotationDeg ?? 0 : 0) + (p.rotation ?? 0), min: -180, max: 180 })
  if ('builtin' in node.definition) {
    for (const [parameter, label] of [['splayAngle', 'splayAngle'], ['tiltAngle', 'tiltAngle'], ['yawAngle', 'yawAngle']]) {
      const spec = definitionOf(node, scene.definitions).parameters[parameter]
      if (spec) {
        angles.push({ id: parameter, label, parameter,
          value: p[parameter], min: spec.min, max: spec.max, ...angleGeometry(parameter, graph.nodes[id]), ...tiltDescription(parameter, graph.nodes[id], p) })
      }
    }
  } else {
    const def = scene.definitions[node.definition.custom]
    for (const handle of def.editHandles ?? []) {
      const spec = def.parameters[handle.parameter]
      if (handle.kind === 'angle' && spec) angles.push({ id: handle.id, label: handle.label, parameter: handle.parameter,
        value: p[handle.parameter], min: spec.min, max: spec.max, ...customAngleGeometry(node.definition, handle.id, graph.nodes[id], scene.definitions, p) })
    }
  }
  const points = graph.nodes[id].faces.flatMap(faceCorners), normal = x.clone().cross(y).normalize()
  const size = [x, y, normal].map((axis) => {
    const values = points.map((point) => point.dot(axis))
    return Math.max(...values) - Math.min(...values)
  }) as [number, number, number]
  return { input: port, pivot, x, y, normal, translateY: port.kind === 'surface' || upright, angles, scale, size }
}

function sourceRef(face: PaperFace, scene: PartEditScene, resolve: ReturnType<typeof resolver>): PartSurfaceRef {
  for (const [id, ports] of Object.entries(resolve.external ?? {})) for (const [portId, port] of Object.entries(ports)) {
    if (port.kind === 'surface' && port.face.id === face.id) return { nodeId: id, portId }
  }
  if (resolve.input?.kind === 'surface' && resolve.input.face.id === face.id) return { nodeId: '$input', portId: 'surface' }
  if (resolve.input?.kind === 'fold-pair') for (const portId of ['a', 'b'] as const) if (resolve.input[portId].id === face.id) return { nodeId: '$input', portId }
  for (const node of scene.nodes) {
    const result = resolve.graph.nodes[node.id]
    if (!result) continue
    for (const [portId, port] of Object.entries(result.ports)) if (port.kind === 'surface' && port.face.id === face.id) return { nodeId: node.id, portId }
    if (result.faces.some((item) => item.id === face.id)) return { nodeId: node.id, portId: `face:${face.id.slice(node.id.length + 1)}` }
  }
  throw new Error(`The attachment has no stable material surface: ${face.id}`)
}
const requireSurface = (port: PartPort) => { if (port.kind !== 'surface') throw new Error('Expected a material surface'); return port.face }
const spacious = (face: PaperFace) => ({ ...makeFace(face.id, pointOnFace(face, -160, -160), face.u, face.v, 320, 320), support: face.support })

/** 接続面を保ち、実接着領域から支持を作り直す。既定寸法へ戻さない。 */
function remount(scene: PartEditScene, node: PartNode, prior: PartNode, ready: PartNode[], original: ReturnType<typeof resolver>, edit?: PartEditIntent) {
  const next = resolver(scene, ready, scene.maxAngle)
  const oldPort = resolveBinding(prior.mount, original.input, original.output)
  const p = numeric(scene, node), scale = node.uniformScale ?? 1
  const evaluate = (port: PartPort) => evaluatePartReference(node.definition, port, scene.definitions, p, {}, node.id, [], scale)
  if (oldPort.kind === 'surface') {
    const ref = prior.mount.type === 'output' ? { nodeId: prior.mount.nodeId, portId: prior.mount.portId } : sourceRef(oldPort.face, scene, original)
    const source = requireSurface(next.output(ref.nodeId, ref.portId)), oldSource = requireSurface(original.output(ref.nodeId, ref.portId))
    const oldCenter = boundsCenter(original.graph.nodes[node.id].faces, oldPort)
    const oldUV = materialPoint(oldSource, oldCenter)
    const target = pointOnFace(source, oldUV[0] * source.width / oldSource.width, oldUV[1] * source.height / oldSource.height)
    if (edit?.type === 'parameters' && 'builtin' in node.definition) {
      const before = numeric(scene, prior)
      target.addScaledVector(source.u, (p.u - before.u) * scale).addScaledVector(source.v, (p.v - before.v) * scale)
    }
    if (edit?.type === 'translate') target.addScaledVector(source.u, edit.delta[0]).addScaledVector(source.v, edit.delta[1])
    const frame = prior.mount.type === 'output' && prior.mount.frame ? structuredClone(prior.mount.frame)
      : { origin: materialPoint(oldSource, oldPort.face.origin), width: oldPort.face.width, height: oldPort.face.height, rotationDeg: 0 }
    const def = definitionOf(node, scene.definitions)
    const legacySpin = def.parameters.rotation && 'builtin' in node.definition ? p.rotation : 0
    frame.rotationDeg = edit?.type === 'rotate' && edit.handle === 'surface-angle' ? edit.value : (frame.rotationDeg ?? 0) + legacySpin
    if (legacySpin) { p.rotation = 0; node.parameters.rotation = 0 }
    const rad = (frame.rotationDeg ?? 0) * Math.PI / 180
    const u = source.u.clone().multiplyScalar(Math.cos(rad)).addScaledVector(source.v, Math.sin(rad))
    const v = source.v.clone().multiplyScalar(Math.cos(rad)).addScaledVector(source.u, -Math.sin(rad))
    // 入力の有限範囲と接着検査用の実面は分ける。寸法計測だけを広い面で行う。
    const probeFace = makeFace(`${node.id}/mount/frame`, pointOnFace(source, ...frame.origin), u, v, frame.width, frame.height)
    const broad = makeFace('probe', probeFace.origin.clone().addScaledVector(u, -160).addScaledVector(v, -160), u, v, 320, 320)
    probeFace.contactRegions = [broad]
    const first = evaluate({ kind: 'surface', face: probeFace })
    const shift = target.clone().sub(boundsCenter(first.faces, { kind: 'surface', face: probeFace }))
    probeFace.origin.add(shift); broad.origin.add(shift)
    frame.origin = materialPoint(source, probeFace.origin)
    const probe = evaluate({ kind: 'surface', face: probeFace })
    const glued = probe.faces.filter((face) => face.surfaceStack?.base.id === probeFace.id || probe.connections.some((c) => c.parentFace === probeFace.id && c.childFace === face.id))
    const polygons = glued.map((face) => (node.outline ?? face.outline ?? [[0, 0], [1, 0], [1, 1], [0, 1]])
      .map(([u, v]) => materialPoint(source, pointOnFace(face, u * face.width, v * face.height))))
    node.mount = { type: 'output', ...ref, frame, extension: extensionFor(source, polygons.flat(), { margin: 0, footprint: polygons.length === 1 ? polygons[0] : undefined }) }
    return
  }
  const oldBinding = prior.mount
  // 公開二面口も、その口が参照する実面二枚へ解決して取り付けを保存する。
  const aRef = oldBinding.type === 'pair' ? oldBinding.a : sourceRef(oldPort.a, scene, original)
  const bRef = oldBinding.type === 'pair' ? oldBinding.b : sourceRef(oldPort.b, scene, original)
  const oldA = requireSurface(original.output(aRef.nodeId, aRef.portId))
  const a = requireSurface(next.output(aRef.nodeId, aRef.portId)), b = requireSurface(next.output(bRef.nodeId, bRef.portId))
  const oldValues = numeric(scene, prior), oldScale = prior.uniformScale ?? 1
  const upright = 'builtin' in node.definition && node.definition.builtin === 'upright'
  const targetUV = materialPoint(oldA, oldPort.origin.clone().addScaledVector(oldPort.axis, (edit?.type === 'parameters' ? p.offset ?? 0 : oldValues.offset ?? 0) * oldScale)
    .addScaledVector(oldPort.rayA, upright ? (edit?.type === 'parameters' ? p.distance : oldValues.distance) * oldScale : 0))
  const target = pointOnFace(a, targetUV[0] * a.width / oldA.width, targetUV[1] * a.height / oldA.height)
  // 二面が平行になる全開時も含め、途中の実面から同じ材料折り線を求める。
  const sample = Math.min(scene.maxAngle, scene.maxAngle * .65 || 1)
  const probeResolve = resolver(scene, ready, sample)
  const pa = requireSurface(probeResolve.output(aRef.nodeId, aRef.portId)), pb = requireSurface(probeResolve.output(bRef.nodeId, bRef.portId))
  const na = pa.u.clone().cross(pa.v), nb = pb.u.clone().cross(pb.v), cross = na.clone().cross(nb)
  if (cross.lengthSq() < 1e-10) throw new Error('The selected material faces have no common driven hinge')
  const origin = nb.clone().cross(cross).multiplyScalar(na.dot(pa.origin))
    .addScaledVector(cross.clone().cross(na), nb.dot(pb.origin)).divideScalar(cross.lengthSq())
  const axis = cross.normalize()
  const oldAxisUV = [oldPort.axis.dot(oldA.u), oldPort.axis.dot(oldA.v)]
  if (axis.dot(pa.u.clone().multiplyScalar(oldAxisUV[0]).addScaledVector(pa.v, oldAxisUV[1])) < 0) axis.negate()
  const targetAtSample = pointOnFace(pa, ...materialPoint(a, target))
  origin.addScaledVector(axis, targetAtSample.clone().sub(origin).dot(axis))
  if (edit?.type === 'translate') origin.addScaledVector(axis, edit.delta[0])
  const sign = (face: PaperFace, oldFace: PaperFace, oldRay: Vector3) => {
    const desired = face.u.clone().multiplyScalar(oldRay.dot(oldFace.u)).addScaledVector(face.v, oldRay.dot(oldFace.v))
    return face.u.clone().cross(face.v).cross(axis).dot(desired) < 0 ? 'negative' as const : 'positive' as const
  }
  const oldB = requireSurface(original.output(bRef.nodeId, bRef.portId))
  const dirA = sign(pa, oldA, oldPort.rayA), dirB = sign(pb, oldB, oldPort.rayB)
  const rayA = na.clone().cross(axis).normalize().multiplyScalar(dirA === 'positive' ? 1 : -1)
  const rayB = nb.clone().cross(axis).normalize().multiplyScalar(dirB === 'positive' ? 1 : -1)
  if (p.offset !== undefined) { p.offset = 0; node.parameters.offset = 0 }
  if (upright) {
    p.distance = (targetAtSample.clone().sub(origin).dot(rayA) + (edit?.type === 'translate' ? edit.delta[1] : 0)) / scale
    node.parameters.distance = p.distance
  }
  const line = (face: PaperFace, width: number): [[number, number], [number, number]] => [materialPoint(face, origin.clone().addScaledVector(axis, -width / 2)), materialPoint(face, origin.clone().addScaledVector(axis, width / 2))]
  const input: PartPort = { kind: 'fold-pair', a: spacious(pa), b: spacious(pb), origin, axis, rayA, rayB,
    extentA: 160, extentB: 160, width: 160, foldSign: oldPort.foldSign }
  const probe = evaluate(input)
  const width = Math.max(.05, ...probe.faces.flatMap(faceCorners).map((point) => Math.abs(point.clone().sub(origin).dot(axis)) * 2))
  const hingeA = line(pa, width), hingeB = line(pb, width)
  const contacts = (face: PaperFace) => probe.connections.filter((edge) => edge.parentFace === face.id).flatMap((edge) => edge.expected.map((point) => materialPoint(face, point)))
  node.mount = { type: 'pair', a: aRef, b: bRef, hingeA, hingeB, directionA: dirA, directionB: dirB, foldSign: oldPort.foldSign,
    extensions: { a: extensionFor(pa, contacts(pa), { hinge: hingeA }), b: extensionFor(pb, contacts(pb), { hinge: hingeB }) } }
}

export function planPartEdit(scene: PartEditScene, id: string, raw: PartEditIntent, thorough = true): PartEditPlan {
  try {
    const intent = partEditIntentSchema.parse(raw), description = describePartEdit(scene, id)
    if (intent.type === 'translate' && !description.translateY && Math.abs(intent.delta[1]) > 1e-7) throw new Error('This part moves along its input hinge only')
    const affected = dependentPartIds(scene.nodes, id), original = resolver(scene, scene.nodes, scene.maxAngle)
    const nodes = structuredClone(scene.nodes), ready: PartNode[] = [], visiting = new Set<string>()
    const visit = (node: PartNode) => {
      if (ready.some((item) => item.id === node.id)) return
      if (visiting.has(node.id)) throw new Error('Cyclic edit dependency')
      visiting.add(node.id)
      for (const dep of bindingDependencies(node.mount)) { const parent = nodes.find((item) => item.id === dep); if (parent) visit(parent) }
      if (affected.has(node.id)) {
        if (node.id === id) {
          if (intent.type === 'scale') node.uniformScale = intent.value
          if (intent.type === 'parameters') {
            node.parameters = { ...node.parameters, ...intent.values }
            if (Object.keys(intent.values).some(key => /^support(Height|Width|Offset)$/.test(key))) delete node.supportDesign
          }
          if (intent.type === 'rotate') {
            const handle = description.angles.find((item) => item.id === intent.handle)
            if (!handle || intent.value < handle.min || intent.value > handle.max) throw new Error('Unsupported design angle')
            if (handle.parameter) {
              let value = intent.value
              if (handle.tilt) {
                // 画面上の実角度を固定長リンクへ逆算する。親の角度を90°へ換算しない。
                const theta = value * Math.PI / 180, phi = handle.tilt.inputAngle * Math.PI / 180
                const d = handle.tilt.distance, h = handle.tilt.supportHeight
                const back = d * h * (1 - Math.cos(theta)) / (d * (1 - Math.cos(phi)) + h * (1 - Math.cos(theta - phi)))
                const length = d + h - back, gap = Math.hypot(d, back)
                if (back <= 1e-7 || length <= 1e-7) throw new Error('The requested tilt has no flat-folding support')
                const along = (h * h - length * length + gap * gap) / (2 * gap)
                const square = h * h - along * along
                if (square < -1e-7) throw new Error('The requested tilt cannot be reached')
                const cosine = (-d * along + back * Math.sqrt(Math.max(0, square))) / (gap * h)
                value = Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI
              }
              node.parameters[handle.parameter] = value
            }
          }
        }
        remount(scene, node, scene.nodes.find((item) => item.id === node.id)!, ready, original, node.id === id ? intent : undefined)
      }
      ready.push(node); visiting.delete(node.id)
    }
    nodes.forEach(visit)
    scene.redesignSupports?.(nodes, affected)
    if (intent.type === 'rotate' && description.angles.find((angle) => angle.id === intent.handle)?.tilt) {
      const actual = describePartEdit({ ...scene, nodes }, id).angles.find((angle) => angle.id === intent.handle)!.value
      if (Math.abs(actual - intent.value) > 1e-5) throw new Error('The requested tilt is on a different folding branch')
    }
    const angles = thorough ? validationAngles(scene.maxAngle).sort((a, b) => a - b) : [...new Set([0, scene.maxAngle / 2, scene.maxAngle])]
    const checked = new Map<number, Vector3[]>(), nearby = new Map<number, string>()
    const inspectMotion = createPaperMotionInspector()
    const check = (angle: number) => {
      if (checked.has(angle)) return checked.get(angle)!
      if (checked.size >= 512) throw new Error('Folding check budget exceeded; candidate remains unverified')
      const context = scene.at(angle), roots = Object.values(context.external ?? {}).flatMap((ports) => Object.values(ports))
      if (context.input) roots.push(context.input)
      const result = evaluateEditScene(scene, nodes, angle), errors = inspectMotion(result, roots)
      if (angle === 0 && scene.closedBounds) errors.push(...inspectClosedLayout(result, scene.closedBounds.width, scene.closedBounds.depth))
      if (angle > .001) {
        const faces = [...new Map(roots.flatMap((port) => port.kind === 'surface' ? [port.face] : [port.a, port.b]).map((face) => [face.id, face])).values()]
        const withParents = { ...result, faces: [...result.faces, ...faces] }
        errors.push(...inspectIntersections(withParents, affected))
        if (thorough) nearby.set(angle, nearbyPaperPairs(withParents, affected))
      }
      errors.push(...scene.validateContents?.(result, nodes, angle) ?? [])
      if (errors.length) throw new Error(errors[0])
      const points = result.faces.flatMap(faceCorners); checked.set(angle, points)
      return points
    }
    angles.forEach(check)
    if (thorough) {
      const refine = (a: number, b: number, depth: number) => {
        if (b - a < .05) return
        const middle = (a + b) / 2, p = check(a), q = check(b), mid = check(middle)
        if (p.length !== q.length || p.length !== mid.length) throw new Error('Paper topology changes during folding')
        const curved = mid.some((point, i) => point.distanceTo(p[i].clone().lerp(q[i], .5)) > .015)
        const approaching = nearby.get(a) !== nearby.get(middle) || nearby.get(b) !== nearby.get(middle)
        if ((curved || approaching) && depth < 8) { refine(a, middle, depth + 1); refine(middle, b, depth + 1) }
      }
      for (let i = 1; i < angles.length; i++) refine(angles[i - 1], angles[i], 0)
    }
    return { ok: true, nodes, affected: [...affected], checkedAngles: [...checked.keys()].sort((a, b) => a - b) }
  } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : String(error) } }
}
