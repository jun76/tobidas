import * as THREE from 'three'
import type { Book, Spread } from '../../schema/book'
import type { StageElement } from '../../schema/stageElement'
import { evaluateContentMotion } from '../motion'
import { evaluateElementTimeline } from '../timeline/evaluate'
import { compileSpreadStow } from './assign'
import type { SpanningVFold, StowItem } from './model'
import { GLUE_WIDTH_FACTOR } from './evaluate'

/**
 * 開姿勢の包含検査。保持中の全時刻について紙面包含を調べる。
 *
 * 収納コンパイラは「閉じられるか」を base transform だけで検証する。
 * こちらは反対に「開いている間ずっと紙の上にいるか」を、タイムラインで
 * 動いた後の姿勢について検証する。両方が通って初めて、部品は本を貫通せず
 * 紙面からもはみ出さない。
 *
 * 判定はすべて見開き座標 (背表紙 x=0、左ページ x∈[-w,0]、右ページ x∈[0,w]、
 * 奥行き z∈[-d/2,d/2]、紙面 y=0) で行う。
 */

export type ContainmentCode =
  | 'below-paper'
  | 'off-page'
  | 'crosses-spine'
  | 'shrunk-to-fit'
  | 'stow-warning'
  | 'orphan-child'
  | 'span-overhang'
  | 'airborne-budget'

export interface ContainmentIssue {
  spreadId: string
  elementId: string
  elementName: string
  code: ContainmentCode
  message: string
}

export interface ContainmentReport {
  errors: ContainmentIssue[]
  warnings: ContainmentIssue[]
}

/** 紙面 y=0 に対する許容。収納評価のリフト量 (SURFACE_Y) を下回らせない */
const FLOOR_TOLERANCE = 0.02
/** 紙の縁に対する許容。テクスチャの透明余白ぶんだけ緩める */
const EDGE_TOLERANCE = 0.05
/**
 * 空中部品の一見開きあたりの推奨上限。
 * 数えるのは絵を持つ部品だけで、子をぶら下げるだけの枠と粒子は除く。
 */
const AIRBORNE_BUDGET = 4

export function analyzeBookContainment(book: Book): ContainmentReport {
  const report: ContainmentReport = { errors: [], warnings: [] }
  for (const spread of book.spreads) {
    const spreadReport = analyzeSpreadContainment(book, spread)
    report.errors.push(...spreadReport.errors)
    report.warnings.push(...spreadReport.warnings)
  }
  return report
}

