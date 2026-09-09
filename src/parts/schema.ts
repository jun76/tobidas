import { z } from 'zod'
import { assetSchema, type Asset } from '../schema/assets'

const finite = z.number().finite()
const id = z.string().min(1).max(200)
export const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const opening = finite.positive().max(180)
export const partInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('surface') }),
  z.object({ kind: z.literal('fold-pair'), maxOpeningAngleDeg: opening,
    referenceOpenAngleDeg: finite.min(0).max(180).optional() }),
])
export const partReferenceSchema = z.union([
  z.object({ builtin: id, version: z.number().int().positive() }).strict(),
  z.object({ custom: contentHashSchema }).strict(),
])
export type PartExpression = number | { parameter: string } | { op: 'add' | 'multiply'; args: PartExpression[] }
export const partExpressionSchema: z.ZodType<PartExpression> = z.lazy(() => z.union([
  finite, z.object({ parameter: id }).strict(),
  z.object({ op: z.enum(['add', 'multiply']), args: z.array(partExpressionSchema).min(2).max(16) }).strict(),
]))
export const partParameterSchema = z.object({
  label: id, type: z.enum(['length', 'angle', 'number', 'integer']), default: finite, min: finite, max: finite,
})
export const partMaterialSchema = z.object({
  color: z.string().regex(/^#[\da-fA-F]{6}$/).optional(), image: id.optional(), backImage: id.optional(),
  text: z.string().max(4000).optional(), textColor: z.string().regex(/^#[\da-fA-F]{6}$/).optional(),
}).strict()
export const partMaterialValueSchema = z.union([partMaterialSchema, z.object({ slot: id }).strict()])
export const partSurfaceRefSchema = z.object({ nodeId: id, portId: id }).strict()
const point2 = z.tuple([finite, finite])
// 取り付け時に補完する支持面の範囲。親の材料座標に固定し、途中姿勢は保存しない。
const extensionPanel = z.object({ min: point2, max: point2, id: id.optional(), outline: z.array(point2).min(3).max(128).optional() }).strict()
export const partExtensionSchema = extensionPanel.extend({ panels: z.array(extensionPanel).max(16).optional() }).strict()
// 一面カスタム部品の入力原点。仮想の紙を描かず、接着は実面と補完支持紙で検査する。
export const partSurfaceFrameSchema = z.object({ origin: point2, width: finite.positive().max(160), height: finite.positive().max(160), rotationDeg: finite.optional() }).strict()
export const partEditHandleSchema = z.object({ id, kind: z.literal('angle'), parameter: id,
  nodeId: id, operation: id, label: id }).strict()
// 材料座標の線分を両面で指定する。描画用UVとは独立した接続である。
export const partBindingSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), face: z.enum(['a', 'b']).optional() }).strict(),
  z.object({ type: z.literal('output'), nodeId: id, portId: id, extension: partExtensionSchema.optional(), frame: partSurfaceFrameSchema.optional() }).strict(),
  z.object({ type: z.literal('pair'), a: partSurfaceRefSchema, b: partSurfaceRefSchema,
    hingeA: z.tuple([point2, point2]), hingeB: z.tuple([point2, point2]),
    directionA: z.enum(['positive', 'negative']).default('positive'),
    directionB: z.enum(['positive', 'negative']).default('positive'),
    foldSign: z.union([z.literal(1), z.literal(-1)]).default(1),
    extensions: z.object({ a: partExtensionSchema.optional(), b: partExtensionSchema.optional() }).strict().optional(),
  }).strict(),
])
export const partNodeSchema = z.object({
  id, name: id, definition: partReferenceSchema, mount: partBindingSchema,
  parameters: z.record(partExpressionSchema).default({}),
  materials: z.record(partMaterialValueSchema).default({}),
  uniformScale: finite.positive().max(100).optional(),
  // 切り抜き輪郭は面の寸法で正規化した材料座標。支持面の輪郭は変更しない。
  outline: z.array(point2).min(3).max(128).optional(),
})
export const partAssetSchema = assetSchema.extend({ hash: contentHashSchema })
export const partDefinitionSchema = z.object({
  format: z.literal('tobidas-part'), schemaVersion: z.literal(1), id, revision: z.number().int().positive(),
  name: id, description: z.string().default(''), author: z.string().default(''), license: z.string().default(''),
  derivedFrom: z.object({ id, revision: z.number().int().positive(), hash: contentHashSchema }).optional(),
  input: partInputSchema, parameters: z.record(partParameterSchema).default({}),
  materialSlots: z.record(partMaterialSchema).default({}), nodes: z.array(partNodeSchema).max(200),
  outputs: z.record(partBindingSchema).default({}), dependencies: z.array(contentHashSchema).default([]),
  requiredBuiltins: z.record(z.number().int().positive()).default({}), assets: z.array(partAssetSchema).default([]),
  editHandles: z.array(partEditHandleSchema).max(32).optional(),
})
export const partInstanceSchema = z.object({
  definition: partReferenceSchema, mount: partBindingSchema,
  parameters: z.record(finite).default({}), materials: z.record(partMaterialSchema).default({}),
  uniformScale: finite.positive().max(100).optional(),
})
export type PartInput = z.infer<typeof partInputSchema>
export type PartExtension = z.infer<typeof partExtensionSchema>
export type PartSurfaceRef = z.infer<typeof partSurfaceRefSchema>
export type PartReference = z.infer<typeof partReferenceSchema>
export type PartBinding = z.infer<typeof partBindingSchema>
export type PartMaterial = z.infer<typeof partMaterialSchema>
export type PartParameter = z.infer<typeof partParameterSchema>
export type PartNode = z.infer<typeof partNodeSchema>
export type PartDefinition = z.infer<typeof partDefinitionSchema>
export type PartInstance = z.infer<typeof partInstanceSchema>
export type PartDefinitions = Record<string, PartDefinition>
export interface PartBundle { definition: PartDefinition; definitions: PartDefinitions; assets: Asset[] }

export function newPartDefinition(name: string, input: PartInput = { kind: 'fold-pair', maxOpeningAngleDeg: 180 }): PartDefinition {
  return partDefinitionSchema.parse({ format: 'tobidas-part', schemaVersion: 1, id: crypto.randomUUID(), revision: 1, name, input, nodes: [] })
}

export function bindingDependencies(binding: PartBinding): string[] {
  if (binding.type === 'input') return []
  return binding.type === 'output' ? [binding.nodeId] : [binding.a.nodeId, binding.b.nodeId]
}

export function evaluateExpression(expression: PartExpression, values: Record<string, number>, depth = 0): number {
  if (depth > 16) throw new Error('Parameter expression is too deep')
  const result = typeof expression === 'number' ? expression : 'parameter' in expression
    ? values[expression.parameter] : expression.args.map((item) => evaluateExpression(item, values, depth + 1))
      .reduce((a, b) => expression.op === 'add' ? a + b : a * b)
  if (!Number.isFinite(result)) throw new Error('Parameter expression must resolve to a finite number')
  return result
}

export function parameterValues(parameters: Record<string, PartParameter>, overrides: Record<string, number>): Record<string, number> {
  for (const key of Object.keys(overrides)) if (!parameters[key]) throw new Error(`Unknown parameter: ${key}`)
  return Object.fromEntries(Object.entries(parameters).map(([key, p]) => {
    const value = overrides[key] ?? p.default
    if (!Number.isFinite(value) || p.min > p.max || value < p.min || value > p.max || (p.type === 'integer' && !Number.isInteger(value))) {
      throw new Error(`Parameter out of range: ${key}`)
    }
    return [key, value]
  }))
}
