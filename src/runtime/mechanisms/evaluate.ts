import type { Vec3 } from '../../schema/geometry'
import type { MechanismKind, MechanismSpec } from '../../schema/mechanism'
export { mechanismSurfaceIds } from '../../schema/mechanism'

export interface MechanismSurfaceGeometry {
  id: string
  positions: number[]
  uvs: number[]
  /** 面上の取り付けUVとは別の、複数面に連続する画像用UV。 */
  textureUvs?: number[]
  indices: number[]
  normal: Vec3
  vertexIds: string[]
  support: boolean
  rigidity: 'rigid' | 'deformable'
}

export interface MechanismDiagnostic {
  code: string
  severity: 'warning' | 'error'
  message: string
  surfaceId?: string
}

export interface MechanismAnchor {
  id: string
  page: 'left' | 'right'
  position: Vec3
  target: Vec3
}

export interface EvaluatedMechanism {
  surfaces: MechanismSurfaceGeometry[]
  anchors: MechanismAnchor[]
  /** baseTransformの外ではなく、そのローカル空間に一度だけ合成する。 */
  rootTransform: { position: Vec3; scale: number }
  opacity: number
  drawn: boolean
  open: number
  openFactor: number
  diagnostics: MechanismDiagnostic[]
  bounds: { min: Vec3; max: Vec3 }
}

export interface MechanismEvaluationInput {
  open: number
  clock?: number
  /** 実ページの蝶番角。左π、右0が全開。省略時は左右対称に開く。 */
  leftAngle?: number
  rightAngle?: number
}

export interface SurfaceFrame {
  position: Vec3
  xAxis: Vec3
  yAxis: Vec3
  zAxis: Vec3
  /** three.js Matrix4.fromArrayへ渡せる列優先の剛体変換。Y軸が面法線。 */
  matrix: number[]
}

export interface MechanismDefinition {
  kind: MechanismKind
  mounts: MechanismSpec['mount']['type'][]
  constrainedMounts: MechanismSpec['mount']['type'][]
  deformation: 'rigid-fold' | 'connected-deformation' | 'mixed'
}

const clamp = (n: number) => Math.min(1, Math.max(0, n))
const smooth = (n: number) => { const u = clamp(n); return u * u * (3 - 2 * u) }
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a: Vec3, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const length = (a: Vec3) => Math.hypot(...a)
const unit = (a: Vec3, fallback: Vec3 = [1, 0, 0]): Vec3 => length(a) > 1e-10 ? mul(a, 1 / length(a)) : fallback
const rotateZ = (v: Vec3, angle: number): Vec3 => [v[0] * Math.cos(angle) - v[1] * Math.sin(angle), v[0] * Math.sin(angle) + v[1] * Math.cos(angle), v[2]]

export function getMechanismDefinition(kind: MechanismKind): MechanismDefinition {
  return {
    kind,
    mounts: ['page', 'gutter', 'surface', 'space'],
    constrainedMounts: kind === 'panel' ? ['page'] : ['v-fold', 'platform', 'box'].includes(kind) ? ['gutter'] : [],
    deformation: ['curved-shell'].includes(kind) ? 'connected-deformation' : ['box', 'platform'].includes(kind) ? 'mixed' : 'rigid-fold',
  }
}

