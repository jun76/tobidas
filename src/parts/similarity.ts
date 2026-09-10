import { Vector3 } from 'three'
import type { PaperEvaluation, PaperFace, PartPort } from './geometry'

/** 材料座標も含めて単位を変換する。同じ面への参照と積層関係を保持する。 */
export function paperSimilarity(center: Vector3, ratio: number) {
  const faces = new Map<PaperFace, PaperFace>()
  const point = (value: Vector3) => value.clone().sub(center).multiplyScalar(ratio).add(center)
  const face = (source: PaperFace): PaperFace => {
    const existing = faces.get(source)
    if (existing) return existing
    const result: PaperFace = { ...source, origin: point(source.origin), u: source.u.clone(), v: source.v.clone(),
      width: source.width * ratio, height: source.height * ratio }
    faces.set(source, result)
    if (source.contactRegions) result.contactRegions = source.contactRegions.map(face)
    if (source.surfaceStack) result.surfaceStack = { base: face(source.surfaceStack.base), layers: [...source.surfaceStack.layers] }
    return result
  }
  const port = (source: PartPort): PartPort => source.kind === 'surface' ? { kind: 'surface', face: face(source.face) }
    : { ...source, a: face(source.a), b: face(source.b), origin: point(source.origin),
      width: source.width * ratio, extentA: source.extentA * ratio, extentB: source.extentB * ratio }
  const evaluation = (source: PaperEvaluation): PaperEvaluation => ({ ...source,
    contents: source.contents?.map((item) => ({ ...item, face: item.face && face(item.face), unitScale: item.unitScale * ratio })),
    ...(source.nodes ? { nodes: Object.fromEntries(Object.entries(source.nodes).map(([id, node]) => [id, evaluation(node)])) } : {}),
    ...(source.inputPort ? { inputPort: port(source.inputPort) } : {}), faces: source.faces.map(face),
    ports: Object.fromEntries(Object.entries(source.ports).map(([key, value]) => [key, port(value)])),
    contactSurfaces: source.contactSurfaces?.map(face), connections: source.connections.map((edge) => ({ ...edge,
      actual: edge.actual.map(point), expected: edge.expected.map(point) })) })
  return { point, face, port, evaluation }
}
