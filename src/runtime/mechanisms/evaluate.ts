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
  surfaceId: string
  expected: ConnectionExpected
}

export type ConnectionExpected = { type: 'page'; side: 'left' | 'right'; distance: number; z: number }
  | { type: 'surface'; elementId: string; surfaceId: string; weights: { vertexId: string; weight: number }[] }
export type BridgePointName = 'leftBack' | 'creaseBack' | 'rightBack' | 'leftFront' | 'creaseFront' | 'rightFront'
export interface DriverPoint { position: Vec3; expected: ConnectionExpected }
export interface MechanismDriver {
  points: Record<BridgePointName, DriverPoint>
  restWidth: number
  restDepth: number
  restAngle: number
  xAxis: Vec3
  yAxis: Vec3
  zAxis: Vec3
  /** 片面の起立片だけは、その面に固定されたヒンジを持つ。 */
  panel?: { angle: number }
}
export interface EvaluatedBridge {
  id: 'deck'
  restWidth: number
  restDepth: number
  restAngle: number
  points: Record<BridgePointName, { position: Vec3; surfaceId: string; weights: { vertexId: string; weight: number }[] }>
  xAxis: Vec3
  yAxis: Vec3
  zAxis: Vec3
}

export interface EvaluatedMechanism {
  surfaces: MechanismSurfaceGeometry[]
  anchors: MechanismAnchor[]
  bridges: EvaluatedBridge[]
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
  driver?: MechanismDriver
}

export interface SurfaceFrame {
  position: Vec3
  xAxis: Vec3
  yAxis: Vec3
  zAxis: Vec3
  /** three.js Matrix4.fromArrayへ渡せる列優先の剛体変換。Y軸が面法線。 */
  matrix: number[]
  weights: { vertexId: string; weight: number }[]
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
    mounts: kind === 'panel' ? ['page', 'gutter', 'surface', 'bridge'] : ['gutter', 'bridge'],
    constrainedMounts: kind === 'panel' ? ['page', 'gutter', 'surface', 'bridge'] : ['gutter', 'bridge'],
    deformation: ['curved-shell'].includes(kind) ? 'connected-deformation' : ['box', 'platform'].includes(kind) ? 'mixed' : 'rigid-fold',
  }
}

