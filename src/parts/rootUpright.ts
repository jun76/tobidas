import { Vector3 } from 'three'
import { faceContains, faceContainsLine, faceShape, makeFace, openingAngle, pointOnFace, type FoldPair, type PaperEvaluation, type PaperFace } from './geometry'
import { inspectShape, ringLocation, shapeMemo, type PaperShape } from './shape'

/** 山や樹冠の外周に合わせ、左右の材料が残る区間だけを中央の折り線にする。 */
export function fitRootFoldContacts(result: PaperEvaluation): void {
  const byId = new Map(result.faces.map(face => [face.id, face]))
  result.connections = result.connections.flatMap(edge => {
    const a = byId.get(edge.childFace), b = byId.get(edge.parentFace)
    if (!a || !b || a.support || b.support || !a.artworkSpan || !b.artworkSpan) return [edge]
    const start = edge.actual[0], end = edge.actual.at(-1)!, direction = end.clone().sub(start), length = direction.length()
    if (length < 1e-8) return [edge]
    direction.divideScalar(length)
    const cuts = [0, length]
    for (const face of [a, b]) for (const ring of [faceShape(face).outer, ...faceShape(face).holes]) {
      for (const [u, v] of ring) cuts.push(Math.max(0, Math.min(length, pointOnFace(face, u * face.width, v * face.height).sub(start).dot(direction))))
    }
    cuts.sort((x, y) => x - y)
    const intervals: [number, number][] = []
    for (let i = 1; i < cuts.length; i++) {
      const lo = cuts[i - 1], hi = cuts[i], middle = start.clone().addScaledVector(direction, (lo + hi) / 2)
      if (hi - lo < 1e-7 || !faceContains(a, middle) || !faceContains(b, middle)) continue
      const previous = intervals.at(-1)
      if (previous && Math.abs(previous[1] - lo) < 1e-7) previous[1] = hi
      else intervals.push([lo, hi])
    }
    if (!intervals.length) throw new Error('Root cutout removes its folding attachment')
    return intervals.map(([lo, hi]) => {
      const actual = [lo, hi].map(t => start.clone().addScaledVector(direction, t))
      return { ...edge, actual, expected: actual.map(point => point.clone()) }
    })
  })
}

const panelShapes = shapeMemo<PaperShape>(), splitShapes = new WeakMap<PaperShape, Map<string, PaperShape>>()
/** 一枚の材料輪郭を画像と同じ担当範囲へ分割する。折り線を切る穴は接続できない。 */
export function rootPanelShape(shape: PaperShape, span: [number, number] = [0, 1]): PaperShape {
  // 稜線の走査は重いので、輪郭と担当範囲が同じなら前回の結果を共有する。輪郭は書き換えない値として扱う。
  let spans = splitShapes.get(shape)
  if (!spans || spans.size > 64) splitShapes.set(shape, spans = new Map())
  const key = span.join(), cached = spans.get(key)
  if (cached) return cached
  const split = panelShapes(JSON.stringify([shape, span]), () => splitRootPanelShape(shape, span))
  spans.set(key, split)
  return split
}
function splitRootPanelShape(shape: PaperShape, span: [number, number]): PaperShape {
  const [lo, hi] = span
  let outer = shape.outer, silhouette = false
  for (const [edge, sign] of [[lo, 1], [hi, -1]]) {
    const clipped: [number, number][] = []
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], b = outer[(i + 1) % outer.length], da = (a[0] - edge) * sign, db = (b[0] - edge) * sign
      if (da >= 0) clipped.push(a)
      if (da * db < 0) { const t = da / (da - db); clipped.push([edge, a[1] + (b[1] - a[1]) * t]) }
    }
    outer = clipped
  }
  // 折り線を何度も横切る輪郭 (草の穂先など) は単純な切り取りでは自己交差する。その場合は各列の稜線の下を
  // 地面まで満たした輪郭に置き換える。絵の透明部分は描かれないので見た目は変わらず、紙としては成立する。
  if (outer.length < 3 || inspectShape({ outer, holes: [] }).some(error => error.includes('intersects'))) {
    const samples = 96, top: [number, number][] = []
    for (let i = 0; i <= samples; i++) {
      const x = lo + (hi - lo) * i / samples
      let y = 0
      for (let k = 200; k >= 0; k--) { const yy = k / 200; if (ringLocation(shape.outer, [x, yy]) !== 'outside') { y = yy; break } }
      top.push([x, Math.max(y, .02)])
    }
    outer = [[lo, 0], [hi, 0], ...top.reverse()]
    silhouette = true
  }
  const holes = shape.holes.filter(ring => {
    // 置き換えた輪郭に収まらない穴は捨てる (稜線近くの穂先の隙間)
    if (silhouette && !ring.every(p => ringLocation(outer, p) === 'inside')) return false
    const min = Math.min(...ring.map(p => p[0])), max = Math.max(...ring.map(p => p[0]))
    if (max <= lo || min >= hi) return false
    if (min <= lo || max >= hi) throw new Error('Root cutout crosses its folding attachment')
    return true
  })
  const map = (ring: [number, number][]) => ring.map(([u, v]): [number, number] => [(u - lo) / (hi - lo), v])
  return { outer: map(outer), holes: holes.map(map) }
}

