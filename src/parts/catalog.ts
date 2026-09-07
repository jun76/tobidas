import type { PartInput, PartParameter } from './schema'

export const BUILTIN_IDS = ['flat', 'text', 'backdrop', 'upright', 'v-fold', 'platform', 'folding-box', 'accordion', 'beak'] as const
export type BuiltinPartId = typeof BUILTIN_IDS[number]
export interface BuiltinPart {
  id: BuiltinPartId; version: number; input: PartInput; parameters: Record<string, PartParameter>
  surfaces: string[]; pairs: string[]
}
const length = (label: string, value: number, min = .05, max = 40): PartParameter => ({ label, type: 'length', default: value, min, max })
const number = (label: string, value: number, min: number, max: number): PartParameter => ({ label, type: 'number', default: value, min, max })
const widths = { width: length('width', 2), offset: number('offset', 0, -40, 40) }
const dimensions = { ...widths, height: length('height', 1.5), distance: length('distance', 1) }
const pair: PartInput = { kind: 'fold-pair', maxOpeningAngleDeg: 180 }
export const BUILTIN_PARTS: BuiltinPart[] = [
  { id: 'flat', version: 1, input: { kind: 'surface' }, parameters: {
    width: length('width', 2), height: length('height', 1.5), u: number('u', 0, -40, 40), v: number('v', 1, -40, 40),
    rotation: { label: 'rotation', type: 'angle', default: 0, min: -180, max: 180 },
  }, surfaces: ['face'], pairs: [] },
  { id: 'text', version: 1, input: { kind: 'surface' }, parameters: {
    width: length('width', 2), height: length('height', .5), u: number('u', 0, -40, 40), v: number('v', 1, -40, 40),
    rotation: { label: 'rotation', type: 'angle', default: 0, min: -180, max: 180 },
  }, surfaces: ['face'], pairs: [] },
  { id: 'backdrop', version: 1, input: pair, parameters: dimensions,
    surfaces: ['panel', 'support', 'ground'], pairs: ['ground-backdrop'] },
  { id: 'upright', version: 1, input: { ...pair, referenceOpenAngleDeg: 90 }, parameters: {
    ...dimensions, supportHeight: length('supportHeight', 1), supportWidth: length('supportWidth', .3),
  }, surfaces: ['panel', 'support', 'ground'], pairs: ['ground-panel'] },
  { id: 'v-fold', version: 1, input: pair, parameters: dimensions,
    surfaces: ['wing-a', 'wing-b'], pairs: ['ridge'] },
  { id: 'platform', version: 1, input: { ...pair, referenceOpenAngleDeg: 90 }, parameters: dimensions,
    surfaces: ['panel', 'top', 'ground'], pairs: ['ground-panel', 'top-panel'] },
  // 両端が開いた四面の箱。端面を伸縮する旧モデルは使わない。
  { id: 'folding-box', version: 1, input: { ...pair, referenceOpenAngleDeg: 90 }, parameters: dimensions,
    surfaces: ['panel', 'top', 'bottom', 'back', 'ground'], pairs: ['ground-panel', 'top-panel'] },
  { id: 'accordion', version: 1, input: { ...pair, referenceOpenAngleDeg: 90 }, parameters: {
    ...dimensions, segments: { label: 'segments', type: 'integer', default: 4, min: 2, max: 16 },
  }, surfaces: ['fold-0'], pairs: [] },
  { id: 'beak', version: 1, input: pair, parameters: dimensions,
    surfaces: ['wing-a', 'wing-b'], pairs: ['ridge'] },
]
export function builtinPart(id: string, version = 1): BuiltinPart {
  const definition = BUILTIN_PARTS.find((item) => item.id === id && item.version === version)
  if (!definition) throw new Error(`Unsupported builtin: ${id}@${version}`)
  return definition
}
