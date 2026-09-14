import { faceContainsLine, makeFace, pointOnFace, type PaperEvaluation, type PaperFace } from './geometry'

/** 側方の部品と同じ平面を保つ連結紙。独立した起立時計を作らない。 */
export function evaluateSideUpright(parent: PaperFace, p: Record<string, number>, prefix: string): PaperEvaluation {
  const { u, v, width, height } = p
  const right = u >= parent.width, from = right ? parent.width : u + width, to = right ? u : 0
  if (to - from < 1e-6) throw new Error('Lateral support requires a gap beside its parent')
  const level = Math.min(v + height * .5, parent.height - .06), strip = Math.min(.06, height * .1)
  if (level < v || level + strip > v + height) throw new Error('Lateral support cannot reach the child height')
  const panel = makeFace(`${prefix}/panel`, pointOnFace(parent, u, v), parent.u, parent.v, width, height)
  const support = makeFace(`${prefix}/support`, pointOnFace(parent, from, level), parent.u, parent.v, to - from, strip, true)
  const parentEdge = [pointOnFace(parent, right ? from : to, level), pointOnFace(parent, right ? from : to, level + strip)]
  const childEdge = [pointOnFace(parent, right ? to : from, level), pointOnFace(parent, right ? to : from, level + strip)]
  if (!faceContainsLine(parent, parentEdge[0], parentEdge[1])) throw new Error('Lateral support misses parent material')
  return { faces: [panel, support], ports: { panel: { kind: 'surface', face: panel } }, connections: [
    { childFace: support.id, parentFace: parent.id, actual: parentEdge, expected: parentEdge.map(p => p.clone()) },
    { childFace: support.id, parentFace: panel.id, actual: childEdge, expected: childEdge.map(p => p.clone()) },
  ] }
}
