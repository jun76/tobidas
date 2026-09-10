import { Vector3 } from 'three'

const materialPoint = (face, point) => {
  const d = point.clone().sub(face.origin)
  return [d.dot(face.u), d.dot(face.v)]
}
const round = (n) => Math.round(n * 1e9) / 1e9

/** 同じ高さの実紙を横切る区間を求め、細い柱や窓枠にも接着位置を合わせる。 */
function attachmentIntervals(api, face, center, axis, vertical) {
  const cuts = []
  const boundaries = (surface) => {
    const shape = api.faceShape(surface)
    for (const ring of [shape.outer, ...shape.holes]) {
      const points = ring.map(([u, v]) => {
        const delta = api.pointOnFace(surface, u * surface.width, v * surface.height).sub(center)
        return [delta.dot(axis), delta.dot(vertical)]
      })
      for (const [i, a] of points.entries()) {
        const b = points[(i + 1) % points.length]
        if (Math.abs(a[1]) < 1e-8) cuts.push(a[0])
        if (a[1] * b[1] < 0) cuts.push(a[0] + (b[0] - a[0]) * -a[1] / (b[1] - a[1]))
      }
    }
    surface.contactRegions?.forEach(boundaries)
  }
  boundaries(face)
  cuts.sort((a, b) => a - b)
  const intervals = []
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1], b = cuts[i]
    if (b - a < 1e-8 || !api.faceContains(face, center.clone().addScaledVector(axis, (a + b) / 2))) continue
    if (intervals.length && Math.abs(intervals.at(-1)[1] - a) < 1e-8) intervals.at(-1)[1] = b
    else intervals.push([a, b])
  }
  return intervals
}

/** 背後の実面を候補にする。仮想の交線を延ばしても、接着箇所に紙を捏造しない。 */
function mountAt(paper, pages, pair, target, width) {
  const reference = (face) => {
    for (const [nodeId, ports] of [['$book', pages], ...Object.entries(paper.nodes).map(([id, node]) => [id, node.ports])]) {
      for (const [portId, port] of Object.entries(ports)) if (port.kind === 'surface' && port.face.id === face.id) return { nodeId, portId }
    }
    throw new Error(`支持元の公開面がありません: ${face.id}`)
  }
  const origin = pair.origin.clone().addScaledVector(pair.axis, target.clone().sub(pair.origin).dot(pair.axis))
  const line = (face) => [-1, 1].map((sign) => materialPoint(face, origin.clone().addScaledVector(pair.axis, sign * width / 2)).map(round))
  const hingeA = line(pair.a), hingeB = line(pair.b)
  const bounds = (face, line) => ({ min: [0, 1].map((i) => Math.min(0, ...line.map((p) => p[i])) - 1e-8),
    max: [0, 1].map((i) => Math.max(i === 0 ? face.width : face.height, ...line.map((p) => p[i])) + 1e-8), panels: [] })
  const direction = (face, ray) => face.u.clone().cross(face.v).cross(pair.axis).dot(ray) < 0 ? 'negative' : 'positive'
  return { type: 'pair', a: reference(pair.a), b: reference(pair.b), hingeA, hingeB,
    directionA: direction(pair.a, pair.rayA), directionB: direction(pair.b, pair.rayB), foldSign: pair.foldSign,
    extensions: { a: bounds(pair.a, hingeA), b: bounds(pair.b, hingeB) } }
}