export function analyzeSpreadContainment(book: Book, spread: Spread): ContainmentReport {
  const errors: ContainmentIssue[] = []
  const warnings: ContainmentIssue[] = []
  const w = book.format.pageWidth
  const d = w / book.format.pageAspect
  const compiled = compileSpreadStow(book, spread)
  const items = [...compiled.left, ...compiled.right]
  const byId = new Map<string, StowItem>()
  for (const item of items) if (!byId.has(item.element.id)) byId.set(item.element.id, item)
  const spanningIds = new Set(compiled.spanning.map((span) => span.element.id))
  const elements = new Map(spread.elements.map((element) => [element.id, element]))
  const issue = (element: StageElement, code: ContainmentCode, message: string): ContainmentIssue =>
    ({ spreadId: spread.id, elementId: element.id, elementName: element.name, code, message })

  for (const warning of compiled.warnings) {
    errors.push({ spreadId: spread.id, elementId: '', elementName: '', code: 'stow-warning', message: warning })
  }

  for (const span of compiled.spanning) {
    errors.push(...spanIssues(span, w, d, spread.id))
    warnings.push(...spanWarnings(span, d, spread.id))
  }

  let airborne = 0
  for (const element of spread.elements) {
    const root = resolveRoot(element, elements)
    if (!root) {
      errors.push(issue(element, 'orphan-child', 'the parent chain does not resolve inside this spread'))
      continue
    }
    if (spanningIds.has(root.id)) {
      if (root.id !== element.id) {
        warnings.push(issue(element, 'orphan-child', `children of the spanning panel ${root.name} are not drawn`))
      }
      continue
    }
    const item = byId.get(root.id)
    if (!item) continue
    if (item.mechanism === 'airborne-route' && element.type === 'visual') airborne++
    if (root.id === element.id && item.fitScale < 1) {
      warnings.push(issue(element, 'shrunk-to-fit',
        `must shrink to ${(item.fitScale * 100).toFixed(0)}% while stowing to fit on the paper`
        + ` (${foldRoomHint(item, element, d)})`))
    }

    const chain = parentChain(element, elements)
    const faceShift = item.face === 'left' ? -w / 2 : w / 2
    const limit = pageLimit(item, w, d)
    let below: number | undefined
    let outside: THREE.Box3 | undefined
    for (const time of sampleTimes(spread)) {
      const posed = chain.map((link) => evaluateElementTimeline(link, spread, time))
      if (posed.some((link) => !link.visible)) continue
      for (const motionTime of motionSampleTimes(posed)) {
        const box = chainBox(posed, motionTime)
        if (!box) continue
        box.translate(new THREE.Vector3(item.offset[0] + faceShift, item.offset[1], item.offset[2]))
        if (box.min.y < -FLOOR_TOLERANCE && (below === undefined || box.min.y < below)) below = box.min.y
        if (!limit.containsBox(box)) outside = outside ? outside.union(box) : box.clone()
      }
    }
    if (below !== undefined) {
      errors.push(issue(element, 'below-paper', `sinks ${(-below).toFixed(2)} below the paper`))
    }
    if (outside) {
      const code = item.mechanism === 'airborne-route' ? 'off-page'
        : crossesSpine(outside, item.face) ? 'crosses-spine' : 'off-page'
      errors.push(issue(element, code, `${describeRange(outside)} overflows ${describeRange(limit)}`))
    }
  }
  if (airborne > AIRBORNE_BUDGET) {
    warnings.push({
      spreadId: spread.id, elementId: '', elementName: spread.name, code: 'airborne-budget',
      message: `${airborne} airborne parts (${AIRBORNE_BUDGET} or fewer recommended)`,
    })
  }
  return { errors, warnings }
}

/**
 * 部品が留まるべき見開き座標の箱。
 * 紙へ糊付けされる機構は帰属した片面から出られない。
 * 空中経路だけは見開き全体を移動できる。
 */
function pageLimit(item: StowItem, w: number, d: number): THREE.Box3 {
  const minX = item.mechanism === 'airborne-route' ? -w : item.face === 'left' ? -w : 0
  const maxX = item.mechanism === 'airborne-route' ? w : item.face === 'left' ? 0 : w
  return new THREE.Box3(
    new THREE.Vector3(minX - EDGE_TOLERANCE, -Infinity, -d / 2 - EDGE_TOLERANCE),
    new THREE.Vector3(maxX + EDGE_TOLERANCE, Infinity, d / 2 + EDGE_TOLERANCE),
  )
}

/**
 * 縮小せずに畳める高さと奥行きを添える。
 * assign.ts の相似縮小と同じ式を使うので、示した値なら必ず通る。
 */
function foldRoomHint(item: StowItem, element: StageElement, d: number): string {
  const z = element.baseTransform.position[2] + item.offset[2]
  const height = ('height' in element ? element.height : 2) * Math.max(...element.baseTransform.scale)
  const margin = 0.2
  if (item.fall === 'back') {
    return `needs height <= ${(z + d / 2 - margin).toFixed(2)} or z >= ${(height + margin - d / 2).toFixed(2)}`
  }
  if (item.fall === 'front') {
    return `needs height <= ${(d / 2 - z - margin).toFixed(2)} or z <= ${(d / 2 - height - margin).toFixed(2)}`
  }
  return `needs height <= ${(d / 2 - margin).toFixed(2)}`
}

function crossesSpine(box: THREE.Box3, face: StowItem['face']): boolean {
  return face === 'left' ? box.max.x > EDGE_TOLERANCE : box.min.x < -EDGE_TOLERANCE
}

