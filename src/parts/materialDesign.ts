import type { Vector3 } from 'three'
import type { PaperEvaluation, PaperFace, PartPort } from './geometry'

type MaterialPoint = readonly [number, number, number]
interface MaterialFace {
  readonly width: number; readonly height: number; readonly support: boolean
  readonly outline: readonly (readonly [number, number])[]
}
interface MaterialAttachment {
  readonly parent: readonly MaterialPoint[]; readonly child: readonly MaterialPoint[]
}
/** 配置設計から導いた材料の写し。姿勢・絵柄・描画時の積層は含めず、検査の間だけ保持する。 */
export interface PaperDesign {
  readonly pieces: ReadonlySet<string>
  readonly surfaces: ReadonlyMap<string, MaterialFace>
  readonly attachments: ReadonlyMap<string, readonly MaterialAttachment[]>
}

/** 入れ子や倍率変換を通った実入力も集め、外部の紙への接着を検査から漏らさない。 */
export function paperMaterialSurfaces(result: PaperEvaluation, inputs: readonly PartPort[] = []): Map<string, PaperFace> {
  const surfaces = new Map<string, PaperFace>(), seenFaces = new Set<PaperFace>(), seenResults = new Set<PaperEvaluation>()
  const face = (value: PaperFace) => {
    if (seenFaces.has(value)) return
    seenFaces.add(value)
    if (!surfaces.has(value.id)) surfaces.set(value.id, value)
    value.contactRegions?.forEach(face)
  }
  const port = (value: PartPort) => { if (value.kind === 'surface') face(value.face); else { face(value.a); face(value.b) } }
  const visit = (value: PaperEvaluation) => {
    if (seenResults.has(value)) return
    seenResults.add(value)
    value.faces.forEach(face); value.contactSurfaces?.forEach(face)
    if (value.inputPort) port(value.inputPort)
    Object.values(value.ports).forEach(port)
    Object.values(value.nodes ?? {}).forEach(visit)
  }
  visit(result); inputs.forEach(port)
  return surfaces
}

export function capturePaperDesign(result: PaperEvaluation, inputs: readonly PartPort[] = []): PaperDesign {
  const faces = paperMaterialSurfaces(result, inputs), pieces = new Set(result.faces.map((face) => face.id))
  if (pieces.size !== result.faces.length) throw new Error('Duplicate paper face ID')
  const surfaces = new Map<string, MaterialFace>(), attachments = new Map<string, MaterialAttachment[]>()
  for (const [id, face] of faces) surfaces.set(id, {
    width: face.width, height: face.height, support: face.support,
    outline: (face.outline ?? [[0, 0], [1, 0], [1, 1], [0, 1]]).map(([u, v]) => [u * face.width, v * face.height]),
  })
  const materialPoint = (face: PaperFace, point: Vector3): MaterialPoint => {
    const delta = point.clone().sub(face.origin)
    return [delta.dot(face.u), delta.dot(face.v), delta.dot(face.u.clone().cross(face.v))]
  }
  for (const connection of result.connections) {
    const parent = faces.get(connection.parentFace), child = faces.get(connection.childFace)
    if (!parent || !child) throw new Error(`Missing paper attachment surface: ${!parent ? connection.parentFace : connection.childFace}`)
    const key = JSON.stringify([connection.parentFace, connection.childFace]), group = attachments.get(key) ?? []
    group.push({ parent: connection.expected.map((point) => materialPoint(parent, point)), child: connection.actual.map((point) => materialPoint(child, point)) })
    attachments.set(key, group)
  }
  return { pieces, surfaces, attachments }
}

const equalNumbers = (a: readonly number[], b: readonly number[]) => a.length === b.length
  && a.every((value, i) => Number.isFinite(value) && Number.isFinite(b[i]) && Math.abs(value - b[i]) <= 1e-6)
const equalKeys = (a: Iterable<string>, b: Iterable<string>) => {
  const left = new Set(a), right = new Set(b)
  return left.size === right.size && [...left].every((key) => right.has(key))
}
const sameAttachment = (a: MaterialAttachment, b: MaterialAttachment) => {
  const matches = (reverse: boolean) => a.parent.length === b.parent.length && a.child.length === b.child.length
    && a.parent.every((point, i) => equalNumbers(point, b.parent[reverse ? b.parent.length - 1 - i : i]))
    && a.child.every((point, i) => equalNumbers(point, b.child[reverse ? b.child.length - 1 - i : i]))
  // 同じ接着線の始点と終点を逆順に返しても、紙の設計は変わらない。
  return matches(false) || matches(true)
}

/** 世界座標を比べず、同じ紙の材料座標で形と接着線が不変かを調べる。 */
export function comparePaperDesign(reference: PaperDesign, candidate: PaperDesign): string[] {
  const errors: string[] = []
  if (!equalKeys(reference.pieces, candidate.pieces) || !equalKeys(reference.surfaces.keys(), candidate.surfaces.keys())) {
    errors.push('Paper topology changes during folding')
  }
  for (const [id, before] of reference.surfaces) {
    const after = candidate.surfaces.get(id)
    if (!after) continue
    if (!equalNumbers([before.width, before.height], [after.width, after.height]) || before.support !== after.support
      || before.outline.length !== after.outline.length || before.outline.some((point, i) => !equalNumbers(point, after.outline[i]))) {
      errors.push(`Paper material changes during folding: ${id}`)
    }
  }
  if (!equalKeys(reference.attachments.keys(), candidate.attachments.keys())) errors.push('Paper connections change during folding')
  for (const [key, before] of reference.attachments) {
    const after = [...candidate.attachments.get(key) ?? []]
    const same = before.length === after.length && before.every((attachment) => {
      const index = after.findIndex((other) => sameAttachment(attachment, other))
      if (index < 0) return false
      after.splice(index, 1); return true
    })
    if (!same) errors.push(`Paper attachment moves during folding: ${(JSON.parse(key) as string[]).join(' / ')}`)
  }
  return errors
}
