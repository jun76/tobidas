import * as THREE from 'three'
import type { Book, Spread } from '../../schema/book'
import type { StageElement } from '../../schema/stageElement'
import { realPageAnchorIssues } from '../../schema/mechanismPlacement'
import { evaluateAssemblyScene, assemblySceneBounds } from './scene'
import { evaluateMechanism, mechanismSurfaceIds } from './evaluate'

export interface AssemblyAuditIssue { elementId: string; code: string; severity: 'error' | 'warning'; message: string }
export interface AssemblyAudit { issues: AssemblyAuditIssue[]; samples: number; surfaces: number; maxExtent: number }

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

/** 機構の方式に応じて接続と収納を検査する。全開の大きさは拒否条件にしない。 */
export function auditAssemblies(book: Book, spread: Spread): AssemblyAudit {
  const report: AssemblyAudit = { issues: [], samples: 0, surfaces: 0, maxExtent: 0 }
  const add = (issue: AssemblyAuditIssue) => {
    if (!report.issues.some((existing) => existing.elementId === issue.elementId && existing.code === issue.code)) report.issues.push(issue)
  }
  const assemblies = spread.elements.filter((element) => element.type === 'assembly')
  if (!assemblies.length) return report
  for (const element of assemblies) {
    const issues = realPageAnchorIssues(element, book.format)
    if (issues.length) add({ elementId: element.id, code: 'invalid-page-anchor', severity: 'error', message: issues.join('; ') })
  }
  const relevant = assemblyElements(spread)
  const holdTimes = holdSampleTimes(spread, relevant)
  const clocks = clockSampleTimes(relevant)
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
      const scene = evaluateAssemblyScene(book, spread, { open, leftAngle, rightAngle, clock, spreadTime })
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
      for (const message of scene.diagnostics) {
        if (message.includes('unknown surface') || message.includes('missing surface') || message.includes('cyclic')) {
          add({ elementId: '', code: message, severity: 'error', message: `${message} at ${context}` })
        }
      }
  }
  // 開くときは保持先頭、閉じるときは保持終端の姿勢を使う。
  for (let i = 0; i <= 40; i++) {
    const open = i / 40
    for (const reverse of [false, true]) {
      const leftAngle = reverse ? Math.PI * open : Math.PI
      const rightAngle = reverse ? 0 : Math.PI * (1 - open)
      for (const element of assemblies) {
        const result = evaluateMechanism(element.mechanism, { open, leftAngle, rightAngle, clock: 0 })
        for (const issue of result.diagnostics) add({ ...issue, elementId: element.id })
      }
      for (const clock of clocks) inspectScene(open, reverse, reverse ? spread.sequence.holdSeconds : 0, clock)
    }
  }
  for (const time of holdTimes) {
    if (time === 0 || time === spread.sequence.holdSeconds) continue // 全開の両端は上で検査済み。
    for (const clock of clocks) inspectScene(1, false, time, clock)
  }
  return report
}
