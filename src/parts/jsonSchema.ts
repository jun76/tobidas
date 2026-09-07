// 共有ファイルとWebMCPが使う公開JSON Schema。実行時の検証はschema.tsのZodを正本とする。
export const number = { type: 'number' }
export const string = { type: 'string' }
export const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required })
const record = (additionalProperties: unknown) => ({ type: 'object', additionalProperties })
const ref = (name: string) => ({ $ref: `#/$defs/${name}` })
const tuple2 = { type: 'array', items: number, minItems: 2, maxItems: 2 }
export const partJsonDefinitions = {
  input: { oneOf: [object({ kind: { const: 'surface' } }), object({ kind: { const: 'fold-pair' },
    maxOpeningAngleDeg: { type: 'number', exclusiveMinimum: 0, maximum: 180 }, referenceOpenAngleDeg: { type: 'number', minimum: 0, maximum: 180 } }, ['kind', 'maxOpeningAngleDeg'])] },
  reference: { oneOf: [object({ builtin: string, version: { type: 'integer', minimum: 1 } }), object({ custom: { type: 'string', pattern: '^[a-f0-9]{64}$' } })] },
  expression: { oneOf: [number, object({ parameter: string }), object({ op: { enum: ['add', 'multiply'] }, args: { type: 'array', items: ref('expression'), minItems: 2, maxItems: 16 } })] },
  parameter: object({ label: string, type: { enum: ['length', 'angle', 'number', 'integer'] }, default: number, min: number, max: number }),
  material: object({ color: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' }, image: string, backImage: string,
    text: { type: 'string', maxLength: 4000 }, textColor: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' } }, []),
  surfaceRef: object({ nodeId: string, portId: string }),
  binding: { oneOf: [object({ type: { const: 'input' }, face: { enum: ['a', 'b'] } }, ['type']),
    object({ type: { const: 'output' }, nodeId: string, portId: string }),
    object({ type: { const: 'pair' }, a: ref('surfaceRef'), b: ref('surfaceRef'),
      hingeA: { type: 'array', items: tuple2, minItems: 2, maxItems: 2 }, hingeB: { type: 'array', items: tuple2, minItems: 2, maxItems: 2 },
      directionA: { enum: ['positive', 'negative'] }, directionB: { enum: ['positive', 'negative'] }, foldSign: { enum: [1, -1] } }, ['type', 'a', 'b', 'hingeA', 'hingeB'])] },
  outline: { type: 'array', items: tuple2, minItems: 3, maxItems: 128 },
  node: object({ id: string, name: string, definition: ref('reference'), mount: ref('binding'), parameters: record(ref('expression')),
    materials: record({ oneOf: [ref('material'), object({ slot: string })] }), outline: ref('outline') }, ['id', 'name', 'definition', 'mount']),
  asset: object({ id: string, name: string, type: { enum: ['image', 'svg'] }, mime: string, bytes: { type: 'integer', minimum: 0 },
    width: number, height: number, hash: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, ['id', 'name', 'type', 'mime', 'bytes', 'hash']),
}
export const partDefinitionJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'tobidas reusable paper part, version 1', $defs: partJsonDefinitions,
  ...object({ format: { const: 'tobidas-part' }, schemaVersion: { const: 1 }, id: string, revision: { type: 'integer', minimum: 1 },
    name: string, description: string, author: string, license: string, derivedFrom: object({ id: string, revision: number, hash: string }),
    input: ref('input'), parameters: record(ref('parameter')), materialSlots: record(ref('material')), nodes: { type: 'array', items: ref('node'), maxItems: 200 },
    outputs: record(ref('binding')), dependencies: { type: 'array', items: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
    requiredBuiltins: record({ type: 'integer', minimum: 1 }), assets: { type: 'array', items: ref('asset') } }, ['format', 'schemaVersion', 'id', 'revision', 'name', 'input', 'nodes']),
}
export const partToolSchema = (properties: Record<string, unknown>, required = Object.keys(properties)) => {
  const schema = object(properties, required), definitions: Record<string, unknown> = {}
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const reference = (value as { $ref?: string }).$ref
    if (reference?.startsWith('#/$defs/')) {
      const name = reference.slice(8)
      if (!(name in definitions)) { definitions[name] = partJsonDefinitions[name as keyof typeof partJsonDefinitions]; visit(definitions[name]) }
    }
    Object.values(value).forEach(visit)
  }
  visit(schema)
  return Object.keys(definitions).length ? { ...schema, $defs: definitions } : schema
}
export { record, ref }