function spanIssues(span: SpanningVFold, w: number, d: number, spreadId: string): ContainmentIssue[] {
  const issues: ContainmentIssue[] = []
  const at = (code: ContainmentCode, message: string) =>
    issues.push({ spreadId, elementId: span.element.id, elementName: span.element.name, code, message })
  if (span.baseY < -FLOOR_TOLERANCE) at('below-paper', `the crease foot is ${(-span.baseY).toFixed(2)} below the paper`)
  // 翼は糊しろ方向へ伸び、水平成分が制作幅、奥行き成分ぶんだけ背側へ寄る
  const horizontalLeft = span.widthLeft * span.fitScale * Math.sin(glueAngle())
  const horizontalRight = span.widthRight * span.fitScale * Math.sin(glueAngle())
  if (horizontalLeft > w + EDGE_TOLERANCE) at('off-page', `the left wing exceeds the left page width ${w}`)
  if (horizontalRight > w + EDGE_TOLERANCE) at('off-page', `the right wing exceeds the right page width ${w}`)
  const wing = Math.max(span.widthLeft, span.widthRight) * span.fitScale
  const glueTip = span.baseZ + (span.fall === 'front' ? -1 : 1) * wing * Math.cos(glueAngle())
  const glueOutside = span.fall === 'front'
    ? glueTip < -d / 2 - EDGE_TOLERANCE
    : glueTip > d / 2 + EDGE_TOLERANCE
  if (glueOutside) {
    // 直せる値を添える。翼は幅に比例するので、収まる幅は相似で出る
    const room = span.fall === 'front'
      ? span.baseZ + d / 2 + EDGE_TOLERANCE
      : d / 2 - span.baseZ + EDGE_TOLERANCE
    const width = (span.widthLeft + span.widthRight) / GLUE_WIDTH_FACTOR
    const maxWidth = Math.max(0, width * (room / Math.cos(glueAngle())) / wing)
    const edge = span.fall === 'front' ? -d / 2 : d / 2
    const limitZ = span.fall === 'front'
      ? wing * Math.cos(glueAngle()) - d / 2 - EDGE_TOLERANCE
      : d / 2 + EDGE_TOLERANCE - wing * Math.cos(glueAngle())
    at('off-page', `the wing tip passes the ${span.fall === 'front' ? 'far' : 'near'} edge ${edge.toFixed(2)}`
      + ` (needs width <= ${maxWidth.toFixed(2)} or z ${span.fall === 'front' ? '>=' : '<='} ${limitZ.toFixed(2)})`)
  }
  if (span.baseZ > d / 2 + EDGE_TOLERANCE) at('off-page', `the crease passes the near edge ${(d / 2).toFixed(2)}`)
  return issues
}

function spanWarnings(span: SpanningVFold, d: number, spreadId: string): ContainmentIssue[] {
  const warnings: ContainmentIssue[] = []
  if (span.fitScale < 1) {
    warnings.push({
      spreadId, elementId: span.element.id, elementName: span.element.name, code: 'shrunk-to-fit',
      message: `must shrink to ${(span.fitScale * 100).toFixed(0)}% while stowing to fit on the paper`,
    })
  }
  // 閉じ切りで折り目は手前へ倒れる。倒れた先が紙面から出るかを見る
  const flat = span.baseZ + (span.fall === 'front' ? 1 : -1) * span.height * span.fitScale * Math.sin(glueAngle())
  const overhang = span.fall === 'front' ? flat - d / 2 : -d / 2 - flat
  if (overhang > 0) warnings.push({
    spreadId, elementId: span.element.id, elementName: span.element.name, code: 'span-overhang',
    message: `overhangs ${overhang.toFixed(2)} ${span.fall === 'front' ? 'toward' : 'away from'} the viewer when closed`,
  })
  return warnings
}

function glueAngle(): number {
  return Math.asin(1 / GLUE_WIDTH_FACTOR)
}

/** 保持区間の走査時刻。全キー時刻に加え、補間の途中も一定間隔で見る */
function sampleTimes(spread: Spread): number[] {
  const hold = spread.sequence.holdSeconds
  const times = new Set<number>([0, hold])
  for (const track of spread.timeline.tracks) {
    if (track.target.type !== 'element') continue
    for (const key of track.keys) times.add(Math.min(hold, Math.max(0, key.time)))
  }
  const steps = 24
  for (let step = 1; step < steps; step++) times.add((hold * step) / steps)
  return [...times].sort((a, b) => a - b)
}