/** 面上UVを実三角形へ写像する。曲面や折れた天板にも同じ経路を使う。 */
export function surfaceFrame(result: EvaluatedMechanism, id: string, u = .5, v = .5, offset = 0): SurfaceFrame | undefined {
  const surface = result.surfaces.find((candidate) => candidate.id === id)
  if (!surface) return undefined
  const positionAt = (i: number): Vec3 => surface.positions.slice(i * 3, i * 3 + 3) as Vec3
  let best: { points: Vec3[]; weights: number[]; tangent: Vec3; bitangent: Vec3; distance: number } | undefined
  for (let n = 0; n < surface.indices.length; n += 3) {
    const ids = surface.indices.slice(n, n + 3)
    const uv = ids.map((i) => [surface.uvs[i * 2], surface.uvs[i * 2 + 1]])
    const den = (uv[1][1] - uv[2][1]) * (uv[0][0] - uv[2][0]) + (uv[2][0] - uv[1][0]) * (uv[0][1] - uv[2][1])
    if (Math.abs(den) < 1e-12) continue
    const w0 = ((uv[1][1] - uv[2][1]) * (u - uv[2][0]) + (uv[2][0] - uv[1][0]) * (v - uv[2][1])) / den
    const w1 = ((uv[2][1] - uv[0][1]) * (u - uv[2][0]) + (uv[0][0] - uv[2][0]) * (v - uv[2][1])) / den
    const weights = [w0, w1, 1 - w0 - w1]
    const distance = weights.reduce((sum, weight) => sum + Math.max(0, -weight), 0)
    if (best && best.distance <= distance) continue
    const points = ids.map(positionAt)
    const edge1 = sub(points[1], points[0]), edge2 = sub(points[2], points[0])
    const du1 = uv[1][0] - uv[0][0], dv1 = uv[1][1] - uv[0][1]
    const du2 = uv[2][0] - uv[0][0], dv2 = uv[2][1] - uv[0][1]
    const inv = 1 / (du1 * dv2 - du2 * dv1)
    best = { points, weights, tangent: mul(sub(mul(edge1, dv2), mul(edge2, dv1)), inv), bitangent: mul(sub(mul(edge2, du1), mul(edge1, du2)), inv), distance }
  }
  if (!best) return undefined
  if (best.distance > 1e-10) {
    // 円形上面の外側を指すUVも、最寄り候補の面境界へ収める。
    const weights = best.weights.map((w) => Math.max(0, w))
    const total = weights.reduce((sum, w) => sum + w, 0)
    best.weights = weights.map((w) => w / total)
  }
  const xAxis = unit(best.tangent)
  const yAxis = unit(cross(best.bitangent, xAxis), surface.normal)
  const zAxis = unit(cross(xAxis, yAxis), [0, 0, 1])
  let position = best.points.reduce((sum, p, i) => add(sum, mul(p, best!.weights[i])), [0, 0, 0] as Vec3)
  position = add(position, mul(yAxis, offset))
  return { position, xAxis, yAxis, zAxis, matrix: [
    ...xAxis, 0, ...yAxis, 0, ...zAxis, 0, ...position, 1,
  ] }
}

class GeometryBuilder {
  vertices = new Map<string, Vec3>()
  surfaces: MechanismSurfaceGeometry[] = []
  vertex(id: string, p: Vec3) { this.vertices.set(id, p); return id }
  face(id: string, ids: string[], options: {
    uvs?: number[]; indices?: number[]; support?: boolean; rigidity?: 'rigid' | 'deformable'
  } = {}) {
    const points = ids.map((key) => this.vertices.get(key)!)
    const indices = options.indices ?? Array.from({ length: ids.length - 2 }, (_, i) => [0, i + 2, i + 1]).flat()
    let normal: Vec3 = [0, 1, 0]
    for (let i = 0; i < indices.length; i += 3) {
      const candidate = cross(sub(points[indices[i + 1]], points[indices[i]]), sub(points[indices[i + 2]], points[indices[i]]))
      if (length(candidate) > 1e-10) { normal = unit(candidate); break }
    }
    this.surfaces.push({
      id, positions: points.flat(), vertexIds: ids,
      uvs: options.uvs ?? (ids.length === 3 ? [0, 0, 1, 0, .5, 1] : [0, 0, 1, 0, 1, 1, 0, 1]),
      indices, normal, support: options.support ?? false, rigidity: options.rigidity ?? 'rigid',
    })
  }
}

/**
 * 頂点を面ごとに解き直さず、共有頂点辞書から全ての面を組み立てる。
 * 箱の外壁と二分割天面は剛体。前後の端面は接続を保つ紙風のせん断面とする。
 * この区別はrigidityへ残し、物理的な剛体箱が解けたと誤認させない。
 */
