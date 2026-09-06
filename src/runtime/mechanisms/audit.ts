import * as THREE from 'three'
import type { Book, Spread } from '../../schema/book'
import type { StageElement } from '../../schema/stageElement'
import { mechanismBridgeIds, mechanismSchema } from '../../schema/mechanism'
import { realPageAnchorIssues } from '../../schema/mechanismPlacement'
import { evaluateAssemblyScene, assemblySceneBounds, type AssemblySurfaceInstance, type AssemblySceneInput, type AssemblyScene, type AssemblyConnection } from './scene'
import { bridgePointNames, mechanismSurfaceIds } from './evaluate'

export interface AssemblyAuditIssue { elementId: string; code: string; severity: 'error' | 'warning'; message: string }
export interface AssemblyAudit extends AssemblyConnectionAudit {
  samples: number
  surfaces: number
  maxExtent: number
  drivenAssemblies: number
  undrivenAssemblies: number
  unauthorizedTransforms: number
}

export interface AssemblyConnectionAudit {
  issues: AssemblyAuditIssue[]
  checkedConnections: number
  maxConnectionError: number
}

/**
 * 評価器の「接続済み」という診断は信頼せず、最終描画行列で接着残差を再計算する。
 * 可視面を先に渡し、非表示の支持面は構造面で補う。同じ面の描画後の移動も検出できる。
 */
export function inspectAssemblyConnections(
  input: Pick<AssemblySceneInput, 'leftAngle' | 'rightAngle'>,
  surfaces: Pick<AssemblySurfaceInstance, 'elementId' | 'surface' | 'matrix'>[],
  connections: AssemblyConnection[],
): AssemblyConnectionAudit {
  const report: AssemblyConnectionAudit = { issues: [], checkedConnections: 0, maxConnectionError: 0 }
  const bySurface = new Map<string, typeof surfaces[number]>()
  for (const surface of surfaces) {
    const key = `${surface.elementId}/${surface.surface.id}`
    if (!bySurface.has(key)) bySurface.set(key, surface)
  }
  const pointAt = (elementId: string, surfaceId: string, vertexId: string): THREE.Vector3 | undefined => {
    const entry = bySurface.get(`${elementId}/${surfaceId}`)
    if (!entry) return undefined
    const index = entry.surface.vertexIds.indexOf(vertexId)
    if (index < 0 || index * 3 + 2 >= entry.surface.positions.length) return undefined
    const point = new THREE.Vector3(...entry.surface.positions.slice(index * 3, index * 3 + 3) as [number, number, number]).applyMatrix4(entry.matrix)
    return point.toArray().every(Number.isFinite) ? point : undefined
  }
  const add = (elementId: string, code: string, message: string) => {
    if (!report.issues.some((issue) => issue.elementId === elementId && issue.code === code)) report.issues.push({ elementId, code, severity: 'error', message })
  }
  const sharedVertices = new Map<string, THREE.Vector3>()
  for (const entry of bySurface.values()) for (const vertexId of entry.surface.vertexIds) {
    const point = pointAt(entry.elementId, entry.surface.id, vertexId)
    const key = `${entry.elementId}/${vertexId}`
    const previous = sharedVertices.get(key)
    if (!point) {
      add(entry.elementId, 'non-finite-scene-vertex', `Vertex ${vertexId} has no finite position after scene transforms`)
    } else {
      if (previous && previous.distanceTo(point) > 1e-6) add(entry.elementId, 'broken-scene-seam',
        `Shared vertex ${vertexId} is separated after scene transforms`)
      sharedVertices.set(key, point)
    }
  }
  for (const connection of connections) {
    const { actual, expected, elementId } = connection
    const point = pointAt(actual.elementId, actual.surfaceId, actual.vertexId)
    let target: THREE.Vector3 | undefined
    if (expected.type === 'page') {
      const angle = expected.side === 'left' ? input.leftAngle : input.rightAngle
      target = new THREE.Vector3(Math.cos(angle) * expected.distance, Math.sin(angle) * expected.distance, expected.z)
    } else if (expected.weights.length
      && expected.weights.every(({ weight }) => Number.isFinite(weight) && weight >= -1e-7)
      && Math.abs(expected.weights.reduce((sum, { weight }) => sum + weight, 0) - 1) <= 1e-7) {
      target = new THREE.Vector3()
      for (const { vertexId, weight } of expected.weights) {
        const vertex = pointAt(expected.elementId, expected.surfaceId, vertexId)
        if (!vertex) { target = undefined; break }
        target.addScaledVector(vertex, weight)
      }
    }
    if (actual.elementId !== elementId || !point || !target?.toArray().every(Number.isFinite)) {
      add(elementId, 'missing-connection-geometry', `Connection ${actual.vertexId} has no finite independent attachment geometry`)
      continue
    }
    report.checkedConnections++
    const error = point.distanceTo(target)
    report.maxConnectionError = Math.max(report.maxConnectionError, error)
    if (error > 1e-6) add(elementId, expected.type === 'page' ? 'detached-page-anchor' : 'detached-parent-anchor',
      `Connection ${actual.vertexId} is separated from its ${expected.type} target by ${error.toPrecision(6)} after scene transforms`)
  }
  return report
}

