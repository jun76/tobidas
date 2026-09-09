import { faceContainsLine, makeFace, pointOnFace, stackOnSurface, type FoldPair, type PaperEvaluation } from './geometry'

/** 共通の谷から斜めの下辺と三角支持を立てる。二面の実角度から球面四節の交点を解く。 */
export function evaluateAngledUpright(port: FoldPair, p: Record<string, number>, prefix: string): PaperEvaluation {
  const yaw = p.yawAngle * Math.PI / 180, beta = Math.PI / 2 - yaw / 2, gamma = yaw / 2
  const origin = port.origin.clone().addScaledVector(port.axis, p.offset)
  const groundHinge = port.axis.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(port.rayA, Math.sin(yaw))
  const backHinge = port.rayB, dot = groundHinge.dot(backHinge), denominator = 1 - dot * dot
  if (denominator < 1e-8) throw new Error('Angled upright has a singular input hinge')
  const a = (Math.cos(beta) - dot * Math.cos(gamma)) / denominator
  const b = (Math.cos(gamma) - dot * Math.cos(beta)) / denominator
  const edge = groundHinge.clone().multiplyScalar(a).addScaledVector(backHinge, b)
  const remaining = 1 - edge.lengthSq()
  if (remaining < -1e-7) throw new Error('Angled upright cannot reach its fixed support')
  edge.addScaledVector(groundHinge.clone().cross(backHinge).normalize(), -port.foldSign * Math.sqrt(Math.max(0, remaining))).normalize()
  const rise = edge.clone().addScaledVector(groundHinge, -Math.cos(beta)).divideScalar(Math.sin(beta)).normalize()
  const supportRay = edge.clone().addScaledVector(backHinge, -Math.cos(gamma)).divideScalar(Math.sin(gamma)).normalize()
  const supportWidth = p.height * Math.tan(gamma)
  if (supportWidth > p.width + 1e-7) throw new Error('The diagonal attachment exceeds the angled panel width')
  const panel = makeFace(`${prefix}/panel`, origin, groundHinge, rise, p.width, p.height)
  const support = makeFace(`${prefix}/support`, origin, backHinge, supportRay, p.height, supportWidth, true)
  support.outline = [[0, 0], [1, 0], [1, 1]]
  if (Math.abs(panel.u.clone().cross(panel.v).dot(support.u.clone().cross(support.v))) > 1 - 1e-7) support.surfaceStack = stackOnSurface(panel, support.id)
  const bottom = [origin, pointOnFace(panel, panel.width, 0)], back = [origin, pointOnFace(support, support.width, 0)]
  const diagonal = [origin, pointOnFace(support, support.width, support.height)]
  if (!faceContainsLine(port.a, bottom[0], bottom[1]) || !faceContainsLine(port.b, back[0], back[1])) throw new Error('Angled upright attachment exceeds its actual input face')
  const groundRay = port.rayA.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(port.axis, -Math.sin(yaw))
  return { faces: [panel, support], connections: [
    { parentFace: port.a.id, childFace: panel.id, actual: bottom, expected: bottom.map((p) => p.clone()) },
    { parentFace: port.b.id, childFace: support.id, actual: back, expected: back.map((p) => p.clone()) },
    { parentFace: panel.id, childFace: support.id, actual: diagonal, expected: [origin.clone(), pointOnFace(panel, supportWidth, p.height)] },
  ], ports: { panel: { kind: 'surface', face: panel }, support: { kind: 'surface', face: support }, ground: { kind: 'surface', face: port.a },
    'ground-panel': { kind: 'fold-pair', a: port.a, b: panel, origin: pointOnFace(panel, p.width / 2, 0), axis: groundHinge,
      rayA: groundRay, rayB: rise, width: p.width, extentA: port.extentA, extentB: p.height, foldSign: port.foldSign } } }
}
