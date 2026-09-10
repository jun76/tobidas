import { Vector3 } from 'three'
import { builtinPart } from './catalog'
import { evaluatePartReference } from './evaluate'
import { checkInput, faceShape, faceContains, faceContainsLine, faceCorners, pagePorts, type PaperEvaluation, type PartPort } from './geometry'
import { parameterValues, partDefinitionSchema, type PartDefinition, type PartDefinitions, type PartInput } from './schema'
import { capturePaperDesign, comparePaperDesign, paperMaterialSurfaces, type PaperDesign } from './materialDesign'

import { inspectContentBindings, inspectContentsAt, inspectContentMotion } from './contentValidation'
import { inspectShape } from './shape'

export interface PartValidation { ok: boolean; errors: string[]; checkedAngles: number[]; model: 'rigid-faces-ideal-hinges-v1' }
export const validationAngles = (max: number) => [...new Set([0, .001, .1, 1, ...Array.from({ length: 25 }, (_, i) => max * i / 24), max])].filter((angle) => angle <= max)

export function fixtureInput(input: PartInput, angle: number, size = 80): PartPort {
  const ports = pagePorts(size, size, angle * Math.PI / 180, 0)
  return input.kind === 'surface' ? ports['right-page'] : ports.gutter
}
export function inspectPaper(result: PaperEvaluation, inputs: readonly PartPort[] = []): string[] {
  const errors: string[] = []
  const surfaces = paperMaterialSurfaces(result, inputs)
  for (const face of surfaces.values()) {
    errors.push(...inspectShape(faceShape(face)).map((message) => `${message}: ${face.id}`))
    if ([...face.origin, ...face.u, ...face.v, face.width, face.height].some((value) => !Number.isFinite(value))) errors.push(`Non-finite paper geometry: ${face.id}`)
    if (face.width <= 0 || face.height <= 0) errors.push(`Invalid paper dimensions: ${face.id}`)
    if (Math.abs(face.u.length() - 1) > 1e-6 || Math.abs(face.v.length() - 1) > 1e-6 || Math.abs(face.u.dot(face.v)) > 1e-6) errors.push(`Paper face is not rigid: ${face.id}`)
    if (face.outline?.some((point) => point.some((value) => !Number.isFinite(value) || value < 0 || value > 1))) errors.push(`Outline exceeds its material: ${face.id}`)
  }
  for (const connection of result.connections) {
    if (connection.actual.length < 2 || connection.actual.length !== connection.expected.length
      || [...connection.actual, ...connection.expected].some((point) => [...point].some((value) => !Number.isFinite(value)))) {
      errors.push(`Invalid paper connection: ${connection.childFace}`); continue
    }
    if (connection.actual.some((point, i) => point.distanceTo(connection.expected[i]) > 1e-6)) errors.push(`Broken paper connection: ${connection.childFace}`)
    const parent = surfaces.get(connection.parentFace)
    if (parent && !connection.actual.every((point) => faceContains(parent, point))) errors.push(`Connection lies outside its supporting face: ${connection.childFace}`)
    for (const face of [parent, surfaces.get(connection.childFace)]) {
      if (!face) continue
      for (let i = 1; i < connection.actual.length; i++) if (!faceContainsLine(face, connection.actual[i - 1], connection.actual[i])) {
        errors.push(`Outline cuts through an attachment: ${face.id}`)
      }
    }
  }
  return errors
}