/** 頂点が実座標へ解かれた後の、暗黙の一括移動・縮小や駆動記録の欠落を検出する。 */
export function inspectAssemblyScene(spread: Spread, input: AssemblySceneInput, scene: AssemblyScene): AssemblyConnectionAudit & { unauthorizedTransforms: number } {
  const surfaces = [...scene.surfaces, ...scene.structuralSurfaces]
  const report = { ...inspectAssemblyConnections(input, surfaces, scene.connections), unauthorizedTransforms: 0 }
  const add = (issue: AssemblyAuditIssue) => {
    if (!report.issues.some((existing) => existing.elementId === issue.elementId && existing.code === issue.code)) report.issues.push(issue)
  }
  for (const issue of scene.issues) add(issue)
  const unauthorized = new Set<string>()
  const identity = new THREE.Matrix4().elements
  for (const entry of surfaces) if (entry.matrix.elements.some((value, i) => !Number.isFinite(value) || Math.abs(value - identity[i]) > 1e-7)) unauthorized.add(entry.elementId)
  for (const element of spread.elements) {
    if (element.type !== 'assembly') continue
    const entries = surfaces.filter((entry) => entry.elementId === element.id)
    const connections = scene.connections.filter((entry) => entry.elementId === element.id)
    const mount = element.mechanism.mount
    if (mount.type === 'bridge' && !scene.bridges.some((bridge) => bridge.elementId === mount.elementId && bridge.id === mount.bridgeId)) {
      add({ elementId: element.id, code: 'missing-scene-bridge', severity: 'error', message: 'The final scene has no evaluated parent bridge for this folding child' })
    }
    if (bridgePointNames.some((name) => !connections.some((connection) => connection.actual.vertexId === `anchor-${name}`))) {
      add({ elementId: element.id, code: 'incomplete-driver-anchors', severity: 'error', message: 'The final scene does not retain all six real attachment references for this assembly' })
    }
    const point = (id: string) => {
      const entry = entries.find((candidate) => candidate.surface.vertexIds.includes(id))
      if (!entry) return undefined
      const i = entry.surface.vertexIds.indexOf(id)
      return new THREE.Vector3(...entry.surface.positions.slice(i * 3, i * 3 + 3) as [number, number, number]).applyMatrix4(entry.matrix)
    }
    const stage = element.mechanism.staging
    if (stage.openScale === 1 && stage.closedScale === 1) {
      // 浮遊を指定しても、基部の幅と奥行きを勝手に縮める許可にはならない。
      for (const [a, b] of [['leftBack', 'rightBack'], ['creaseBack', 'creaseFront']] as const) {
        const anchorA = point(`anchor-${a}`), anchorB = point(`anchor-${b}`), baseA = point(`base-${a}`), baseB = point(`base-${b}`)
        if (anchorA && anchorB && baseA && baseB && anchorB.sub(anchorA).distanceTo(baseB.sub(baseA)) > 1e-6) unauthorized.add(element.id)
      }
    }
    if (stage.openPosition.every((value) => value === 0) && stage.closedPosition.every((value) => value === 0) && stage.floatAmplitude.every((value) => value === 0)) {
      // 指定された拡縮の中心は駆動面の折り線中央。無指定の退避先へ寄せない。
      const anchorBack = point('anchor-creaseBack'), anchorFront = point('anchor-creaseFront')
      const baseBack = point('base-creaseBack'), baseFront = point('base-creaseFront')
      if (anchorBack && anchorFront && baseBack && baseFront && anchorBack.add(anchorFront).distanceTo(baseBack.add(baseFront)) > 2e-6) unauthorized.add(element.id)
    }
  }
  for (const elementId of unauthorized) add({ elementId, code: 'unauthorized-scene-transform', severity: 'error',
    message: 'Assembly was moved or scaled after solving its real attachment geometry, without a matching explicit staging instruction' })
  report.unauthorizedTransforms = unauthorized.size
  return report
}

