import { Vector3 } from 'three'

/** 全開中の共面重複を検出する。印刷レイヤーは一枚の紙の描画順なので対象を区別する。 */
export function inspectSampleOverlaps(project, api) {
  const findings = new Map(), printedLayers = [], particleFields = []
  for (const spread of project.book.spreads) {
    const paper = api.evaluateBookParts(project, spread, Math.PI, 0)
    const bindings = api.bindBookContents(project, spread, paper, Math.PI, 0)
    const times = api.contentSampleTimes(bindings, spread.sequence.holdSeconds).filter(time => time <= spread.sequence.holdSeconds)
    const physical = paper.faces.map(face => ({ id: face.id, kind: face.support ? 'support' : 'paper', face }))
    for (const time of times) {
      const contents = api.evaluateContents(bindings, { openingAngleDeg: 180, maxOpeningAngleDeg: 180, holdTime: time, clock: () => time })
      const visuals = contents.filter(content => content.visible && content.element.type === 'visual' && content.element.presentation.kind === 'fiction').map(content => {
        const { element, matrix } = content
        const u = new Vector3().setFromMatrixColumn(matrix, 0), v = new Vector3().setFromMatrixColumn(matrix, 1)
        const width = u.length() * element.width, height = v.length() * element.height
        if (width * height < 1e-12) return undefined
        const origin = new Vector3(-element.width * element.pivot[0], -element.height * element.pivot[1], 0).applyMatrix4(matrix)
        return { id: content.id, kind: 'fiction', face: api.makeFace(content.id, origin, u.normalize(), v.normalize(), width, height) }
      }).filter(Boolean)
      // 粒子も実際の表示位置と大きさで検査する。発生範囲の長方形だけでは紙との重なりを拾えない。
      const particles = contents.filter(content => content.visible && content.element.type !== 'group'
        && (content.element.type === 'particle' || content.element.particles.enabled)).flatMap(content => {
        const triangles = api.contentTriangles(content, true), faces = []
        for (let i = 0; i < triangles.length; i += 2) {
          const [a, b, c] = triangles[i].map(vertex => vertex.point)
          const u = b.clone().sub(a), v = c.clone().sub(b), width = u.length(), height = v.length()
          if (width * height < 1e-12) continue
          const id = `${content.id}/particle-${i / 2}`
          faces.push({ id, kind: 'particle', face: api.makeFace(id, a, u.normalize(), v.normalize(), width, height) })
        }
        return faces
      })
      const surfaces = [...physical, ...visuals, ...particles]
      for (let i = 0; i < surfaces.length; i++) for (let j = i + 1; j < surfaces.length; j++) {
        const a = surfaces[i], b = surfaces[j]
        if (a.face.surfaceStack?.base.id === b.id || b.face.surfaceStack?.base.id === a.id) continue
        const area = api.coplanarOverlapArea(a.face, b.face)
        if (area < 1e-6) continue
        const key = spread.id + '/' + [a.id, b.id].sort().join('|')
        const record = findings.get(key) ?? { spreadId: spread.id, a: a.id, b: b.id, kinds: [a.kind, b.kind], maxArea: 0, times: [] }
        record.maxArea = Math.max(area, record.maxArea); record.times.push(time); findings.set(key, record)
      }
    }
    printedLayers.push({ spreadId: spread.id, ids: bindings.filter(b => b.element.presentation.kind === 'decal').map(b => b.id) })
    particleFields.push({ spreadId: spread.id, ids: bindings.filter(b => b.element.type !== 'group'
      && (b.element.type === 'particle' || b.element.particles.enabled)).map(b => b.id) })
  }
  const overlaps = [...findings.values()]
  const hasContent = item => item.kinds.some(kind => kind === 'fiction' || kind === 'particle')
  return { overlaps, physicalOverlaps: overlaps.filter(item => !hasContent(item)),
    orderedVisualOverlaps: overlaps.filter(hasContent), printedLayers, particleFields }
}

/** 小物を一律縮小せず、景観にだけ指定した寸法を使っているか原作と比較する。 */
export function inspectSampleDimensions(project, entries, layout) {
  const elements = new Map(project.book.spreads.flatMap(spread => spread.elements.map(element => [element.id, element])))
  const dimensions = [], errors = []
  for (const entry of entries) {
    if (layout.paper?.[entry.oldId] && entry.kind === 'fiction') errors.push(`Paper design became fiction: ${entry.oldId}`)
    if (entry.kind !== 'paper') continue
    const element = elements.get(entry.newIds[0])
    if (element?.type !== 'part' || element.part.definition.builtin !== 'upright') continue
    const factor = layout.paper?.[entry.oldId]?.scale ?? 1
    const original = [entry.before.width * entry.before.transform.scale[0], entry.before.height * entry.before.transform.scale[1]]
    const actual = [element.part.parameters.width, element.part.parameters.height].map(value => value * (element.part.uniformScale ?? 1))
    if (actual.some((value, axis) => Math.abs(value - original[axis] * factor) > 1e-6)) errors.push(`Unexpected paper size: ${entry.oldId}`)
    dimensions.push({ id: entry.oldId, original, actual, factor, individuallySized: factor !== 1 })
  }
  return { dimensions, errors }
}