/** 一回の配置検査で共有する。基準の形状を数値で写し、評価器による同一オブジェクトの更新も見逃さない。 */
export function createPaperMotionInspector() {
  let design: PaperDesign | undefined
  return (result: PaperEvaluation, inputs: readonly PartPort[] = []): string[] => {
    const errors = inspectPaper(result, inputs)
    if (errors.length) return errors
    try {
      const candidate = capturePaperDesign(result, inputs)
      if (design) errors.push(...comparePaperDesign(design, candidate))
      else design = candidate
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
    return errors
  }
}
export function validatePartDefinition(value: unknown, definitions: PartDefinitions = {}): PartValidation {
  const parsed = partDefinitionSchema.safeParse(value)
  const report: PartValidation = { ok: false, errors: [], checkedAngles: [], model: 'rigid-faces-ideal-hinges-v1' }
  if (!parsed.success) { report.errors = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`); return report }
  const def = parsed.data
  if (!def.nodes.length) report.errors.push('A reusable part must contain at least one connected node')
  if (def.input.kind === 'fold-pair' && (def.input.referenceOpenAngleDeg ?? 0) > def.input.maxOpeningAngleDeg) report.errors.push('Reference opening angle exceeds the input limit')
  try {
    parameterValues(def.parameters, {})
    const handleIds = new Set<string>()
    for (const handle of def.editHandles ?? []) {
      if (handleIds.has(handle.id)) throw new Error(`Duplicate edit handle: ${handle.id}`)
      handleIds.add(handle.id)
      const node = def.nodes.find((item) => item.id === handle.nodeId), specification = def.parameters[handle.parameter]
      if (!node || !specification || specification.type !== 'angle' || handle.kind !== 'angle') throw new Error(`Invalid edit handle: ${handle.id}`)
      let parameter: string | undefined
      if ('builtin' in node.definition) {
        const builtin = builtinPart(node.definition.builtin, node.definition.version)
        if (['splayAngle', 'tiltAngle', 'yawAngle'].includes(handle.operation) && builtin.parameters[handle.operation]?.type === 'angle') parameter = handle.operation
      } else parameter = definitions[node.definition.custom]?.editHandles?.find((item) => item.id === handle.operation && item.kind === 'angle')?.parameter
      const binding = parameter && node.parameters[parameter]
      if (!binding || typeof binding !== 'object' || !('parameter' in binding) || binding.parameter !== handle.parameter) throw new Error(`Edit handle is not bound to a supported internal operation: ${handle.id}`)
    }
    for (const [id, version] of Object.entries(def.requiredBuiltins)) builtinPart(id, version)
    for (const node of def.nodes) {
      if ('builtin' in node.definition) {
        builtinPart(node.definition.builtin, node.definition.version)
        if (def.requiredBuiltins[node.definition.builtin] !== node.definition.version) report.errors.push(`Undeclared builtin: ${node.definition.builtin}`)
      } else if (!def.dependencies.includes(node.definition.custom)) report.errors.push(`Undeclared dependency: ${node.definition.custom}`)
    }
    for (const hash of def.dependencies) if (!definitions[hash]) report.errors.push(`Missing dependency: ${hash}`)
    if (!report.errors.length) {
      const root = '__validation__'
      const all = { ...definitions, [root]: def }
      const inspectMotion = createPaperMotionInspector()
      for (const angle of def.input.kind === 'fold-pair' ? validationAngles(def.input.maxOpeningAngleDeg) : [0]) {
        const input = fixtureInput(def.input, angle), result = evaluatePartReference({ custom: root }, input, all)
        report.errors.push(...inspectContentBindings(result.contents ?? []), ...inspectContentsAt(result.contents ?? [], { openingAngleDeg: angle, maxOpeningAngleDeg: def.input.kind === 'fold-pair' ? def.input.maxOpeningAngleDeg : 180, holdTime: 0 }))
        if (angle === 0 || def.input.kind === 'fold-pair' && angle === def.input.maxOpeningAngleDeg || angle % 15 === 0) {
          const hold = Math.max(1, ...result.contents?.flatMap((bound) => bound.tracks.flatMap((track) => track.keys.map((key) => key.time))) ?? [])
          report.errors.push(...inspectContentMotion(result.contents ?? [], [...result.faces, ...(input.kind === 'surface' ? [input.face] : [input.a, input.b])],
            { openingAngleDeg: def.input.kind === 'surface' ? 180 : angle, maxOpeningAngleDeg: def.input.kind === 'surface' ? 180 : def.input.maxOpeningAngleDeg }, hold))
        }
        report.checkedAngles.push(angle)
        report.errors.push(...inspectMotion(result, [input]))
      }
    }
  } catch (error) { report.errors.push(String(error instanceof Error ? error.message : error)) }
  report.errors = [...new Set(report.errors)]; report.ok = report.errors.length === 0
  return report
}
export function syncDefinitionRequirements(definition: PartDefinition): void {
  definition.requiredBuiltins = {}
  definition.dependencies = []
  for (const node of definition.nodes) {
    if ('builtin' in node.definition) definition.requiredBuiltins[node.definition.builtin] = node.definition.version
    else if (!definition.dependencies.includes(node.definition.custom)) definition.dependencies.push(node.definition.custom)
  }
}

/** 閉状態で、実紙面の範囲から支持材を含む頂点が飛び出さないことを確認する。 */
export function inspectClosedLayout(result: PaperEvaluation, width: number, depth: number, direction = new Vector3(1, 0, 0)): string[] {
  const errors: string[] = []
  const normal = new Vector3(0, 0, 1).cross(direction)
  for (const face of result.faces) if (faceCorners(face).some((point) => Math.abs(point.dot(normal)) > 1e-5
    || point.dot(direction) < -1e-5 || point.dot(direction) > width + 1e-5 || Math.abs(point.z) > depth / 2 + 1e-5)) {
    errors.push(`Closed part exceeds its page: ${face.id}`)
  }
  return errors
}