function assemblyElements(spread: Spread): StageElement[] {
  const byId = new Map(spread.elements.map((element) => [element.id, element]))
  return spread.elements.filter((element) => {
    const seen = new Set<string>()
    let current: StageElement | undefined = element
    while (current && !seen.has(current.id)) {
      if (current.type === 'assembly') return true
      seen.add(current.id)
      current = current.parent.type === 'element' ? byId.get(current.parent.elementId) : undefined
    }
    return false
  })
}

/** 既存の包含検査と同様に24分割し、短いキー区間の端と途中も落とさない。 */
function holdSampleTimes(spread: Spread, elements: StageElement[]): number[] {
  const ids = new Set(elements.map((element) => element.id))
  const tracks = spread.timeline.tracks.filter((track) => track.target.type === 'element' && ids.has(track.target.elementId))
  if (!tracks.length) return [0]
  const hold = spread.sequence.holdSeconds
  const times = new Set([0, hold])
  for (const track of tracks) {
    const keys = track.keys.map((key) => Math.max(0, Math.min(hold, key.time))).sort((a, b) => a - b)
    for (const time of keys) times.add(time)
    for (let i = 1; i < keys.length; i++) times.add((keys[i - 1] + keys[i]) / 2)
  }
  for (let step = 1; step < 24; step++) times.add(hold * step / 24)
  return [...times].sort((a, b) => a - b)
}

/**
 * 最長周期だけの等分では短い周期が同じ位相へ重なるので、各周期を個別に走査する。
 * 位相付きの浮遊とContent Motionの極値も加える。driftのYは実装どおり0.83倍の角速度。
 * 有限個の標本による診断であり、任意周期の全組合せや全時刻の無衝突の証明ではない。
 */
