import { Box3, Matrix4, Vector3 } from 'three'

export interface VirtualStowOptions {
  pageWidth: number
  pageAspect: number
}

/** 作者の全開構図から一度だけ作る。実行中に収納方式を切り替える状態は持たない。 */
export interface VirtualStowPlan {
  openBounds: Box3
  pageWidth: number
  pageDepth: number
  targetHeight: number
  safeHeight: number
  safeHalfDepth: number
  containedBelow: number
  openHeight: number
  openHalfWidth: number
  openHalfDepth: number
}

export interface VirtualStowInput {
  /** baseTransform、機構自身の演出、面上の全子を含む二等分面座標の境界。 */
  bounds: Box3
  open: number
  leftAngle: number
  rightAngle: number
}

export interface VirtualStowEvaluation {
  /** シーン内の全子と影へ一度だけ左乗算する。実ページの平均角も含む。 */
  matrix: Matrix4
  canonicalMatrix: Matrix4
  scale: number
  translation: Vector3
  bounds: Box3
  canonicalBounds: Box3
  /** 紙面の二つの半空間の内部にある。全開の作者構図では紙面下を診断するだけ。 */
  contained: boolean
  /** 半開以下で紙の有限な半径と奥行きにも収まっている。 */
  withinPage: boolean
  clearance: number
  diagnostics: string[]
}

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value))
const smooth = (value: number) => { const u = clamp(value); return u * u * (3 - 2 * u) }
const finiteBox = (box: Box3) => box.isEmpty() || [...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)

export function compileVirtualStow(openBounds: Box3, options: VirtualStowOptions): VirtualStowPlan {
  if (!(Number.isFinite(options.pageWidth) && options.pageWidth > 0
    && Number.isFinite(options.pageAspect) && options.pageAspect > 0)) {
    throw new RangeError('Virtual stow requires finite positive page dimensions')
  }
  if (!finiteBox(openBounds)) throw new RangeError('Virtual stow requires finite open bounds')
  const pageDepth = options.pageWidth / options.pageAspect
  return {
    openBounds: openBounds.clone(), pageWidth: options.pageWidth, pageDepth,
    targetHeight: options.pageWidth * .35,
    safeHeight: options.pageWidth * .6,
    safeHalfDepth: pageDepth * .46,
    containedBelow: .55,
    openHeight: openBounds.isEmpty() ? 0 : Math.max(0, openBounds.max.y),
    openHalfWidth: openBounds.isEmpty() ? 0 : Math.max(Math.abs(openBounds.min.x), Math.abs(openBounds.max.x)),
    openHalfDepth: openBounds.isEmpty() ? 0 : Math.max(Math.abs(openBounds.min.z), Math.abs(openBounds.max.z)),
  }
}

/**
 * 紙面との接触を境に別のアニメーションへ切り替えず、凸な楔の不等式を直接解く。
 * 相似縮小率は二面の内側、上端、奥行きが許す上限の最小値になる。
 * min/maxで速度の折れはあり得るが、有限な連続入力に対する位置は連続する。
 * 全開近傍では巨大な作者構図を保ち、半開までに有限な紙の領域へ戻す。
 */