function boxGeometry(builder: GeometryBuilder, spec: MechanismSpec, u: number, rotation: number, anchors: MechanismAnchor[]) {
  const { width, height, depth } = spec.parameters
  const a = width / 2, theta = Math.PI * u / 2
  const sx = a * Math.sin(theta), by = a * Math.cos(theta)
  const put = (id: string, x: number, y: number, z: number) => builder.vertex(id, rotateZ([x, y, z], rotation))
  for (const [end, z] of [['front', depth / 2], ['back', -depth / 2]] as const) {
    put(`bottom-left-${end}`, -sx, by, z)
    put(`bottom-center-${end}`, 0, 0, z)
    put(`bottom-right-${end}`, sx, by, z)
    put(`top-left-${end}`, -sx, by + height, z)
    put(`top-center-${end}`, 0, height, z)
    put(`top-right-${end}`, sx, by + height, z)
    for (const side of ['left', 'right'] as const) {
      const id = `bottom-${side}-${end}`
      const position = builder.vertices.get(id)!
      anchors.push({ id, page: side, position, target: [...position] })
    }
    if (spec.kind === 'box') {
      builder.face(`${end}-left`, [`bottom-left-${end}`, `bottom-center-${end}`, `top-center-${end}`, `top-left-${end}`], { rigidity: 'deformable' })
      builder.face(`${end}-right`, [`bottom-center-${end}`, `bottom-right-${end}`, `top-right-${end}`, `top-center-${end}`], { rigidity: 'deformable' })
    }
  }
  builder.face('wall-left', ['bottom-left-back', 'bottom-left-front', 'top-left-front', 'top-left-back'], { support: true })
  builder.face('wall-right', ['bottom-right-front', 'bottom-right-back', 'top-right-back', 'top-right-front'], { support: true })
  if (spec.kind === 'platform') {
    builder.face('top', ['top-left-back', 'top-center-back', 'top-right-back', 'top-left-front', 'top-center-front', 'top-right-front'], {
      uvs: [0, 0, .5, 0, 1, 0, 0, 1, .5, 1, 1, 1],
      indices: [0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2], rigidity: 'deformable',
    })
  } else {
    builder.face('top-left', ['top-left-back', 'top-center-back', 'top-center-front', 'top-left-front'])
    builder.face('top-right', ['top-center-back', 'top-right-back', 'top-right-front', 'top-center-front'])
  }
}

function vFoldGeometry(builder: GeometryBuilder, spec: MechanismSpec, u: number, rotation: number, anchors: MechanismAnchor[]) {
  const { width, height, depth } = spec.parameters
  const a = width / 2, theta = Math.PI * u / 2
  const sx = a * Math.sin(theta), by = a * Math.cos(theta)
  const ridge = by + Math.sqrt(Math.max(0, height * height + a * a - sx * sx))
  for (const [end, z] of [['front', depth / 2], ['back', -depth / 2]] as const) {
    builder.vertex(`ridge-${end}`, rotateZ([0, ridge, z], rotation))
    for (const [side, x] of [['left', -sx], ['right', sx]] as const) {
      const id = `${side}-${end}`
      const position = rotateZ([x, by, z], rotation)
      builder.vertex(id, position)
      anchors.push({ id, page: side, position, target: [...position] })
    }
  }
  builder.face('wing-left', ['left-back', 'ridge-back', 'ridge-front', 'left-front'])
  builder.face('wing-right', ['ridge-back', 'right-back', 'right-front', 'ridge-front'])
}

function panelGeometry(builder: GeometryBuilder, spec: MechanismSpec, u: number) {
  const { width, height, angleDeg } = spec.parameters
  const theta = angleDeg * Math.PI / 180 * u
  builder.vertex('hinge-left', [-width / 2, 0, 0])
  builder.vertex('hinge-right', [width / 2, 0, 0])
  builder.vertex('outer-left', [-width / 2, height * Math.sin(theta), -height * Math.cos(theta)])
  builder.vertex('outer-right', [width / 2, height * Math.sin(theta), -height * Math.cos(theta)])
  builder.face('panel', ['hinge-left', 'hinge-right', 'outer-right', 'outer-left'])
}

function beakGeometry(builder: GeometryBuilder, spec: MechanismSpec, u: number) {
  const { width, height, angleDeg } = spec.parameters
  const theta = angleDeg * Math.PI / 360 * u
  builder.vertex('hinge-left', [-width / 2, 0, 0])
  builder.vertex('hinge-right', [width / 2, 0, 0])
  builder.vertex('upper-tip', [0, height * Math.sin(theta), height * Math.cos(theta)])
  builder.vertex('lower-tip', [0, -height * Math.sin(theta), height * Math.cos(theta)])
  builder.face('upper', ['hinge-left', 'hinge-right', 'upper-tip'])
  builder.face('lower', ['hinge-right', 'hinge-left', 'lower-tip'])
}

