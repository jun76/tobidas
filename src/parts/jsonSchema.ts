// 共有ファイルとWebMCPが使う公開JSON Schema。実行時の検証はschema.tsのZodを正本とする。
export const number = { type: 'number' }
export const string = { type: 'string' }
export const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required })
const record = (additionalProperties: unknown) => ({ type: 'object', additionalProperties })
const ref = (name: string) => ({ $ref: `#/$defs/${name}` })
const tuple2 = { type: 'array', items: number, minItems: 2, maxItems: 2 }
const tuple3 = { type: 'array', items: number, minItems: 3, maxItems: 3 }
const boolean = { type: 'boolean' }
const contentCommon = {
  id: string, name: string, visible: boolean, opacity: { type: 'number', minimum: 0, maximum: 1 },
  attachment: ref('contentAttachment'), presentation: ref('presentation'),
  baseTransform: object({ position: tuple3, rotation: tuple3, scale: tuple3 }), pivot: tuple2,
  layer: number, motion: { type: 'array', items: ref('contentMotion') }, clock: { enum: ['inherit', 'visible-elapsed', 'story-time'] },
}
const contentRequired = ['id', 'name', 'type', 'attachment', 'presentation', 'baseTransform', 'pivot']
const particleProperties = { color: string, count: { type: 'integer', minimum: 1, maximum: 200 }, size: number, drift: number, period: number }
export const partJsonDefinitions = {
  shape: object({ outer: { type: 'array', items: tuple2, minItems: 3, maxItems: 256 },
    holes: { type: 'array', maxItems: 32, items: { type: 'array', items: tuple2, minItems: 3, maxItems: 256 } } }, ['outer']),
  contentAttachment: { oneOf: [object({ type: { const: 'surface' }, surface: ref('surfaceRef'), point: tuple2, side: { enum: ['front', 'back'] } }),
    object({ type: { const: 'visual' }, elementId: string })] },
  presentation: { oneOf: [object({ kind: { const: 'decal' } }), object({ kind: { const: 'fiction' }, closing: { enum: ['shrink-to-anchor', 'fade'] } })] },
  contentMotion: { oneOf: [
    ...['bob', 'sway', 'pulse'].map((type) => object({ type: { const: type }, amplitude: number, period: number, phase: number,
      ...(type === 'bob' ? { axis: { enum: ['x', 'y', 'z'] } } : {}) }, ['type', 'amplitude', 'period'])),
    object({ type: { const: 'drift' }, amplitude: tuple3, period: number, phase: number }, ['type', 'amplitude', 'period']),
    object({ type: { const: 'spin' }, axis: { enum: ['x', 'y', 'z'] }, speed: number }),
  ] },
  connectedContent: { oneOf: [
    object({ ...contentCommon, type: { const: 'visual' }, width: number, height: number, billboard: boolean,
      image: string, backImage: string, backgroundColor: string, foregroundColor: string, text: string, fontSize: number,
      align: { enum: ['left', 'center', 'right'] }, font: { enum: ['rounded', 'sans', 'serif', 'mono'] }, bold: boolean, italic: boolean, underline: boolean,
      particles: object({ ...particleProperties, enabled: boolean }, []),
      videoAudio: ref('videoAudio'), backVideoAudio: ref('videoAudio') }, [...contentRequired, 'width', 'height']),
    object({ ...contentCommon, type: { const: 'particle' }, width: number, height: number, billboard: boolean,
      particles: object(particleProperties, []) }, [...contentRequired, 'width', 'height', 'particles']),
    object({ ...contentCommon, type: { const: 'group' } }, contentRequired),
  ] },
  videoAudio: object({ enabled: boolean, volume: number, referenceDistance: number, rolloffFactor: number }),
  contentTrack: object({ id: string, target: object({ type: { const: 'element' }, elementId: string }), property: string,
    keys: { type: 'array', minItems: 1, items: object({ id: string, time: number, value: { oneOf: [number, string, boolean, tuple3] }, ease: { enum: ['linear', 'easeInOut', 'hold'] } }) } }),
  partContent: object({ element: ref('connectedContent'), tracks: { type: 'array', items: ref('contentTrack') } }, ['element']),
  contentEditIntent: { oneOf: [object({ type: { const: 'anchor' }, point: tuple2, offset: number }, ['type', 'point']),
    ...['position', 'rotation', 'scale'].map((type) => object({ type: { const: type }, value: tuple3 })),
    object({ type: { const: 'attachment' }, value: ref('contentAttachment') })] },
  input: { oneOf: [object({ kind: { const: 'surface' } }), object({ kind: { const: 'fold-pair' },
    maxOpeningAngleDeg: { type: 'number', exclusiveMinimum: 0, maximum: 180 }, referenceOpenAngleDeg: { type: 'number', minimum: 0, maximum: 180 } }, ['kind', 'maxOpeningAngleDeg'])] },
  reference: { oneOf: [object({ builtin: string, version: { type: 'integer', minimum: 1 } }), object({ custom: { type: 'string', pattern: '^[a-f0-9]{64}$' } })] },
  expression: { oneOf: [number, object({ parameter: string }), object({ op: { enum: ['add', 'multiply'] }, args: { type: 'array', items: ref('expression'), minItems: 2, maxItems: 16 } })] },
  parameter: object({ label: string, type: { enum: ['length', 'angle', 'number', 'integer'] }, default: number, min: number, max: number }),
  material: object({ color: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' }, image: string, backImage: string,
    text: { type: 'string', maxLength: 4000 }, textColor: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' } }, []),
  surfaceRef: object({ nodeId: string, portId: string }),
  extension: object({ min: tuple2, max: tuple2, panels: { type: 'array', maxItems: 16, items: object({ min: tuple2, max: tuple2, id: string, outline: ref('outline') }, ['min', 'max']) } }, ['min', 'max']),
  surfaceFrame: object({ origin: tuple2, width: { type: 'number', exclusiveMinimum: 0, maximum: 160 }, height: { type: 'number', exclusiveMinimum: 0, maximum: 160 }, rotationDeg: number }, ['origin', 'width', 'height']),
  uniformScale: { type: 'number', exclusiveMinimum: 0, maximum: 100 },
  editHandle: object({ id: string, kind: { const: 'angle' }, parameter: string, nodeId: string, operation: string, label: string }),
  editIntent: { oneOf: [object({ type: { const: 'translate' }, delta: tuple2 }), object({ type: { const: 'rotate' }, handle: string, value: number }),
    object({ type: { const: 'scale' }, value: ref('uniformScale') }), object({ type: { const: 'parameters' }, values: record(number) })] },
  binding: { oneOf: [object({ type: { const: 'input' }, face: { enum: ['a', 'b'] } }, ['type']),
    object({ type: { const: 'output' }, nodeId: string, portId: string, extension: ref('extension'), frame: ref('surfaceFrame') }, ['type', 'nodeId', 'portId']),
    object({ type: { const: 'pair' }, a: ref('surfaceRef'), b: ref('surfaceRef'),
      hingeA: { type: 'array', items: tuple2, minItems: 2, maxItems: 2 }, hingeB: { type: 'array', items: tuple2, minItems: 2, maxItems: 2 },
      directionA: { enum: ['positive', 'negative'] }, directionB: { enum: ['positive', 'negative'] }, foldSign: { enum: [1, -1] },
      extensions: object({ a: ref('extension'), b: ref('extension') }, []) }, ['type', 'a', 'b', 'hingeA', 'hingeB'])] },
  outline: { type: 'array', items: tuple2, minItems: 3, maxItems: 128 },
  node: object({ id: string, name: string, definition: ref('reference'), mount: ref('binding'), parameters: record(ref('expression')),
    materials: record({ oneOf: [ref('material'), object({ slot: string })] }), outline: ref('outline'), shapes: record(ref('shape')), uniformScale: ref('uniformScale') }, ['id', 'name', 'definition', 'mount']),
  asset: object({ id: string, name: string, type: { enum: ['image', 'svg', 'video'] }, mime: string, bytes: { type: 'integer', minimum: 0 },
    width: number, height: number, duration: number, hash: { type: 'string', pattern: '^[a-f0-9]{64}$' } }, ['id', 'name', 'type', 'mime', 'bytes', 'hash']),
}
export const partDefinitionJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'tobidas reusable paper part, version 2', $defs: partJsonDefinitions,
  ...object({ format: { const: 'tobidas-part' }, schemaVersion: { enum: [1, 2] }, id: string, revision: { type: 'integer', minimum: 1 },
    name: string, description: string, author: string, license: string, derivedFrom: object({ id: string, revision: number, hash: string }),
    input: ref('input'), parameters: record(ref('parameter')), materialSlots: record(ref('material')), nodes: { type: 'array', items: ref('node'), maxItems: 200 },
    outputs: record(ref('binding')), dependencies: { type: 'array', items: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
    requiredBuiltins: record({ type: 'integer', minimum: 1 }), assets: { type: 'array', items: ref('asset') },
    editHandles: { type: 'array', items: ref('editHandle'), maxItems: 32 }, contents: { type: 'array', items: ref('partContent'), maxItems: 400 } }, ['format', 'schemaVersion', 'id', 'revision', 'name', 'input', 'nodes']),
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