function clockSampleTimes(elements: StageElement[]): number[] {
  const times = new Set([0])
  const periods = new Set<number>()
  const addWave = (period: number, phase: number) => {
    periods.add(period)
    for (const extreme of [Math.PI / 2, Math.PI * 3 / 2]) {
      const angle = ((extreme - phase) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
      times.add(period * angle / (Math.PI * 2))
    }
  }
  for (const element of elements) {
    if (element.type === 'assembly' && element.mechanism.deployment.mode === 'virtual') {
      const stage = element.mechanism.staging
      for (let axis = 0; axis < 3; axis++) if (stage.floatAmplitude[axis] !== 0) {
        addWave(stage.floatPeriod, stage.floatPhase + axis * Math.PI / 3)
      }
    }
    for (const motion of element.motion) {
      if (motion.type === 'spin') {
        if (motion.speed !== 0) periods.add(Math.PI * 2 / Math.abs(motion.speed))
      } else if (motion.type === 'drift') {
        if (motion.amplitude[0] !== 0) addWave(motion.period, motion.phase)
        if (motion.amplitude[1] !== 0) addWave(motion.period / .83, motion.phase * .83)
        if (motion.amplitude[2] !== 0) addWave(motion.period, motion.phase + Math.PI / 2)
      } else if (motion.amplitude !== 0) addWave(motion.period, motion.phase)
    }
  }
  for (const period of periods) for (let step = 1; step < 12; step++) times.add(period * step / 12)
  return [...times].sort((a, b) => a - b)
}

/** 保持キーとContent Motionの検査時刻。実駆動の途中姿勢とは別の時間軸を網羅する。 */
export function assemblyAuditSampleTimes(spread: Spread): { holdTimes: number[]; clocks: number[] } {
  const relevant = assemblyElements(spread)
  return { holdTimes: holdSampleTimes(spread, relevant), clocks: clockSampleTimes(relevant) }
}

/** 機構の方式に応じて接続と収納を検査する。全開の大きさは拒否条件にしない。 */
export function auditAssemblies(book: Book, spread: Spread): AssemblyAudit {
  const report: AssemblyAudit = { issues: [], samples: 0, surfaces: 0, maxExtent: 0,
    checkedConnections: 0, maxConnectionError: 0, drivenAssemblies: 0, undrivenAssemblies: 0, unauthorizedTransforms: 0 }
  const add = (issue: AssemblyAuditIssue) => {
    if (!report.issues.some((existing) => existing.elementId === issue.elementId && existing.code === issue.code)) report.issues.push(issue)
  }
  const assemblies = spread.elements.filter((element) => element.type === 'assembly')
  if (!assemblies.length) return report
  const byId = new Map(spread.elements.map((element) => [element.id, element]))
  let invalidSchema = false
  for (const element of assemblies) {
    const parsed = mechanismSchema.safeParse(element.mechanism)
    if (!parsed.success) {
      invalidSchema = true
      add({ elementId: element.id, code: 'invalid-drive-contract', severity: 'error',
        message: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') })
    }
    const deployment = element.mechanism.deployment
    if ('start' in deployment || 'end' in deployment) {
      invalidSchema = true
      add({ elementId: element.id, code: 'invalid-drive-contract', severity: 'error',
        message: 'Local deployment timing cannot replace the real page or parent bridge driver' })
    }
    const seen = new Set<string>()
    let current = element
    let connected = false
    while (!seen.has(current.id)) {
      seen.add(current.id)
      const mount = current.mechanism.mount
      if (mount.type === 'page' || mount.type === 'gutter') {
        connected = current.parent.type !== 'element'
        break
      }
      if (mount.type !== 'surface' && mount.type !== 'bridge') break
      if (current.parent.type !== 'element' || current.parent.elementId !== mount.elementId) break
      const parent = byId.get(mount.elementId)
      if (parent?.type !== 'assembly') break
      if (mount.type === 'bridge' && !mechanismBridgeIds(parent.mechanism).includes(mount.bridgeId)) break
      if (mount.type === 'surface' && (current.mechanism.kind !== 'panel' || !mechanismSurfaceIds(parent.mechanism).includes(mount.surfaceId))) break
      current = parent
    }
    if (connected && parsed.success) report.drivenAssemblies++
    else {
      report.undrivenAssemblies++
      add({ elementId: element.id, code: 'missing-drive-chain', severity: 'error',
        message: 'Assembly does not resolve through compatible parent bridges or panel surfaces to a real page attachment' })
    }
  }
  // 不正な旧データを既定値で救済したり、評価器の例外から合格扱いへ落とさない。
  if (invalidSchema) return report
  for (const element of assemblies) {
    const issues = realPageAnchorIssues(element, book.format)
    if (issues.length) add({ elementId: element.id, code: 'invalid-page-anchor', severity: 'error', message: issues.join('; ') })
    if (spread.timeline.tracks.some((track) => track.target.type === 'element' && track.target.elementId === element.id
      && /^(position|rotation|scale)(\.|$)/.test(track.property))) add({ elementId: element.id, code: 'invalid-drive-transform', severity: 'error',
      message: 'Assembly transform tracks cannot replace the real attachment driver; use explicit mechanism staging' })
  }
  const { holdTimes, clocks } = assemblyAuditSampleTimes(spread)
  const unauthorizedElements = new Set<string>()
  const undrivenElements = new Set(report.issues.filter((issue) => issue.code === 'missing-drive-chain').map((issue) => issue.elementId))
  for (const element of spread.elements) {
    const attachment = element.type === 'assembly' && element.mechanism.mount.type === 'surface'
      ? element.mechanism.mount : element.surfaceAttachment
    if (!attachment) continue
    const parentId = element.parent.type === 'element' ? element.parent.elementId : undefined
    const parent = assemblies.find((candidate) => candidate.id === parentId)
    if (!parent || !mechanismSurfaceIds(parent.mechanism).includes(attachment.surfaceId)) {
      add({ elementId: element.id, code: 'unknown-surface', severity: 'error', message: `Unknown attachment surface ${attachment.surfaceId}` })
    }
  }
  const inspectScene = (open: number, reverse: boolean, spreadTime: number, clock: number) => {
      const leftAngle = reverse ? Math.PI * open : Math.PI
      const rightAngle = reverse ? 0 : Math.PI * (1 - open)
      const context = `openness ${open.toFixed(3)} (${reverse ? 'outgoing' : 'incoming'}, hold ${spreadTime.toFixed(3)}s, clock ${clock.toFixed(3)}s)`
      const input = { open, leftAngle, rightAngle, clock, spreadTime }
      const scene = evaluateAssemblyScene(book, spread, input)
      const inspected = inspectAssemblyScene(spread, input, scene)
      report.checkedConnections += inspected.checkedConnections
      report.maxConnectionError = Math.max(report.maxConnectionError, inspected.maxConnectionError)
      for (const issue of inspected.issues) {
        add({ ...issue, message: `${issue.message} at ${context}` })
        if (issue.code === 'unauthorized-scene-transform') unauthorizedElements.add(issue.elementId)
        if (['missing-driver', 'invalid-driver', 'missing-real-root', 'unsupported-parent', 'incomplete-driver-anchors', 'missing-scene-bridge'].includes(issue.code)) undrivenElements.add(issue.elementId)
      }
      report.unauthorizedTransforms = unauthorizedElements.size
      report.undrivenAssemblies = undrivenElements.size
      report.drivenAssemblies = assemblies.length - report.undrivenAssemblies
      report.samples++
      report.surfaces = Math.max(report.surfaces, scene.surfaces.length)
      const bounds = assemblySceneBounds(scene)
      if (!bounds.isEmpty()) {
        const extent = bounds.getSize(new THREE.Vector3()).length()
        report.maxExtent = Math.max(report.maxExtent, extent)
        if (!Number.isFinite(extent)) add({ elementId: '', code: 'non-finite-bounds', severity: 'error', message: `Assembly bounds are not finite at ${context}` })
      }
      if (open === 0 && (scene.surfaces.length || scene.visuals.length)) {
        add({ elementId: '', code: 'closed-visible', severity: 'error', message: `Closed spread retains visible parts at ${context}` })
      }
      // 全開の外周越えは自由表現として残し、保持中に紙面下へ沈む姿勢はエラーにする。
      // 診断のために作者の全開形状や浮遊軌道を補正しない。
      const checkPoint = (point: THREE.Vector3, elementId: string) => {
        const leftDistance = Math.sin(leftAngle) * point.x - Math.cos(leftAngle) * point.y
        const rightDistance = -Math.sin(rightAngle) * point.x + Math.cos(rightAngle) * point.y
        if (Math.min(leftDistance, rightDistance) < -1e-4) add({ elementId, code: 'page-penetration', severity: 'error',
          message: `Visible assembly crosses a page at ${context}` })
      }
      for (const entry of scene.surfaces) for (let vertex = 0; vertex < entry.surface.positions.length; vertex += 3) {
        checkPoint(new THREE.Vector3(...entry.surface.positions.slice(vertex, vertex + 3) as [number, number, number]).applyMatrix4(entry.matrix), entry.elementId)
      }
      for (const { element, matrix } of scene.visuals) {
        if (element.type !== 'visual' && element.type !== 'particle') continue
        for (const u of [0, 1]) for (const v of [0, 1]) checkPoint(new THREE.Vector3(
          (u - element.pivot[0]) * element.width, (v - element.pivot[1]) * element.height, 0).applyMatrix4(matrix), element.id)
      }
  }
  // 開くときは保持先頭、閉じるときは保持終端の姿勢を使う。
  for (let i = 0; i <= 40; i++) {
    const open = i / 40
    for (const reverse of [false, true]) {
      for (const clock of clocks) inspectScene(open, reverse, reverse ? spread.sequence.holdSeconds : 0, clock)
    }
  }
  for (const time of holdTimes) {
    if (time === 0 || time === spread.sequence.holdSeconds) continue // 全開の両端は上で検査済み。
    for (const clock of clocks) inspectScene(1, false, time, clock)
  }
  return report
}
