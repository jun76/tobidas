import { Vector3 } from 'three'
import { EPSILON, faceContainsLine, makeFace, pointOnFace, type FoldPair, type PaperEvaluation, type PaperFace } from './geometry'

/** 二枚の背景を各入力面の斜めの下辺と中央の縦折り線でつなぐ。独立した起立角は持たない。 */
export function evaluateBackdrop(port: FoldPair, p: Record<string, number>, prefix: string): PaperEvaluation {
  const half = p.width / 2, angle = p.splayAngle * Math.PI / 360
  const s = Math.sin(angle), c = Math.cos(angle)
  const origin = port.origin.clone().addScaledVector(port.axis, p.offset)
  const hingeA = port.rayA.clone().multiplyScalar(s).addScaledVector(port.axis, -c)
  const hingeB = port.rayB.clone().multiplyScalar(s).addScaledVector(port.axis, -c)
  const bisector = port.rayA.clone().add(port.rayB), cosHalf = bisector.length() / 2
  if (bisector.lengthSq() < EPSILON ** 2) bisector.copy(port.axis).cross(port.rayA).multiplyScalar(port.foldSign)
  else bisector.normalize()
  // 中央の折り線は二本の下辺の双方に直交する。閉状態でも同じ連続解を用いる。
  const rise = bisector.multiplyScalar(c).addScaledVector(port.axis, s * cosHalf).normalize()
  const a = makeFace(`${prefix}/panel`, origin, hingeA, rise, half, p.height)
  const b = makeFace(`${prefix}/panel-b`, origin.clone().addScaledVector(hingeB, half), hingeB.clone().negate(), rise, half, p.height)
  a.artworkSpan = [.5, 1]; b.artworkSpan = [0, .5]
  const result: PaperEvaluation = { faces: [a, b], connections: [], ports: {
    panel: { kind: 'surface', face: a }, 'panel-b': { kind: 'surface', face: b },
    ground: { kind: 'surface', face: port.a }, 'ground-b': { kind: 'surface', face: port.b },
  } }
  for (const [panel, ground] of [[a, port.a], [b, port.b]]) {
    const line = [pointOnFace(panel, 0, 0), pointOnFace(panel, panel.width, 0)]
    if (!faceContainsLine(ground, line[0], line[1])) throw new Error(`Attachment exceeds surface: ${ground.id}`)
    result.connections.push({ childFace: panel.id, parentFace: ground.id, actual: line, expected: line.map((point) => point.clone()) })
  }
  result.connections.push({ childFace: b.id, parentFace: a.id,
    actual: [pointOnFace(b, half, 0), pointOnFace(b, half, p.height)],
    expected: [pointOnFace(a, 0, 0), pointOnFace(a, 0, p.height)] })
  const outlet = (panel: PaperFace, ground: PaperFace, ray: Vector3): FoldPair => {
    const alongGround = ray.clone().multiplyScalar(c).addScaledVector(port.axis, s)
    const endpoints = [pointOnFace(panel, 0, 0), pointOnFace(panel, half, 0)]
    const limits = endpoints.flatMap((point) => {
      const delta = point.clone().sub(ground.origin)
      return ([[ground.u, ground.width], [ground.v, ground.height]] as const).flatMap(([axis, size]) => {
        const rate = alongGround.dot(axis), at = delta.dot(axis)
        return rate > EPSILON ? [(size - at) / rate] : rate < -EPSILON ? [-at / rate] : []
      })
    })
    return { kind: 'fold-pair', a: ground, b: panel, origin: pointOnFace(panel, half / 2, 0), axis: panel.u,
      rayA: alongGround, rayB: rise, width: half, extentA: Math.max(0, Math.min(...limits)), extentB: p.height,
      foldSign: port.foldSign === 1 ? -1 : 1 }
  }
  result.ports['ground-backdrop'] = outlet(a, port.a, port.rayA)
  result.ports['ground-backdrop-b'] = outlet(b, port.b, port.rayB)
  return result
}

/** 見開きの奥へ置く初期寸法。収納した二枚の長方形を紙面内へ収める。 */
export function backdropForBook(pageWidth: number, depth: number): Record<string, number> {
  const splayAngle = 150, s = Math.sin(splayAngle * Math.PI / 360), c = Math.cos(splayAngle * Math.PI / 360)
  const margin = Math.min(pageWidth, depth) * .025
  let half = pageWidth * .88, height = depth * .5
  const scale = Math.min(1, (pageWidth - margin) / (half * s + height * c), (depth - 2 * margin) / (half * c + height * s))
  half *= scale; height *= scale
  return { width: half * 2, height, offset: -depth / 2 + margin + half * c, splayAngle }
}