function accordionGeometry(builder: GeometryBuilder, spec: MechanismSpec, u: number) {
  const { width, height, segments, angleDeg } = spec.parameters
  const openAngle = (Math.PI - angleDeg * Math.PI / 180) / 2
  const angle = Math.PI / 2 + (openAngle - Math.PI / 2) * u
  const segmentWidth = width / (segments * Math.cos(openAngle))
  const xStep = segmentWidth * Math.cos(angle), zStep = segmentWidth * Math.sin(angle)
  for (let i = 0; i <= segments; i++) {
    const x = i * xStep - segments * xStep / 2
    const z = (i % 2 ? .5 : -.5) * zStep
    builder.vertex(`base-${i}`, [x, 0, z])
    builder.vertex(`upper-${i}`, [x, height, z])
    if (i > 0) builder.face(`fold-${i - 1}`, [`base-${i - 1}`, `base-${i}`, `upper-${i}`, `upper-${i - 1}`])
  }
}

function curvedGeometry(builder: GeometryBuilder, spec: MechanismSpec, u: number) {
  const { width, height, depth, segments } = spec.parameters
  const count = Math.max(8, segments * 2), theta = Math.PI * u / 2
  const rise = height * Math.sin(theta), shift = height * Math.cos(theta)
  builder.vertex('top-center', [shift, rise, 0])
  const capIds = ['top-center'], capUvs = [.5, .5], capIndices: number[] = []
  for (let i = 0; i < count; i++) {
    const angle = i / count * Math.PI * 2
    const x = width / 2 * Math.cos(angle)
    // 胴はレンズ形へ、縦辺は長さを保って横へ寝かせる。単なる高さ方向の潰しではない。
    const z = depth / 2 * Math.sin(angle) * Math.sin(theta)
    builder.vertex(`base-${i}`, [x, 0, z])
    builder.vertex(`rim-${i}`, [x + shift, rise, z])
    capIds.push(`rim-${i}`)
    capUvs.push(.5 + .5 * Math.cos(angle), .5 + .5 * Math.sin(angle))
    capIndices.push(0, (i + 1) % count + 1, i + 1)
  }
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count
    builder.face(`shell-${i}`, [`base-${i}`, `base-${next}`, `rim-${next}`, `rim-${i}`], { rigidity: 'deformable' })
    builder.surfaces[builder.surfaces.length - 1].textureUvs = [i / count, 0, (i + 1) / count, 0, (i + 1) / count, 1, i / count, 1]
  }
  builder.face('top', capIds, { uvs: capUvs, indices: capIndices, rigidity: 'deformable' })
}