/** 最奥のカード。接地できる場合は左右の下辺と縦折り線で駆動する。 */
export function evaluateRootUpright(port: FoldPair, p: Record<string, number>, prefix: string): PaperEvaluation {
  const { centerX: x, offset: z, width, height } = p
  const lo = x - width / 2, hi = x + width / 2
  const s = Math.sin(85 * Math.PI / 180), c = Math.cos(85 * Math.PI / 180)
  const origin = port.origin.clone().addScaledVector(port.axis, z + Math.abs(x) * c / s)
  const uA = port.rayA.clone().multiplyScalar(s).addScaledVector(port.axis, -c)
  const uB = port.rayB.clone().multiplyScalar(s).addScaledVector(port.axis, -c)
  // 分岐は現在角ではなく、材料座標の接地位置で固定する。
  const onPage = (side: 'a' | 'b', from: number, to: number) => {
    const ground = port[side], ray = side === 'a' ? port.rayA : port.rayB
    const along = ray.clone().multiplyScalar(s).addScaledVector(port.axis, -c)
    return faceContainsLine({ ...ground, infinitePage: false }, origin.clone().addScaledVector(along, from / s), origin.clone().addScaledVector(along, to / s))
  }
  const aRange = [Math.max(0, lo), Math.max(.12, hi)] as const
  const bRange = [Math.max(0, -hi), Math.max(.12, -lo)] as const
  const physical = onPage('a', 0, aRange[1]) && onPage('b', 0, bRange[1])
  const result: PaperEvaluation = { faces: [], connections: [], ports: {}, rootSupport: physical ? 'pages' : 'independent' }
  const connect = (child: PaperFace, parent: PaperFace, points: Vector3[]) => result.connections.push({ childFace: child.id, parentFace: parent.id,
    actual: points, expected: points.map(point => point.clone()) })
  const publish = (name: string, panel: PaperFace, ground: PaperFace, groundRay: Vector3) => {
    result.ports[name] = { kind: 'surface', face: panel }
    result.ports[name === 'panel' ? 'ground' : 'ground-b'] = { kind: 'surface', face: ground }
    result.ports[name === 'panel' ? 'ground-panel' : 'ground-panel-b'] = { kind: 'fold-pair', a: ground, b: panel,
      origin: pointOnFace(panel, panel.width / 2, 0), axis: panel.u, rayA: groundRay, rayB: panel.v,
      extentA: Infinity, extentB: height, width: panel.width,
      foldSign: panel.u.dot(groundRay.clone().cross(panel.v)) < 0 ? -1 : 1 }
  }
  if (!physical && (lo >= 0 || hi <= 0)) {
    // 実紙の外側では支持を捏造しない。論理ページに従う一本の下辺から自立する。
    const right = x >= 0, ground = right ? port.a : port.b, ray = right ? port.rayA : port.rayB
    const u = ray.clone().multiplyScalar(right ? 1 : -1)
    const normal = port.axis.clone().cross(ray).multiplyScalar(right ? port.foldSign : -port.foldSign)
    const angle = openingAngle(port) * Math.PI / 360
    const v = port.axis.clone().multiplyScalar(Math.cos(angle)).addScaledVector(normal, Math.sin(angle))
    const foot = port.origin.clone().addScaledVector(port.axis, z).addScaledVector(ray, Math.abs(x))
    const panel = makeFace(`${prefix}/panel`, foot.addScaledVector(u, -width / 2), u, v, width, height)
    result.faces.push(panel)
    publish('panel', panel, ground, port.axis)
    return result
  }
  // 綴じ目をまたぐ遠景は、不可視の左右ページで二つ折りを駆動する。片側の子だけを切り離さない。
  const bisector = port.rayA.clone().add(port.rayB), cosHalf = bisector.length() / 2
  if (bisector.lengthSq() < 1e-14) bisector.copy(port.axis).cross(port.rayA).multiplyScalar(port.foldSign)
  bisector.normalize()
  const rise = bisector.multiplyScalar(c).addScaledVector(port.axis, s * cosHalf).normalize()
  const make = (side: 'a' | 'b', from: number, to: number, support: boolean) => {
    const direction = side === 'a' ? uA : uB, start = origin.clone().addScaledVector(direction, (side === 'a' ? from : to) / s)
    const face = makeFace(`${prefix}/${side === 'a' ? 'panel' : 'panel-b'}`, start, direction.clone().multiplyScalar(side === 'a' ? 1 : -1), rise, (to - from) / s,
      support ? height * .5 + .06 : height, support)
    result.faces.push(face)
    if (physical) connect(face, port[side], [pointOnFace(face, 0, 0), pointOnFace(face, face.width, 0)])
    if (!support) {
      face.artworkSpan = side === 'a' ? [(from - lo) / width, (to - lo) / width] : [(-to - lo) / width, (-from - lo) / width]
      publish(side === 'a' ? 'panel' : 'panel-b', face, port[side], (side === 'a' ? port.rayA : port.rayB).clone().multiplyScalar(c).addScaledVector(port.axis, s))
    }
    return face
  }
  const a = make('a', hi > 0 ? aRange[0] : 0, hi > 0 ? hi : .12, hi <= 0)
  const b = make('b', lo < 0 ? bRange[0] : 0, lo < 0 ? -lo : .12, lo >= 0)
  if (lo <= 0 && hi >= 0) connect(a, b, [origin.clone(), origin.clone().addScaledVector(rise, height)])
  else {
    const side = lo > 0 ? a : b, other = lo > 0 ? b : a, direction = lo > 0 ? uA : uB
    const length = (lo > 0 ? lo : -hi) / s, y = height * .5
    const bridge = makeFace(`${prefix}/root-bridge`, origin.clone().addScaledVector(rise, y), direction, rise, length, .06, true)
    result.faces.push(bridge)
    connect(bridge, other, [bridge.origin.clone(), pointOnFace(bridge, 0, .06)])
    connect(bridge, side, [pointOnFace(bridge, length, 0), pointOnFace(bridge, length, .06)])
    // 一面だけが絵の場合も、通常の縦置きと同じ接続口で子を取り付けられる。
    if (lo < 0) {
      result.ports.panel = result.ports['panel-b']; result.ports.ground = result.ports['ground-b']
      result.ports['ground-panel'] = result.ports['ground-panel-b']
    }
  }
  return result
}
