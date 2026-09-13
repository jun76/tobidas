import { Vector3 } from 'three'
import type { BuiltinPartId } from './catalog'
import { builtinPart } from './catalog'
import { evaluateBackdrop } from './backdrop'
import { evaluateAngledUpright } from './angledUpright'
import { parameterValues, type PartMaterial } from './schema'
import { checkInput, EPSILON, faceContains, faceCorners, faceShape, makeFace, pointOnFace, stackOnSurface,
  type FoldPair, type PaperEvaluation, type PaperFace, type PartPort } from './geometry'

/** 紙面は全て剛体。角度の換算や面の伸縮で解を作らない。 */
export function evaluateBuiltin(id: BuiltinPartId, port: PartPort, overrides: Record<string, number> = {}, prefix: string = id, version?: number): PaperEvaluation {
  const spec = builtinPart(id, version), p = parameterValues(spec.parameters, overrides)
  checkInput(spec.input, port)
  if (id === 'backdrop' && spec.version === 2 && port.kind === 'fold-pair') return evaluateBackdrop(port, p, prefix)
  if (id === 'angled-upright' && port.kind === 'fold-pair') return evaluateAngledUpright(port, p, prefix)
  const result: PaperEvaluation = { faces: [], ports: {}, connections: [] }
  if ((id === 'platform' || id === 'folding-box') && port.kind === 'fold-pair') {
    // 本の二面から90°の背面を起こす支持を、台と箱の内部に含める。
    const base = evaluateBuiltin('backdrop', port, { width: p.width, height: p.height, distance: p.distance / 2, offset: p.offset }, `${prefix}/base`, 1)
    for (const face of base.faces) {
      const previous = face.id
      face.id = `${prefix}/${previous.endsWith('/panel') ? 'back' : 'rear-support'}`
      for (const connection of base.connections) {
        if (connection.childFace === previous) connection.childFace = face.id
        if (connection.parentFace === previous) connection.parentFace = face.id
      }
    }
    result.faces.push(...base.faces); result.connections.push(...base.connections)
    result.ports.back = base.ports.panel
    port = base.ports['ground-backdrop']; p.offset = 0
  }
  const put = (name: string, origin: Vector3, u: Vector3, v: Vector3, width: number, height: number, support = false) => {
    const face = makeFace(`${prefix}/${name}`, origin, u, v, width, height, support)
    result.faces.push(face); result.ports[name] = { kind: 'surface', face }
    return face
  }
  const glue = (child: PaperFace, parent: PaperFace, expectedStart: Vector3, expectedEnd: Vector3, edge: 'bottom' | 'top' = 'bottom') => {
    if (!faceContains(parent, expectedStart) || !faceContains(parent, expectedEnd)) throw new Error(`Attachment exceeds surface: ${parent.id}`)
    result.connections.push({ parentFace: parent.id, childFace: child.id,
      actual: [pointOnFace(child, 0, edge === 'top' ? child.height : 0), pointOnFace(child, child.width, edge === 'top' ? child.height : 0)],
      expected: [expectedStart, expectedEnd] })
  }
  if (port.kind === 'surface') {
    const face = port.face, angle = p.rotation * Math.PI / 180
    const u = face.u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(face.v, Math.sin(angle))
    const v = face.v.clone().multiplyScalar(Math.cos(angle)).addScaledVector(face.u, -Math.sin(angle))
    const center = pointOnFace(face, face.width / 2 + p.u, p.v)
    const sheet = put('face', center.addScaledVector(u, -p.width / 2).addScaledVector(v, -p.height / 2), u, v, p.width, p.height)
    if (!faceCorners(sheet).every((corner) => faceContains(face, corner))) throw new Error('Glued part exceeds its parent face')
    glue(sheet, face, sheet.origin, pointOnFace(sheet, sheet.width, 0))
    sheet.surfaceStack = stackOnSurface(face, sheet.id)
    sheet.material = id === 'text' ? { color: '#ffffff', text: 'Text' } : { color: '#e3b476' }
    return result
  }
  const { axis, rayA, rayB } = port
  if (Math.abs(p.offset) + p.width / 2 > port.width / 2 + EPSILON) throw new Error('Attachment exceeds hinge width')
  const o = port.origin.clone().addScaledVector(axis, p.offset)
  const a = o.clone().addScaledVector(rayA, p.distance)
  const left = (center: Vector3, width = p.width) => center.clone().addScaledVector(axis, -width / 2)
  const right = (center: Vector3, width = p.width) => center.clone().addScaledVector(axis, width / 2)
  const pair = (name: string, aFace: PaperFace, bFace: PaperFace, origin: Vector3, aRay: Vector3, bRay: Vector3, extentA: number, extentB: number, sign: 1 | -1) => {
    result.ports[name] = { kind: 'fold-pair', a: aFace, b: bFace, origin, axis, rayA: aRay, rayB: bRay,
      extentA, extentB, width: p.width, foldSign: sign }
  }
  const addPanel = (name: string, center: Vector3, direction: Vector3, height: number, support = false, width = p.width) =>
    put(name, left(center, width), axis, direction, width, height, support)
  result.ports.ground = { kind: 'surface', face: port.a }

  if (id === 'backdrop') {
    // 閉じたときに一直線へ畳める四節リンク。全開180°では背景が地面に直立する。
    const bDistance = p.height * p.distance / (p.height + 2 * p.distance)
    const b = o.clone().addScaledVector(rayB, bDistance)
    const supportLength = p.height + p.distance - bDistance
    const chord = b.clone().sub(a), gap = chord.length()
    if (gap < EPSILON) throw new Error('Degenerate backdrop dimensions')
    const along = (p.height ** 2 - supportLength ** 2 + gap ** 2) / (2 * gap)
    const squared = p.height ** 2 - along ** 2
    if (squared < -EPSILON) throw new Error('Backdrop linkage cannot reach its attachment')
    const direction = chord.divideScalar(gap)
    const perpendicular = axis.clone().cross(direction).multiplyScalar(-port.foldSign)
    const top = a.clone().addScaledVector(direction, along).addScaledVector(perpendicular, Math.sqrt(Math.max(0, squared)))
    const panelRay = top.clone().sub(a).normalize(), supportRay = top.clone().sub(b).normalize()
    const panel = addPanel('panel', a, panelRay, p.height)
    const support = addPanel('support', b, supportRay, supportLength, true)
    glue(panel, port.a, left(a), right(a)); glue(support, port.b, left(b), right(b))
    glue(support, panel, left(top), right(top), 'top')
    pair('ground-backdrop', port.a, panel, a, rayA, panelRay, port.extentA - p.distance, p.height, port.foldSign)
  } else if (id === 'v-fold' || id === 'beak') {
    const b = o.clone().addScaledVector(rayB, p.distance), halfGap = a.distanceTo(b) / 2
    const length = Math.hypot(p.distance, p.height)
    const bisector = rayA.clone().add(rayB)
    if (bisector.lengthSq() < EPSILON ** 2) bisector.copy(axis).cross(rayA).multiplyScalar(port.foldSign)
    bisector.normalize()
    const top = a.clone().add(b).multiplyScalar(.5).addScaledVector(bisector, Math.sqrt(Math.max(0, length ** 2 - halfGap ** 2)))
    const wingA = addPanel('wing-a', a, top.clone().sub(a).normalize(), length)
    const wingB = addPanel('wing-b', b, top.clone().sub(b).normalize(), length)
    glue(wingA, port.a, left(a), right(a)); glue(wingB, port.b, left(b), right(b))
    glue(wingB, wingA, left(top), right(top), 'top')
    if (id === 'beak') {
      // 折り線と接着辺を残し、対向する翼の外縁だけを切り抜く。
      wingA.outline = [[0, 0], [1, 0], [.85, .5], [1, 1], [0, 1], [.15, .5]]
      wingB.outline = [[0, 0], [1, 0], [.85, .5], [1, 1], [0, 1], [.15, .5]]
    }
    pair('ridge', wingA, wingB, top, a.clone().sub(top).normalize(), b.clone().sub(top).normalize(), length, length, port.foldSign === 1 ? -1 : 1)
  } else if (id === 'accordion') {
    const count = p.segments
    let start = a
    for (let i = 0; i < count; i++) {
      const next = o.clone().addScaledVector(rayA, p.distance * (1 - (i + 1) / count)).addScaledVector(rayB, p.height * i / count)
      addPanel(`fold-${i * 2}`, start, rayA.clone().negate(), p.distance / count)
      addPanel(`fold-${i * 2 + 1}`, next, rayB, p.height / count)
      // 各折り点を二面から支持する。帯だけに独立した駆動角を与えない。
      const level = p.height * (i + 1) / count
      const x = p.distance * (1 - (i + 1) / count)
      start = o.clone().addScaledVector(rayA, x).addScaledVector(rayB, level)
      if (i < count - 1) {
        const groundAnchor = o.clone().addScaledVector(rayA, x), backAnchor = o.clone().addScaledVector(rayB, level)
        const width = Math.min(.12, p.width)
        const post = addPanel(`support-post-${i}`, groundAnchor, rayB, level, true, width)
        const bridge = addPanel(`support-bridge-${i}`, backAnchor, rayA, x, true, width)
        glue(post, port.a, left(groundAnchor, width), right(groundAnchor, width))
        glue(bridge, port.b, left(backAnchor, width), right(backAnchor, width))
        glue(bridge, post, left(start, width), right(start, width), 'top')
      }
    }
    const first = result.faces.find((face) => face.id.endsWith('/fold-0'))!
    const last = result.faces.find((face) => face.id.endsWith(`/fold-${count * 2 - 1}`))!
    glue(first, port.a, left(a), right(a))
    const b = o.clone().addScaledVector(rayB, p.height)
    glue(last, port.b, left(b), right(b), 'top')
  } else {
    const supportHeight = id === 'upright' ? p.supportHeight : p.height
    const supportWidth = id === 'upright' ? p.supportWidth : p.width
    const supportOffset = id === 'upright' ? p.supportOffset : 0
    if (supportHeight > p.height + EPSILON || Math.abs(supportOffset) + supportWidth / 2 > p.width / 2 + EPSILON) throw new Error('Support must fit the upright face')
    let panelRay = rayB, bridgeRay = rayA, bridgeLength = p.distance, backHeight = supportHeight
    if (id === 'upright' && Math.abs(p.tiltAngle - 90) > 1e-8) {
      // 90°入力での設計角から、閉状態で一直線になる四節リンクの長さを決める。
      const theta = p.tiltAngle * Math.PI / 180
      backHeight = p.distance * supportHeight * (1 - Math.cos(theta)) / (p.distance + supportHeight * (1 - Math.sin(theta)))
      bridgeLength = p.distance + supportHeight - backHeight
      if (backHeight <= EPSILON || bridgeLength <= EPSILON) throw new Error('Tilt linkage has no positive support length')
      const b = o.clone().addScaledVector(rayB, backHeight), chord = b.clone().sub(a), gap = chord.length()
      if (gap < EPSILON) throw new Error('Tilt linkage is singular')
      const along = (supportHeight ** 2 - bridgeLength ** 2 + gap ** 2) / (2 * gap)
      const square = supportHeight ** 2 - along ** 2
      if (square < -EPSILON) throw new Error('Tilt linkage cannot reach its attachment')
      const direction = chord.divideScalar(gap), perpendicular = axis.clone().cross(direction).multiplyScalar(-port.foldSign)
      const contact = a.clone().addScaledVector(direction, along).addScaledVector(perpendicular, Math.sqrt(Math.max(0, square)))
      panelRay = contact.clone().sub(a).normalize(); bridgeRay = contact.clone().sub(b).normalize()
    }
    // 支持を絵の裏の接着可能な場所へ寄せる。紙の幅・長さ・接着位置は開閉中に変えない。
    const backAnchor = o.clone().addScaledVector(rayB, backHeight).addScaledVector(axis, supportOffset)
    const top = a.clone().addScaledVector(panelRay, p.height)
    const panel = addPanel('panel', a, panelRay, p.height)
    const support = addPanel(id === 'upright' ? 'support' : 'top', backAnchor, bridgeRay, bridgeLength, id === 'upright', supportWidth)
    glue(panel, port.a, left(a), right(a)); glue(support, port.b, left(backAnchor, supportWidth), right(backAnchor, supportWidth))
    const contact = a.clone().addScaledVector(panelRay, supportHeight).addScaledVector(axis, supportOffset)
    glue(support, panel, left(contact, supportWidth), right(contact, supportWidth), 'top')
    pair('ground-panel', port.a, panel, a, rayA, panelRay, port.extentA - p.distance, p.height, port.foldSign)
    if (id !== 'upright') pair('top-panel', support, panel, top, rayA.clone().negate(), rayB.clone().negate(), p.distance, p.height, port.foldSign)
    if (id === 'folding-box') {
      const bottom = addPanel('bottom', o, rayA, p.distance, true)
      glue(bottom, port.a, left(o), right(o))
    }
  }
  return result
}