/** 正面の絵を遮らない後方支持を設計し、同じ材料の開閉と収納を評価してから採用する。 */
export function placeBehindScene(project, spread, api, element, { x, z, parentId, contour, supportCeiling = Infinity }) {
  const paper = api.evaluateBookParts(project, spread, Math.PI, 0)
  const { pageWidth: w, pageAspect } = project.book.format, depth = w / pageAspect
  const pages = api.pagePorts(w, depth, Math.PI, 0)
  const { width, height } = element.part.parameters, candidates = [], failures = new Set()
  const template = structuredClone(element.part)
  if (contour) {
    // 地面の接着辺だけを残し、上側は素材の実輪郭に合わせる。
    const base = Math.min(.06 / height, .1)
    template.shapes = { panel: { outer: [[0, 0], [1, 0], [1, base], ...contour.right.filter((p) => p[1] > base).reverse(),
      ...contour.left.filter((p) => p[1] > base), [0, base]].filter((p, i, all) => !i || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]), holes: [] } }
  }
  for (const [nodeId, node] of Object.entries(paper.nodes)) {
    if (parentId && nodeId !== parentId) continue
    for (const [portId, pair] of Object.entries(node.ports)) {
      if (pair.kind !== 'fold-pair' || pair.rayA.z < .85 || Math.abs(pair.rayA.y) > 1e-5 || pair.b.support) continue
      const target = new Vector3(x, 0, z), d = target.clone().sub(pair.origin).dot(pair.rayA)
      if (d < .065) continue
      const supportWidth = Math.max(.05, Math.min(.12, width * .18))
      // 高さの半分を基準とし、親の上端や回転部の明示した上限に収める。
      // 支持の長さや収納を理由に足元へ下げず、接着できる親と横位置を探す。
      const supportHeight = round(Math.max(.05, Math.min(height * .5, pair.b.height - .03, supportCeiling)))
      const o = pair.origin.clone().addScaledVector(pair.axis, target.clone().sub(pair.origin).dot(pair.axis))
      const foot = o.clone().addScaledVector(pair.rayA, d)
      const panel = api.makeFace(element.id + '/panel', foot.clone().addScaledVector(pair.axis, -width / 2), pair.axis, pair.rayB, width, height)
      panel.shape = template.shapes?.panel
      const parentIntervals = attachmentIntervals(api, pair.b, o.clone().addScaledVector(pair.rayB, supportHeight), pair.axis, pair.rayB)
      const childIntervals = attachmentIntervals(api, panel, foot.clone().addScaledVector(pair.rayB, supportHeight), pair.axis, pair.rayB)
      const offsets = []
      for (const a of parentIntervals) for (const b of childIntervals) {
        const lo = Math.max(a[0], b[0]) + supportWidth / 2 + 1e-5, hi = Math.min(a[1], b[1]) - supportWidth / 2 - 1e-5
        if (lo <= hi) offsets.push(Math.max(lo, Math.min(hi, 0)), (lo + hi) / 2, lo, hi)
      }
      if (!offsets.length) failures.add(`基準高さの接着幅が不足: ${nodeId}/${portId}`)
      for (const supportOffset of [...new Set(offsets.map(round))]) {
        try {
          const instance = structuredClone(template)
          instance.mount = mountAt(paper, pages, pair, target, width)
          instance.parameters = { ...instance.parameters, distance: d, offset: 0, supportHeight, supportWidth, supportOffset }
          const candidate = { ...element, part: instance }
          const evaluated = api.evaluateBookParts(project, { ...spread, elements: [...spread.elements, candidate] }, Math.PI, 0)
          const errors = api.inspectPaper(evaluated, [pages.gutter])
          if (errors.length) throw new Error(errors[0])
          const crossings = api.inspectIntersections(evaluated).filter((s) => s.includes(element.id + '/'))
          if (crossings.length) throw new Error(crossings[0])
          candidates.push({ candidate, parent: nodeId, portId, heightGap: Math.max(0, .5 - supportHeight / height), score: d + Math.abs(supportOffset) * .25 })
        } catch (error) { failures.add(error.message) }
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.heightGap - b.heightGap)
  for (const choice of candidates) {
    try {
      const candidateSpread = { ...spread, elements: [...spread.elements, choice.candidate] }, inspect = api.createPaperMotionInspector()
      for (const angle of [180, 120, 60, 15, 0]) for (const side of ['left', 'right']) {
        const left = side === 'left' ? angle * Math.PI / 180 : Math.PI, right = side === 'right' ? (180 - angle) * Math.PI / 180 : 0
        const result = api.evaluateBookParts(project, candidateSpread, left, right), input = api.pagePorts(w, depth, left, right).gutter
        const errors = [...inspect(result, [input]), ...api.inspectIntersections(result).filter((s) => s.includes(element.id + '/')),
          ...angle === 0 ? api.inspectClosedLayout(result.nodes[element.id], w, depth, input.rayA) : []]
        if (errors.length) throw new Error(errors[0])
      }
      return choice.candidate
    } catch (error) { failures.add(error.message) }
  }
  throw new Error(`${spread.id}/${element.id}: 背後から支持できる配置がありません (${x}, ${z})\n${[...failures].slice(0, 8).join('\n')}`)
}