function resolveRoot(element: StageElement, elements: Map<string, StageElement>): StageElement | undefined {
  const chain = parentChain(element, elements)
  return chain[0]
}

/** 祖先から自分までの連鎖。循環や欠落があれば空を返す */
function parentChain(element: StageElement, elements: Map<string, StageElement>): StageElement[] {
  const chain: StageElement[] = [element]
  const seen = new Set([element.id])
  let cursor = element
  while (cursor.parent.type === 'element') {
    const parent = elements.get(cursor.parent.elementId)
    if (!parent || seen.has(parent.id)) return []
    chain.unshift(parent)
    seen.add(parent.id)
    cursor = parent
  }
  return chain
}

/**
 * 住人時間の走査時刻。周期運動が一巡し、自転が一回転するまでを覆う。
 * Content Motionは表示中ずっと続くため、包含は最大変位で判定する。
 */
function motionSampleTimes(chain: StageElement[]): number[] {
  let span = 0
  for (const element of chain) {
    for (const motion of element.motion) {
      span = Math.max(span, motion.type === 'spin'
        ? (2 * Math.PI) / Math.max(1e-6, Math.abs(motion.speed))
        : motion.period)
    }
  }
  if (span === 0) return [0]
  const steps = 12
  return Array.from({ length: steps }, (_, step) => (span * step) / steps)
}

/**
 * 連鎖を合成した親空間での軸並行境界。
 * 各リンクへ Base Transform と Content Motion を合成し、葉から根へ写す。
 * billboard は正対で自由に回るため、原点まわりの球で包む。
 */
function chainBox(chain: StageElement[], motionTime: number): THREE.Box3 | undefined {
  const element = chain[chain.length - 1]
  let box = localBox(element)
  if (!box) return undefined
  if (element.type === 'visual' && element.billboard) {
    const reach = Math.max(box.min.length(), box.max.length())
    box = new THREE.Box3(new THREE.Vector3(-reach, -reach, -reach), new THREE.Vector3(reach, reach, reach))
  }
  const matrix = new THREE.Matrix4()
  for (let index = chain.length - 1; index >= 0; index--) {
    box = box.applyMatrix4(livePoseMatrix(chain[index], motionTime, matrix))
  }
  return box
}

function livePoseMatrix(element: StageElement, motionTime: number, out: THREE.Matrix4): THREE.Matrix4 {
  const { position, rotation, scale } = element.baseTransform
  const delta = evaluateContentMotion(element.motion, motionTime)
  return out.compose(
    new THREE.Vector3(
      position[0] + delta.position[0],
      position[1] + delta.position[1],
      position[2] + delta.position[2],
    ),
    // 開姿勢の検査なので往復も自転も畳まれていない。両方を足した姿勢で包む
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(rotation[0] + delta.rotationDeg[0] + delta.spinDeg[0]),
      THREE.MathUtils.degToRad(rotation[1] + delta.rotationDeg[1] + delta.spinDeg[1]),
      THREE.MathUtils.degToRad(rotation[2] + delta.rotationDeg[2] + delta.spinDeg[2]),
    )),
    new THREE.Vector3(
      scale[0] * delta.scaleMul,
      scale[1] * delta.scaleMul,
      scale[2] * delta.scaleMul,
    ),
  )
}

/** 部品ローカルの板。Pivotは板の左下からの割合で、原点は板の外にも置ける */
function localBox(element: StageElement): THREE.Box3 | undefined {
  if (element.type === 'group') return undefined
  const [pivotX, pivotY] = element.pivot
  return new THREE.Box3(
    new THREE.Vector3(-pivotX * element.width, -pivotY * element.height, 0),
    new THREE.Vector3((1 - pivotX) * element.width, (1 - pivotY) * element.height, 0),
  )
}

function describeRange(box: THREE.Box3): string {
  const one = (value: number, unbounded: string) =>
    Number.isNaN(value) ? 'NaN' : Number.isFinite(value) ? value.toFixed(2) : unbounded
  const part = (min: number, max: number) => `${one(min, '-∞')}..${one(max, '∞')}`
  return `x ${part(box.min.x, box.max.x)} / y ${part(box.min.y, box.max.y)} / z ${part(box.min.z, box.max.z)}`
}