/** 縦置きの接地辺は、輪郭の足が残る区間だけにする。背面支持の接着線は切り詰めない。 */
export function fitUprightGroundContacts(result: PaperEvaluation): void {
  const panel = result.ports.panel, ground = result.ports.ground
  if (panel?.kind !== 'surface' || ground?.kind !== 'surface' || !panel.face.shape && !panel.face.outline) return
  const ring = faceShape(panel.face).outer
  const intervals = ring.flatMap(([u, v], i): [number, number][] => {
    const [nextU, nextV] = ring[(i + 1) % ring.length]
    return v === 0 && nextV === 0 && Math.abs(nextU - u) > EPSILON ? [[Math.min(u, nextU), Math.max(u, nextU)]] : []
  }).sort((a, b) => a[0] - b[0])
  if (!intervals.length) throw new Error('Upright outline must retain a ground attachment edge')
  const feet: [number, number][] = []
  for (const interval of intervals) {
    const previous = feet[feet.length - 1]
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1])
    else feet.push([...interval])
  }
  result.connections = result.connections.flatMap(connection => connection.childFace === panel.face.id && connection.parentFace === ground.face.id
    ? feet.map(([start, end]) => ({ ...connection,
      actual: [start, end].map(t => connection.actual[0].clone().lerp(connection.actual[1], t)),
      expected: [start, end].map(t => connection.expected[0].clone().lerp(connection.expected[1], t)),
    })) : [connection])
}

export function decorateFaces(result: PaperEvaluation, materials: Record<string, PartMaterial>, outline?: [number, number][]): void {
  for (const face of result.faces) {
    const name = face.id.slice(face.id.lastIndexOf('/') + 1)
    face.material = { ...face.material, ...materials['*'], ...materials[name] }
    // 全体の背景画は二面で分担し、面を指定して貼った絵はその一面へ収める。
    if (materials[name]?.image || materials[name]?.backImage || materials[name]?.text) face.artworkSpan = undefined
    if (outline && !face.support && !['top', 'bottom', 'back'].includes(name)) face.outline = outline
  }
}
