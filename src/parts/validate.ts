import { Vector3 } from 'three'
import { builtinPart } from './catalog'
import { evaluatePartReference } from './evaluate'
import { checkInput, faceContains, faceContainsLine, faceCorners, pagePorts, type PaperEvaluation, type PartPort } from './geometry'
import { parameterValues, partDefinitionSchema, type PartDefinition, type PartDefinitions, type PartInput } from './schema'

export interface PartValidation { ok: boolean; errors: string[]; checkedAngles: number[]; model: 'rigid-faces-ideal-hinges-v1' }
export const validationAngles = (max: number) => [...new Set([0, .001, .1, 1, ...Array.from({ length: 25 }, (_, i) => max * i / 24), max])].filter((angle) => angle <= max)

export function fixtureInput(input: PartInput, angle: number, size = 80): PartPort {
  const ports = pagePorts(size, size, angle * Math.PI / 180, 0)
  return input.kind === 'surface' ? ports['right-page'] : ports.gutter
}
export function inspectPaper(result: PaperEvaluation): string[] {
  const errors: string[] = []
  for (const face of result.faces) {
    if ([...face.origin, ...face.u, ...face.v, face.width, face.height].some((value) => !Number.isFinite(value))) errors.push(`Non-finite paper geometry: ${face.id}`)
    if (Math.abs(face.u.length() - 1) > 1e-6 || Math.abs(face.v.length() - 1) > 1e-6 || Math.abs(face.u.dot(face.v)) > 1e-6) errors.push(`Paper face is not rigid: ${face.id}`)
    if (face.outline?.some((point) => point.some((value) => value < 0 || value > 1))) errors.push(`Outline exceeds its material: ${face.id}`)
  }
  for (const connection of result.connections) {
    if (connection.actual.some((point, i) => point.distanceTo(connection.expected[i]) > 1e-6)) errors.push(`Broken paper connection: ${connection.childFace}`)
    const parent = result.faces.find((face) => face.id === connection.parentFace)
    if (parent && !connection.actual.every((point) => faceContains(parent, point))) errors.push(`Connection lies outside its supporting face: ${connection.childFace}`)
    for (const face of [parent, result.faces.find((item) => item.id === connection.childFace)]) {
      if (!face) continue
      for (let i = 1; i < connection.actual.length; i++) if (!faceContainsLine(face, connection.actual[i - 1], connection.actual[i])) {
        errors.push(`Outline cuts through an attachment: ${face.id}`)
      }
    }
  }
  return errors
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
      for (const angle of def.input.kind === 'fold-pair' ? validationAngles(def.input.maxOpeningAngleDeg) : [0]) {
        const result = evaluatePartReference({ custom: root }, fixtureInput(def.input, angle), all)
        report.checkedAngles.push(angle)
        report.errors.push(...inspectPaper(result))
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