export function evaluateVirtualStow(plan: VirtualStowPlan, input: VirtualStowInput): VirtualStowEvaluation {
  if (![input.open, input.leftAngle, input.rightAngle].every(Number.isFinite) || !finiteBox(input.bounds)) {
    throw new RangeError('Virtual stow requires finite bounds and page angles')
  }
  const actualOpen = clamp((input.leftAngle - input.rightAngle) / Math.PI)
  // 入力openよりも実ページの間隔を安全側の正本にする。
  const open = Math.min(clamp(input.open), actualOpen)
  const theta = actualOpen * Math.PI / 2
  const sin = Math.sin(theta), cos = Math.max(0, Math.cos(theta))
  const mean = (input.leftAngle + input.rightAngle) / 2 - Math.PI / 2
  const rotation = new Matrix4().makeRotationZ(mean)
  const diagnostics: string[] = []
  const center = input.bounds.isEmpty() ? new Vector3() : input.bounds.getCenter(new Vector3())
  const half = input.bounds.isEmpty() ? new Vector3() : input.bounds.getSize(new Vector3()).multiplyScalar(.5)
  const translation = new Vector3()
  let scale = 1
  const canonicalMatrix = new Matrix4()

  if (!input.bounds.isEmpty() && open < 1 - 1e-12) {
    if (open <= 1e-10 || sin <= 1e-10) {
      // 閉状態は紙の面内の一点へ収束し、逆向き評価でも同じ値になる。
      scale = 0
      translation.set(0, plan.targetHeight, 0)
    } else {
      const release = smooth((open - plan.containedBelow) / (1 - plan.containedBelow))
      const maxHeight = Math.max(plan.safeHeight, plan.openHeight, input.bounds.max.y)
      const maxHalfWidth = Math.max(plan.safeHeight, plan.openHalfWidth, Math.abs(input.bounds.min.x), Math.abs(input.bounds.max.x))
      const maxHalfDepth = Math.max(plan.safeHalfDepth, plan.openHalfDepth, Math.abs(input.bounds.min.z), Math.abs(input.bounds.max.z))
      const top = plan.safeHeight + (maxHeight - plan.safeHeight) * release
      const halfWidth = plan.safeHeight + (maxHalfWidth - plan.safeHeight) * release
      const halfDepth = plan.safeHalfDepth + (maxHalfDepth - plan.safeHalfDepth) * release
      const route = Math.sin(open * Math.PI / 2) ** 2
      const margin = plan.pageWidth * .0005 * sin * (1 - open)

      // 中心の収納先を先に決める。許容体積の上端へ押し上げ続ける解を避け、
      // 角度0へ近づいたときも指定した一点へ連続的に収束させる。
      const preferredY = center.y * route + plan.targetHeight * (1 - route)
      const y = clamp(preferredY, plan.targetHeight * (1 - release), top * (.6 + .4 * release))

      // 中心も楔の余裕の半分までに限定し、偏った巨大部品の縮小余地を残す。
      const wedgeCenterLimit = cos > 1e-12 ? Math.max(0, (y * sin - margin) / (2 * cos)) : Infinity
      const xLimit = Math.min(wedgeCenterLimit, halfWidth * (.5 + release * .5))
      const x = clamp(center.x * route, -xLimit, xLimit)
      const zLimit = halfDepth * (.5 + release * .5)
      const z = clamp(center.z * route, -zLimit, zLimit)
      const denominator = half.y * sin + half.x * cos
      const wedgeScale = denominator > 1e-12 ? (y * sin - Math.abs(x) * cos - margin) / denominator : 1
      const topScale = half.y > 1e-12 ? (top - y) / half.y : 1
      const depthScale = half.z > 1e-12 ? (halfDepth - Math.abs(z)) / half.z : 1
      const widthScale = half.x > 1e-12 ? (halfWidth - Math.abs(x)) / half.x : 1
      scale = clamp(Math.min(1, wedgeScale, topScale, depthScale, widthScale))
      translation.set(x - center.x * scale, y - center.y * scale, z - center.z * scale)
    }
    canonicalMatrix.makeTranslation(translation.x, translation.y, translation.z)
      .multiply(new Matrix4().makeScale(scale, scale, scale))
  }

  const canonicalBounds = input.bounds.clone().applyMatrix4(canonicalMatrix)
  const matrix = rotation.multiply(canonicalMatrix)
  const bounds = input.bounds.clone().applyMatrix4(matrix)
  const maxX = canonicalBounds.isEmpty() ? 0 : Math.max(Math.abs(canonicalBounds.min.x), Math.abs(canonicalBounds.max.x))
  const clearance = canonicalBounds.isEmpty() ? Infinity : sin * canonicalBounds.min.y - cos * maxX
  const tolerance = plan.pageWidth * 1e-7
  const contained = clearance >= -tolerance
  const radius = canonicalBounds.isEmpty() ? 0 : Math.hypot(maxX, Math.max(Math.abs(canonicalBounds.min.y), Math.abs(canonicalBounds.max.y)))
  const withinPage = contained && radius <= plan.pageWidth + tolerance
    && (canonicalBounds.isEmpty() || canonicalBounds.min.z >= -plan.pageDepth / 2 - tolerance && canonicalBounds.max.z <= plan.pageDepth / 2 + tolerance)
  if (!contained) diagnostics.push('Open composition extends below the page wedge; raise the authored composition before playback')
  if (open <= plan.containedBelow && !withinPage) diagnostics.push('Virtual stow could not fit the finite page region')
  return { matrix, canonicalMatrix, scale, translation, bounds, canonicalBounds, contained, withinPage, clearance, diagnostics }
}