export function evaluateMechanism(spec: MechanismSpec, input: MechanismEvaluationInput): EvaluatedMechanism {
  const physical = spec.deployment.mode === 'page-constrained'
  const open = clamp(input.open)
  const hasPageAngles = physical && input.leftAngle !== undefined && input.rightAngle !== undefined
  // 実駆動では汎用の進行値より実アンカーの二面角を優先する。
  const realOpen = hasPageAngles ? clamp((input.leftAngle! - input.rightAngle!) / Math.PI) : open
  const openFactor = physical ? realOpen : smooth((open - spec.deployment.start) / (spec.deployment.end - spec.deployment.start))
  const u = openFactor
  const rotation = physical && input.leftAngle !== undefined && input.rightAngle !== undefined
    ? (input.leftAngle + input.rightAngle) / 2 - Math.PI / 2 : 0
  const builder = new GeometryBuilder(), anchors: MechanismAnchor[] = []
  switch (spec.kind) {
    case 'panel': panelGeometry(builder, spec, u); break
    case 'v-fold': vFoldGeometry(builder, spec, u, rotation, anchors); break
    case 'beak': beakGeometry(builder, spec, u); break
    case 'platform': case 'box': boxGeometry(builder, spec, u, rotation, anchors); break
    case 'accordion': accordionGeometry(builder, spec, u); break
    case 'curved-shell': curvedGeometry(builder, spec, u); break
  }
  // targetは生成頂点からコピーせず、各ページの蝶番角と接着距離から独立に求める。
  // 仮想駆動でも同じ式を仮想支持面に対して使う。
  const targetAngles = {
    left: hasPageAngles ? input.leftAngle! : (1 + u) * Math.PI / 2,
    right: hasPageAngles ? input.rightAngle! : (1 - u) * Math.PI / 2,
  }
  for (const anchor of anchors) {
    const angle = targetAngles[anchor.page], distance = spec.parameters.width / 2
    anchor.target = [distance * Math.cos(angle), distance * Math.sin(angle), anchor.id.endsWith('front') ? spec.parameters.depth / 2 : -spec.parameters.depth / 2]
  }
  const stage = spec.staging
  const phase = (input.clock ?? 0) / stage.floatPeriod * Math.PI * 2 + stage.floatPhase
  const position: Vec3 = physical ? [0, 0, 0] : stage.closedPosition.map((n, axis) => n * (1 - openFactor)
    + stage.floatAmplitude[axis] * Math.sin(phase + axis * Math.PI / 3) * openFactor) as Vec3
  const scale = physical ? 1 : stage.closedScale + (1 - stage.closedScale) * openFactor
  const opacity = smooth((open - stage.fadeStart) / (stage.fadeEnd - stage.fadeStart))
  const all = [...builder.vertices.values()]
  const bounds = {
    min: [0, 1, 2].map((axis) => Math.min(...all.map((p) => p[axis] * scale + position[axis]))) as Vec3,
    max: [0, 1, 2].map((axis) => Math.max(...all.map((p) => p[axis] * scale + position[axis]))) as Vec3,
  }
  const result: EvaluatedMechanism = {
    surfaces: builder.surfaces, anchors, rootTransform: { position, scale },
    open, openFactor, opacity, drawn: opacity > 1e-6, bounds, diagnostics: [],
  }
  result.diagnostics = inspectMechanism(result)
  if (physical && spec.kind === 'box') result.diagnostics.push({
    code: 'deformable-endcaps', severity: 'warning',
    message: 'Box endcaps preserve seams by shearing; walls and split roof are rigid folds. Hide the endcaps for a purely rigid sleeve.',
  })
  return result
}

/** 折れ目の開きやUV破綻を、描画やカメラに依存せず検査する。 */
export function inspectMechanism(result: EvaluatedMechanism): MechanismDiagnostic[] {
  const diagnostics: MechanismDiagnostic[] = [], seen = new Map<string, Vec3>()
  for (const surface of result.surfaces) {
    if (surface.positions.some((n) => !Number.isFinite(n)) || surface.uvs.some((n) => !Number.isFinite(n))) {
      diagnostics.push({ code: 'non-finite-surface', severity: 'error', message: 'Surface has non-finite coordinates', surfaceId: surface.id })
    }
    if (surface.textureUvs && (surface.textureUvs.length !== surface.uvs.length || surface.textureUvs.some((n) => !Number.isFinite(n)))) {
      diagnostics.push({ code: 'invalid-texture-uv', severity: 'error', message: 'Surface has invalid texture UVs', surfaceId: surface.id })
    }
    if (surface.uvs.length * 3 !== surface.positions.length * 2 || surface.indices.some((i) => i < 0 || i * 3 >= surface.positions.length)) {
      diagnostics.push({ code: 'invalid-topology', severity: 'error', message: 'Surface has invalid mesh indices or UVs', surfaceId: surface.id })
    }
    surface.vertexIds.forEach((id, i) => {
      const p = surface.positions.slice(i * 3, i * 3 + 3) as Vec3, previous = seen.get(id)
      if (previous && length(sub(previous, p)) > 1e-7) diagnostics.push({ code: 'broken-seam', severity: 'error', message: `Shared vertex ${id} is separated`, surfaceId: surface.id })
      seen.set(id, p)
    })
  }
  for (const anchor of result.anchors) {
    if (length(sub(anchor.position, anchor.target)) > 1e-7) diagnostics.push({ code: 'broken-anchor', severity: 'error', message: `Page anchor ${anchor.id} is separated` })
  }
  if ([...result.rootTransform.position, result.rootTransform.scale, result.opacity, ...result.bounds.min, ...result.bounds.max].some((n) => !Number.isFinite(n))) {
    diagnostics.push({ code: 'non-finite-transform', severity: 'error', message: 'Mechanism has a non-finite transform or bounds' })
  }
  return diagnostics
}
