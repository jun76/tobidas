import type { PartInput, PartParameter } from './schema'

export const BUILTIN_IDS = ['flat', 'text', 'backdrop', 'upright', 'angled-upright', 'v-fold', 'platform', 'folding-box', 'accordion', 'beak'] as const
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
// 保存済みの改訂と台・箱の内部リンクは、元の四節起立を明示的に参照する。
const backdropV1: BuiltinPart = { id: 'backdrop', version: 1, input: pair, parameters: dimensions,
  surfaces: ['panel', 'support', 'ground'], pairs: ['ground-backdrop'] }
export const BUILTIN_PARTS: BuiltinPart[] = [
  { id: 'flat', version: 1, input: { kind: 'surface' }, parameters: {
    width: length('width', 2), height: length('height', 1.5), u: number('u', 0, -40, 40), v: number('v', 1, -40, 40),
    rotation: { label: 'rotation', type: 'angle', default: 0, min: -180, max: 180 },
  }, surfaces: ['face'], pairs: [] },
  { id: 'text', version: 1, input: { kind: 'surface' }, parameters: {
    width: length('width', 2), height: length('height', .5), u: number('u', 0, -40, 40), v: number('v', 1, -40, 40),
    rotation: { label: 'rotation', type: 'angle', default: 0, min: -180, max: 180 },
  }, surfaces: ['face'], pairs: [] },
  { id: 'backdrop', version: 2, input: pair, parameters: {
    width: length('screenWidth', 14), height: length('height', 3.2), offset: number('offset', -1.2, -40, 40),
    splayAngle: { label: 'splayAngle', type: 'angle', default: 150, min: 20, max: 170 },
  }, surfaces: ['panel', 'panel-b', 'ground', 'ground-b'], pairs: ['ground-backdrop', 'ground-backdrop-b'] },
  { id: 'upright', version: 1, input: { kind: 'fold-pair', maxOpeningAngleDeg: 90, referenceOpenAngleDeg: 90 }, parameters: {
    ...dimensions, supportHeight: length('supportHeight', 1), supportWidth: length('supportWidth', .3),
    supportOffset: number('supportOffset', 0, -40, 40),
    tiltAngle: { label: 'tiltAngle', type: 'angle', default: 90, min: 30, max: 150 },
  }, surfaces: ['panel', 'support', 'ground'], pairs: ['ground-panel'] },
  { id: 'v-fold', version: 1, input: pair, parameters: dimensions,
    surfaces: ['wing-a', 'wing-b'], pairs: ['ridge'] },
  { id: 'angled-upright', version: 1, input: { kind: 'fold-pair', maxOpeningAngleDeg: 90, referenceOpenAngleDeg: 90 }, parameters: {
    ...widths, height: length('height', 1.5), yawAngle: { label: 'yawAngle', type: 'angle', default: 30, min: 5, max: 70 },
  }, surfaces: ['panel', 'support', 'ground'], pairs: ['ground-panel'] },
  { id: 'platform', version: 1, input: pair, parameters: dimensions,
    surfaces: ['panel', 'top', 'ground'], pairs: ['ground-panel', 'top-panel'] },
  // 両端が開いた四面の箱。端面を伸縮する旧モデルは使わない。
  { id: 'folding-box', version: 1, input: pair, parameters: dimensions,
    surfaces: ['panel', 'top', 'bottom', 'back', 'ground'], pairs: ['ground-panel', 'top-panel'] },
  { id: 'accordion', version: 1, input: { ...pair, referenceOpenAngleDeg: 90 }, parameters: {
    ...dimensions, segments: { label: 'segments', type: 'integer', default: 4, min: 2, max: 16 },
  }, surfaces: ['fold-0'], pairs: [] },
  { id: 'beak', version: 1, input: pair, parameters: dimensions,
    surfaces: ['wing-a', 'wing-b'], pairs: ['ridge'] },
]
export function builtinPart(id: string, version?: number): BuiltinPart {
  const definition = id === 'backdrop' && version === 1 ? backdropV1
    : BUILTIN_PARTS.find((item) => item.id === id && (version === undefined || item.version === version))
  if (!definition) throw new Error(`Unsupported builtin: ${id}@${version}`)
  return definition
}