/** 面上UVを実三角形へ写像する。曲面や折れた天板にも同じ経路を使う。 */
export function surfaceFrame(result: EvaluatedMechanism, id: string, u = .5, v = .5, offset = 0): SurfaceFrame | undefined {
  const surface = result.surfaces.find((candidate) => candidate.id === id)
  if (!surface) return undefined
  const positionAt = (i: number): Vec3 => surface.positions.slice(i * 3, i * 3 + 3) as Vec3
  let best: { ids: number[]; points: Vec3[]; weights: number[]; tangent: Vec3; bitangent: Vec3; distance: number } | undefined
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
    best = { ids, points, weights, tangent: mul(sub(mul(edge1, dv2), mul(edge2, dv1)), inv), bitangent: mul(sub(mul(edge2, du1), mul(edge1, du2)), inv), distance }
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
  return { position, xAxis, yAxis, zAxis, weights: best.ids.map((id, i) => ({ vertexId: surface.vertexIds[id], weight: best!.weights[i] })), matrix: [
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

export const bridgePointNames: BridgePointName[] = ['leftBack', 'creaseBack', 'rightBack', 'leftFront', 'creaseFront', 'rightFront']
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => add(mul(a, 1 - t), mul(b, t))

/** ページの実角度と紙面距離から、左右面上の6点を作る。 */
export function gutterDriver(spec: MechanismSpec, leftAngle: number, rightAngle: number, z = 0): MechanismDriver {
  const { width, depth } = spec.parameters
  const mean = (leftAngle + rightAngle) / 2 - Math.PI / 2
  const points = {} as MechanismDriver['points']
  for (const name of bridgePointNames) {
    const side = name.startsWith('left') ? 'left' : 'right'
    const distance = name.startsWith('crease') ? 0 : width / 2
    const angle = side === 'left' ? leftAngle : rightAngle
    const pointZ = z + (name.endsWith('Back') ? -depth / 2 : depth / 2)
    points[name] = { position: [distance * Math.cos(angle), distance * Math.sin(angle), pointZ],
      expected: { type: 'page', side, distance, z: pointZ } }
  }
  return { points, restWidth: width, restDepth: depth, restAngle: Math.PI,
    xAxis: rotateZ([1, 0, 0], mean), yAxis: rotateZ([0, 1, 0], mean), zAxis: [0, 0, 1] }
}

/** 子の駆動量は、受け取った実面の二面角から毎回測る。親の進行値は使わない。 */
export function driverOpening(driver: MechanismDriver): number {
  if (driver.panel) return clamp(driver.panel.angle / Math.PI)
  const c = driver.points.creaseBack.position
  const l = unit(sub(driver.points.leftBack.position, c)), r = unit(sub(driver.points.rightBack.position, c))
  return clamp(Math.acos(Math.max(-1, Math.min(1, dot(l, r)))) / Math.max(1e-9, driver.restAngle))
}

/** 幅・奥行きの全開実寸で、親の現在の左右面を切り出す。 */
export function driverFromBridge(bridge: EvaluatedBridge, spec: MechanismSpec, parentId: string): MechanismDriver {
  const { width, depth } = spec.parameters
  if (width > bridge.restWidth + 1e-7 || depth > bridge.restDepth + 1e-7) throw new RangeError('Bridge attachment dimensions exceed the parent deck; use explicit openScale for a larger payload')
  const widthRatio = width / bridge.restWidth, depthRatio = depth / bridge.restDepth
  const v = spec.mount.type === 'bridge' ? spec.mount.v : .5
  const t0 = (1 - depthRatio) * v, t1 = t0 + depthRatio
  type P = EvaluatedBridge['points'][BridgePointName]
  const blend = (a: P, b: P, t: number, surfaceId = b.surfaceId): P => {
    const weights = new Map<string, number>()
    for (const [point, factor] of [[a, 1 - t], [b, t]] as const) for (const w of point.weights) weights.set(w.vertexId, (weights.get(w.vertexId) ?? 0) + w.weight * factor)
    return { position: mix(a.position, b.position, t), surfaceId, weights: [...weights].map(([vertexId, weight]) => ({ vertexId, weight })) }
  }
  const points = {} as MechanismDriver['points']
  for (const side of ['left', 'crease', 'right'] as const) {
    const back = side === 'crease' ? bridge.points.creaseBack : blend(bridge.points.creaseBack, bridge.points[`${side}Back`], widthRatio)
    const front = side === 'crease' ? bridge.points.creaseFront : blend(bridge.points.creaseFront, bridge.points[`${side}Front`], widthRatio)
    for (const [end, t] of [['Back', t0], ['Front', t1]] as const) {
      const p = blend(back, front, t)
      points[`${side}${end}`] = { position: p.position, expected: { type: 'surface', elementId: parentId, surfaceId: p.surfaceId, weights: p.weights } }
    }
  }
  return { points, restWidth: width, restDepth: depth, restAngle: bridge.restAngle,
    xAxis: bridge.xAxis, yAxis: bridge.yAxis, zAxis: bridge.zAxis }
}

/**
 * 基部は実ページまたは親の二面に固定する。
 * 演出する頂点群だけを動かし、固定基部との間は明示的な伸縮支持面でつなぐ。
 */
export function evaluateMechanism(spec: MechanismSpec, input: MechanismEvaluationInput): EvaluatedMechanism {
  const open = clamp(input.open)
  const missingDriver = (spec.mount.type === 'bridge' || spec.mount.type === 'surface') && !input.driver
  const driver = input.driver ?? gutterDriver(spec, input.leftAngle ?? Math.PI, input.rightAngle ?? (1 - open) * Math.PI)
  const measured = driverOpening(driver)
  const openFactor = driver.panel ? clamp(driver.panel.angle / (spec.parameters.angleDeg * Math.PI / 180)) : measured
  const builder = new GeometryBuilder(), anchors: MechanismAnchor[] = []
  const diagnostics: MechanismDiagnostic[] = []
  const empty = (): EvaluatedMechanism => ({ surfaces: [], anchors: [], bridges: [], rootTransform: { position: [0, 0, 0], scale: 1 },
    open, openFactor: 0, opacity: 0, drawn: false, bounds: { min: [0, 0, 0], max: [0, 0, 0] }, diagnostics })
  if (missingDriver) { diagnostics.push({ code: 'missing-driver', severity: 'error', message: 'A child mechanism requires evaluated attachment geometry' }); return empty() }
  const { width, depth, segments, angleDeg } = spec.parameters
  const edgeTotal = length(sub(driver.points.leftBack.position, driver.points.creaseBack.position))
    + length(sub(driver.points.rightBack.position, driver.points.creaseBack.position))
  const inheritedScale = driver.panel
    ? length(sub(driver.points.rightBack.position, driver.points.leftBack.position)) / Math.max(1e-9, driver.restWidth)
    : edgeTotal * Math.sin(driver.restAngle / 2) / Math.max(1e-9, driver.restWidth)
  const height = spec.parameters.height * inheritedScale
  const stage = spec.staging
  const origin = mix(driver.points.creaseBack.position, driver.points.creaseFront.position, .5)
  const phase = (input.clock ?? 0) / stage.floatPeriod * Math.PI * 2 + stage.floatPhase
  const scale = stage.closedScale + (stage.openScale - stage.closedScale) * smooth(openFactor)
  const displacement = stage.closedPosition.map((n, axis) => n * (1 - openFactor) + stage.openPosition[axis] * openFactor
    + stage.floatAmplitude[axis] * Math.sin(phase + axis * Math.PI / 3) * openFactor) as Vec3
  const offset = add(add(mul(driver.xAxis, displacement[0]), mul(driver.yAxis, displacement[1])), mul(driver.zAxis, displacement[2]))
  const payload = (p: Vec3) => add(add(origin, mul(sub(p, origin), scale)), offset)
  const put = (id: string, p: Vec3) => builder.vertex(id, payload(p))
  const base = (name: BridgePointName) => driver.points[name].position
  for (const name of bridgePointNames) {
    const point = driver.points[name]
    builder.vertex(`anchor-${name}`, point.position)
    put(`base-${name}`, point.position)
    const side = name.startsWith('left') ? 'left' : name.startsWith('crease') ? 'center' : 'right'
    anchors.push({ id: `anchor-${name}`, surfaceId: `mount-${side}`, page: side === 'left' ? 'left' : 'right',
      position: point.position, target: point.position, expected: point.expected })
  }
  for (const [side, key] of [['left', 'left'], ['center', 'crease'], ['right', 'right']] as const) {
    builder.face(`mount-${side}`, [`anchor-${key}Back`, `anchor-${key}Front`, `base-${key}Front`, `base-${key}Back`], { support: true, rigidity: 'deformable' })
  }
  builder.face('base-left', ['base-leftBack', 'base-creaseBack', 'base-creaseFront', 'base-leftFront'], { support: true })
  builder.face('base-right', ['base-creaseBack', 'base-rightBack', 'base-rightFront', 'base-creaseFront'], { support: true })
  const up = mul(driver.yAxis, height)
  const sampleBase = (x: number, z: number): Vec3 => {
    const end = (suffix: 'Back' | 'Front') => mix(base(`crease${suffix}`), base(`${x < 0 ? 'left' : 'right'}${suffix}`), Math.abs(x))
    return mix(end('Back'), end('Front'), z)
  }
  if (spec.kind === 'box' || spec.kind === 'platform') {
    for (const name of bridgePointNames) put(`top-${name}`, add(base(name), up))
    for (const end of ['Back', 'Front'] as const) if (spec.kind === 'box') {
      const label = end.toLowerCase()
      builder.face(`${label}-left`, [`base-left${end}`, `base-crease${end}`, `top-crease${end}`, `top-left${end}`], { rigidity: 'deformable' })
      builder.face(`${label}-right`, [`base-crease${end}`, `base-right${end}`, `top-right${end}`, `top-crease${end}`], { rigidity: 'deformable' })
    }
    builder.face('wall-left', ['base-leftBack', 'base-leftFront', 'top-leftFront', 'top-leftBack'], { support: true })
    builder.face('wall-right', ['base-rightFront', 'base-rightBack', 'top-rightBack', 'top-rightFront'], { support: true })
    if (spec.kind === 'box') {
      builder.face('top-left', ['top-leftBack', 'top-creaseBack', 'top-creaseFront', 'top-leftFront'])
      builder.face('top-right', ['top-creaseBack', 'top-rightBack', 'top-rightFront', 'top-creaseFront'])
    } else builder.face('top', ['top-leftBack', 'top-creaseBack', 'top-rightBack', 'top-leftFront', 'top-creaseFront', 'top-rightFront'],
      { uvs: [0, 0, .5, 0, 1, 0, 0, 1, .5, 1, 1, 1], indices: [0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2], rigidity: 'deformable' })
  } else if (spec.kind === 'v-fold') {
    for (const end of ['Back', 'Front'] as const) {
      const l = base(`left${end}`), r = base(`right${end}`), halfGap = length(sub(r, l)) / 2
      put(`ridge-${end}`, add(mix(l, r, .5), mul(driver.yAxis, Math.sqrt(Math.max(0, height * height + (width * inheritedScale) ** 2 / 4 - halfGap * halfGap)))))
    }
    builder.face('wing-left', ['base-leftBack', 'ridge-Back', 'ridge-Front', 'base-leftFront'])
    builder.face('wing-right', ['ridge-Back', 'base-rightBack', 'base-rightFront', 'ridge-Front'])
  } else if (spec.kind === 'panel') {
    const theta = driver.panel?.angle ?? angleDeg * Math.PI / 180 * openFactor
    const rise = add(mul(driver.yAxis, height * Math.sin(theta)), mul(driver.zAxis, -height * Math.cos(theta)))
    for (const [i, side] of ['left', 'crease', 'right'].entries()) {
      const p = sampleBase(i - 1, .5)
      put(`hinge-${side}`, p); put(`outer-${side}`, add(p, rise))
    }
    builder.face('panel', ['hinge-left', 'hinge-crease', 'hinge-right', 'outer-left', 'outer-crease', 'outer-right'],
      { uvs: [0, 0, .5, 0, 1, 0, 0, 1, .5, 1, 1, 1], indices: [0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2], rigidity: 'deformable' })
  } else if (spec.kind === 'beak') {
    const theta = angleDeg * Math.PI / 360 * openFactor
    const lift = mul(driver.yAxis, height * Math.sin(theta))
    for (const side of ['left', 'crease', 'right'] as const) put(`jaw-${side}`, add(sampleBase(side === 'left' ? -1 : side === 'right' ? 1 : 0, 0), lift))
    put('tip-lower', sampleBase(0, 1)); put('tip-upper', add(sampleBase(0, 1), mul(lift, 2)))
    for (const [name, tip] of [['upper', 'tip-upper'], ['lower', 'tip-lower']] as const) builder.face(name, ['jaw-left', 'jaw-crease', 'jaw-right', tip],
      { uvs: [0, 0, .5, 0, 1, 0, .5, 1], indices: [0, 3, 1, 1, 3, 2], rigidity: 'deformable' })
    builder.face('jaw-support-left', ['base-leftBack', 'base-creaseBack', 'jaw-crease', 'jaw-left'], { support: true, rigidity: 'deformable' })
    builder.face('jaw-support-right', ['base-creaseBack', 'base-rightBack', 'jaw-right', 'jaw-crease'], { support: true, rigidity: 'deformable' })
  } else if (spec.kind === 'accordion') {
    for (let i = 0; i <= segments; i++) {
      const p = sampleBase(i / segments * 2 - 1, i % 2)
      put(`fold-base-${i}`, p); put(`fold-top-${i}`, add(p, up))
      if (i) {
        builder.face(`fold-${i - 1}`, [`fold-base-${i - 1}`, `fold-base-${i}`, `fold-top-${i}`, `fold-top-${i - 1}`], { rigidity: 'deformable' })
        builder.surfaces[builder.surfaces.length - 1].textureUvs = [(i - 1) / segments, 0, i / segments, 0, i / segments, 1, (i - 1) / segments, 1]
      }
    }
  } else {
    const count = Math.max(8, segments * 2)
    put('top-center', add(sampleBase(0, .5), up))
    const ids = ['top-center'], uvs = [.5, .5], indices: number[] = []
    for (let i = 0; i < count; i++) {
      const theta = i / count * Math.PI * 2, x = Math.cos(theta), z = .5 + Math.sin(theta) / 2
      const p = sampleBase(x, z)
      put(`base-ring-${i}`, p); put(`rim-${i}`, add(p, up))
      ids.push(`rim-${i}`); uvs.push(.5 + x / 2, z); indices.push(0, (i + 1) % count + 1, i + 1)
    }
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count
      builder.face(`shell-${i}`, [`base-ring-${i}`, `base-ring-${next}`, `rim-${next}`, `rim-${i}`], { rigidity: 'deformable' })
      builder.surfaces[builder.surfaces.length - 1].textureUvs = [i / count, 0, (i + 1) / count, 0, (i + 1) / count, 1, i / count, 1]
    }
    builder.face('top', ids, { uvs, indices, rigidity: 'deformable' })
  }
  const opacity = smooth((open - stage.fadeStart) / (stage.fadeEnd - stage.fadeStart))
  const all = [...builder.vertices.values()]
  const result: EvaluatedMechanism = { surfaces: builder.surfaces, anchors, bridges: [], rootTransform: { position: [0, 0, 0], scale: 1 },
    open, openFactor, opacity, drawn: opacity > 1e-6, diagnostics,
    bounds: { min: [0, 1, 2].map((axis) => Math.min(...all.map((p) => p[axis]))) as Vec3,
      max: [0, 1, 2].map((axis) => Math.max(...all.map((p) => p[axis]))) as Vec3 } }
  const points = {} as EvaluatedBridge['points']
  const direct = (name: BridgePointName, surfaceId: string, vertexId: string) => { points[name] = { position: builder.vertices.get(vertexId)!, surfaceId, weights: [{ vertexId, weight: 1 }] } }
  if (spec.kind === 'box' || spec.kind === 'platform') {
    for (const name of bridgePointNames) direct(name, spec.kind === 'platform' ? 'top' : name.startsWith('right') ? 'top-right' : 'top-left', `top-${name}`)
  } else if (spec.kind === 'v-fold') {
    for (const name of bridgePointNames) direct(name, name.startsWith('right') ? 'wing-right' : 'wing-left', name.startsWith('crease') ? `ridge-${name.endsWith('Back') ? 'Back' : 'Front'}` : `base-${name}`)
  } else if (spec.kind === 'curved-shell') {
    for (const name of bridgePointNames) {
      const u = name.startsWith('left') ? .18 : name.startsWith('right') ? .82 : .5, v = name.endsWith('Back') ? .18 : .82
      const frame = surfaceFrame(result, 'top', u, v)!
      points[name] = { position: frame.position, surfaceId: 'top', weights: frame.weights }
    }
  }
  if (Object.keys(points).length) result.bridges.push({ id: 'deck', points,
    restWidth: width * stage.openScale * (spec.kind === 'curved-shell' ? .64 : 1),
    restDepth: depth * stage.openScale * (spec.kind === 'curved-shell' ? .64 : 1),
    restAngle: spec.kind === 'v-fold' ? 2 * Math.atan2(width / 2, spec.parameters.height) : driver.restAngle,
    xAxis: driver.xAxis, yAxis: driver.yAxis, zAxis: driver.zAxis })
  result.diagnostics.push(...inspectMechanism(result))
  if (['box', 'beak', 'accordion', 'curved-shell'].includes(spec.kind)) result.diagnostics.push({ code: 'connected-deformation', severity: 'warning', message: 'Some faces deform while their attachment geometry remains connected' })
  return result
}

/** 共有頂点と接着点を調べる。世界座標の実ページ・親面との照合はscene監査が行う。 */
export function inspectMechanism(result: EvaluatedMechanism): MechanismDiagnostic[] {
  const diagnostics: MechanismDiagnostic[] = [], seen = new Map<string, Vec3>()
  for (const surface of result.surfaces) {
    if (surface.positions.some((n) => !Number.isFinite(n)) || surface.uvs.some((n) => !Number.isFinite(n))) diagnostics.push({ code: 'non-finite-surface', severity: 'error', message: 'Surface has non-finite coordinates', surfaceId: surface.id })
    if (surface.textureUvs && (surface.textureUvs.length !== surface.uvs.length || surface.textureUvs.some((n) => !Number.isFinite(n)))) diagnostics.push({ code: 'invalid-texture-uv', severity: 'error', message: 'Surface has invalid texture UVs', surfaceId: surface.id })
    if (surface.uvs.length * 3 !== surface.positions.length * 2 || surface.indices.some((i) => i < 0 || i * 3 >= surface.positions.length)) diagnostics.push({ code: 'invalid-topology', severity: 'error', message: 'Surface has invalid mesh indices or UVs', surfaceId: surface.id })
    surface.vertexIds.forEach((id, i) => {
      const p = surface.positions.slice(i * 3, i * 3 + 3) as Vec3, previous = seen.get(id)
      if (previous && length(sub(previous, p)) > 1e-7) diagnostics.push({ code: 'broken-seam', severity: 'error', message: `Shared vertex ${id} is separated`, surfaceId: surface.id })
      seen.set(id, p)
    })
  }
  for (const anchor of result.anchors) if (length(sub(anchor.position, anchor.target)) > 1e-7) diagnostics.push({ code: 'broken-anchor', severity: 'error', message: `Attachment ${anchor.id} is separated` })
  if ([...result.rootTransform.position, result.rootTransform.scale, result.opacity, ...result.bounds.min, ...result.bounds.max].some((n) => !Number.isFinite(n))) diagnostics.push({ code: 'non-finite-transform', severity: 'error', message: 'Mechanism has a non-finite transform or bounds' })
  return diagnostics
}
