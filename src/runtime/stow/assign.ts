import type { Book, Spread } from '../../schema/book'
import type { StageElement } from '../../schema/stageElement'
import { FIT_SCALE_ONSET_F, GLUE_WIDTH_FACTOR, settledT, vfoldLidAngle } from './evaluate'
import { childrenByParent, contactMargin, penetrationEpsilon, spreadOpenBounds, subtreeOpenBounds } from './geometry'
import type { CompiledSpreadStow, FaceSide, FallDirection, MechanismKind, PlanarElement, SpanningVFold, StowItem } from './model'

export type { CompiledSpreadStow, FaceSide, FallDirection, MechanismKind, SpanningVFold, StowItem } from './model'

/**
 * 収納コンパイラの割り当て段。
 *
 * 完全に開いた姿勢から各要素へ支持機構を割り当て、
 * 包含検証から開き始めの位相と相似縮小の目標値を導出する。
 * 結果は保存されず、同じBookから決定的に再導出される。
 */

export function compileSpreadStow(book: Book, spread: Spread): CompiledSpreadStow {
  const w = book.format.pageWidth
  const d = w / book.format.pageAspect
  const left: StowItem[] = []
  const right: StowItem[] = []
  const spanning: SpanningVFold[] = []
  const warnings: string[] = []

  const children = childrenByParent(spread)
  const rootsWithChildren = new Set(children.keys())
  const airborneRoots = new Set(spread.elements
    .filter((element) => element.parent.type !== 'element'
      && subtreeOpenBounds(element, children).min[1] > contactMargin(w) + penetrationEpsilon(w))
    .map((element) => element.id))
  const flatSpanning = new Set<string>()

  // 先に見開きまたぎパネルを集める。作者のプリセットではなく、開姿勢で
  // 画像板が中央線をまたぐかを決め手にする。面上の部品はパネルの蓋 (降りてくる翼)
  // を第二の天井として包含検証するため、蓋の被覆範囲を先へ確定させる
  for (const element of spread.elements) {
    if (element.parent.type === 'element') continue
    const crossing = spineCrossingKind(element, w, rootsWithChildren.has(element.id), airborneRoots.has(element.id), children)
    if (crossing === 'flat') {
      const wings = makeFlatSpineWings(element, w)
      if (wings) {
        left.push(wings.left)
        right.push(wings.right)
        flatSpanning.add(element.id)
      }
      continue
    }
    if (crossing !== 'upright') continue
    const span = makeSpanningVFold(element, w, d, warnings)
    if (span) spanning.push(span)
  }
  const lid = spanning.length === 0 ? undefined : {
    z0: Math.min(...spanning.map((s) => s.baseZ)),
    zFront: Math.max(...spanning.map((s) => s.baseZ + s.height)),
    reachLeft: Math.max(...spanning.map((s) => s.widthLeft)) / GLUE_WIDTH_FACTOR,
    reachRight: Math.max(...spanning.map((s) => s.widthRight)) / GLUE_WIDTH_FACTOR,
  }

  for (const element of spread.elements) {
    if (element.parent.type === 'element') continue // 子要素は親へ剛体追従する
    const mechanism = resolveMechanism(element, airborneRoots.has(element.id))
    const homeFace: FaceSide = element.parent.type === 'left-page' ? 'left'
      : 'right'

    if (flatSpanning.has(element.id)) continue // 左右ページへ分割済み
    if (spanning.some((span) => span.element.id === element.id)) continue // 収集済み
    const offset = faceOffset(element, homeFace, w)
    const preferredFall = resolveFlapFall(element, offset, d)
    const corrected = verifyAndCorrect(element, mechanism, preferredFall, homeFace, offset, w, d, warnings, lid)
    const item: StowItem = { element, face: homeFace, offset, mechanism, ...corrected }
    ;(homeFace === 'left' ? left : right).push(item)
  }

  const byLayer = (a: StowItem, b: StowItem) => a.element.layer - b.element.layer
  left.sort(byLayer)
  right.sort(byLayer)
  spanning.sort((a, b) => a.element.layer - b.element.layer)
  return { left, right, spanning, warnings }
}

/**
 * 背をまたぐ一枚パネルの構成。折り目はアートワーク上で背表紙 (x=0) に
 * 一致する位置へ置く。ヒンジが背表紙にないと畳めないため、制作者の
 * crease値ではなく開姿勢の配置から導出する。
 */
function makeSpanningVFold(element: StageElement, pageWidth: number, pageDepth: number, warnings: string[]): SpanningVFold | null {
  const dimensions = planarDimensions(element)
  if (!dimensions) {
    warnings.push(`${element.name}: v-fold supports planar parts only`)
    return null
  }
  const width = dimensions.width * Math.abs(element.baseTransform.scale[0])
  const height = dimensions.height * Math.abs(element.baseTransform.scale[1])
  const centerX = spreadX(element, pageWidth)
  const xLeft = centerX - element.pivot[0] * width
  const xRight = xLeft + width
  const creaseU = Math.min(0.95, Math.max(0.05, (0 - xLeft) / Math.max(1e-6, width)))
  const rawLeft = Math.max(0, -xLeft)
  const rawRight = Math.max(0, xRight)
  const widthFit = pageWidth / Math.max(pageWidth, rawLeft, rawRight)
  const fall = element.stow.fallDirection === 'back' ? 'back' : 'front'
  const flatRoom = Math.max(0.01, fall === 'front'
    ? pageDepth / 2 - element.baseTransform.position[2]
    : element.baseTransform.position[2] + pageDepth / 2)
  const depthFit = flatRoom / Math.max(flatRoom, height * Math.sin(Math.asin(1 / GLUE_WIDTH_FACTOR)))
  const glueRoom = Math.max(0.01, fall === 'front'
    ? element.baseTransform.position[2] + pageDepth / 2
    : pageDepth / 2 - element.baseTransform.position[2])
  const glueDepth = Math.max(rawLeft, rawRight) * GLUE_WIDTH_FACTOR
    * Math.cos(Math.asin(1 / GLUE_WIDTH_FACTOR))
  const glueFit = glueRoom / Math.max(glueRoom, glueDepth)
  return {
    element: element as PlanarElement,
    fall,
    creaseU,
    // 糊しろは背側へ角度を持つため、開き切りの水平スパンが制作値と
    // 一致するよう糊しろ方向の長さを補正する
    widthLeft: rawLeft * GLUE_WIDTH_FACTOR,
    widthRight: rawRight * GLUE_WIDTH_FACTOR,
    height,
    baseY: element.baseTransform.position[1] - element.pivot[1] * height,
    baseZ: element.baseTransform.position[2],
    fitScale: Math.min(1, widthFit, depthFit, glueFit),
  }
}

function resolveMechanism(element: StageElement, isAirborne = false): MechanismKind {
  if (isAirborne) return 'airborne-route'
  const rotX = element.baseTransform.rotation[0]
  if (Math.abs(rotX + 90) < 35 || Math.abs(rotX - 90) < 35) return 'page-glue'
  return 'flap'
}

/** 片面ローカルのxを、完全に開いた見開きのxへ写す。 */
function spreadX(element: StageElement, pageWidth: number): number {
  if (element.parent.type === 'left-page') return element.baseTransform.position[0] - pageWidth / 2
  if (element.parent.type === 'right-page') return element.baseTransform.position[0] + pageWidth / 2
  return element.baseTransform.position[0]
}

/** 平面部品が中央線をまたぐとき、開姿勢に応じて谷折りの種類を返す。 */
function spineCrossingKind(
  element: StageElement,
  pageWidth: number,
  hasChildren: boolean,
  isAirborne: boolean,
  children: Map<string, StageElement[]>,
): 'flat' | 'upright' | null {
  const dimensions = planarDimensions(element)
  if (!dimensions || element.type === 'visual' && element.billboard || hasChildren) return null
  if (resolveMechanism(element, isAirborne) === 'airborne-route') return null
  const bounds = spreadOpenBounds(element, children, pageWidth)
  const x0 = bounds.min[0]
  const x1 = bounds.max[0]
  const epsilon = pageWidth * 1e-4
  if (!(x0 < -epsilon && x1 > epsilon)) return null
  const rotationX = Math.abs(element.baseTransform.rotation[0])
  if (Math.abs(rotationX - 90) < 35) return 'flat'
  return rotationX <= 35 ? 'upright' : null
}

function planarDimensions(element: StageElement): { width: number; height: number } | null {
  return element.type === 'visual' || element.type === 'particle' ? { width: element.width, height: element.height } : null
}

/** 紙面へ寝ている中央線またぎ部品を、左右ページへ追従する二片へ分ける。 */
function makeFlatSpineWings(element: StageElement, pageWidth: number): { left: StowItem; right: StowItem } | null {
  const dimensions = planarDimensions(element)
  if (!dimensions) return null
  const scaledWidth = dimensions.width * Math.abs(element.baseTransform.scale[0])
  const centerX = spreadX(element, pageWidth)
  const xLeft = centerX - element.pivot[0] * scaledWidth
  const creaseU = Math.min(0.999, Math.max(0.001, -xLeft / Math.max(1e-6, scaledWidth)))
  const baseOffset = (face: FaceSide): [number, number, number] => {
    const targetLocal = centerX + (face === 'left' ? pageWidth / 2 : -pageWidth / 2)
    return [targetLocal - element.baseTransform.position[0], 0, 0]
  }
  const wing = (face: FaceSide, u0: number, u1: number): StowItem => {
    const width = dimensions.width * (u1 - u0)
    const scaledWidth = width * Math.abs(element.baseTransform.scale[0])
    const fitScale = Math.min(1, pageWidth / Math.max(0.01, scaledWidth))
    const artLeft = -element.pivot[0] * dimensions.width
    const centerShiftX = artLeft + (u0 + (u1 - u0) / 2) * dimensions.width
    return {
      element, face, offset: baseOffset(face), mechanism: 'page-glue', fall: 'front',
      half: { u0, u1, width, centerShiftX }, phase: 0, fitScale,
      eject: 0, spineClearance: Infinity, reach: 0,
    }
  }
  return { left: wing('left', 0, creaseU), right: wing('right', creaseU, 1) }
}

/**
 * flapとv-foldの倒す方向の自動補正。
 * 倒れた先端が紙面から出ない方向を選ぶ。どちらも足りなければ
 * 空きの広い側を選び、残りは相似縮小が吸収する
 */
function resolveFlapFall(element: StageElement, offset: [number, number, number], pageDepth: number): FallDirection {
  const hint = element.stow.fallDirection
  if (hint !== 'auto') return hint === 'spine' || hint === 'outward' ? 'back' : hint
  const z = element.baseTransform.position[2] + offset[2]
  const height = ('height' in element ? element.height : 2) * Math.max(...element.baseTransform.scale)
  const backRoom = z + pageDepth / 2
  const frontRoom = pageDepth / 2 - z
  if (height <= backRoom + 0.2) return 'back'
  if (height <= frontRoom + 0.2) return 'front'
  return backRoom >= frontRoom ? 'back' : 'front'
}

function faceOffset(element: StageElement, face: FaceSide, pageWidth: number): [number, number, number] {
  void element; void face; void pageWidth
  return [0, 0, 0]
}

/** 見開きまたぎパネルの蓋の被覆範囲 (足元z0と、面ごとの水平到達距離) */
interface SpanLid {
  z0: number
  zFront: number
  reachLeft: number
  reachRight: number
}

/**
 * 包含検証と自動補正。
 *
 * 楔空間: 要素の帰属面に対し、対面は背表紙を通り角δをなす平面である。
 * 部品の先端が全δで対面を越えないよう、開き始めの位相を進める。
 * 見開きまたぎパネルがある場合は、降りてくる翼 (蓋) も第二の天井になる。
 * 平坦時の足跡が紙面からはみ出す分は相似縮小の目標値にする。
 * 相似縮小は先端の届く距離も縮めるため、位相の導出より先に確定させる。
 * airborne-routeは小口の外を回る迂回で運ぶため包含検証を持たず、迂回振幅を決める。
 */
function verifyAndCorrect(
  element: StageElement,
  mechanism: MechanismKind,
  fall: FallDirection,
  face: FaceSide,
  offset: [number, number, number],
  pageWidth: number,
  pageDepth: number,
  warnings: string[],
  lid?: SpanLid,
  widthOverride?: number,
  centerShiftX?: number,
): Omit<StowItem, 'element' | 'face' | 'offset' | 'mechanism' | 'half'> {
  // 片面背景は隣接見開きにも存在する。ページ送りでは送り元と送り先の
  // 二面角が相補的に変わるため、両方が同時に半起立すると背景同士が交差する。
  // 0.5を挟んで旧背景を畳んだ後に新背景を起こし、わずかな空白も確保する。
  const authorPhase = Math.min(0.6, element.stow.stagger * 0.6)
  if (mechanism === 'page-glue') return { phase: authorPhase, fitScale: 1, fall, eject: 0, spineClearance: Infinity, reach: 0 }

  const pos: [number, number, number] = [
    element.baseTransform.position[0] + offset[0] + (centerShiftX ?? 0),
    element.baseTransform.position[1] + offset[1],
    element.baseTransform.position[2] + offset[2],
  ]
  const height = ('height' in element ? element.height : 2) * Math.max(...element.baseTransform.scale)
  const width = (widthOverride ?? ('width' in element ? element.width : 2)) * Math.max(...element.baseTransform.scale)
  // 先端の届く高さ: flapは接地線から、airborne-routeは浮遊高さ+部品
  const reach = mechanism === 'airborne-route' ? pos[1] + height * (1 - element.pivot[1]) : height * (1 - element.pivot[1]) + Math.max(0, pos[1])
  // 背表紙からの距離 (面ローカルで、左面は+w/2側、右面は-w/2側が背)
  const spineDist = Math.max(0.05, face === 'left' ? pageWidth / 2 - pos[0] : pos[0] + pageWidth / 2)
  const pivotX = centerShiftX === undefined ? element.pivot[0] : 0.5
  const spineClearance = Math.max(0, face === 'left'
    ? pageWidth / 2 - (pos[0] + (1 - pivotX) * width)
    : (pos[0] - pivotX * width) + pageWidth / 2)

  // 平坦時の足跡: 倒れた先端が紙面の外へ出る分を縮小目標にする
  let available: number
  if (fall === 'back') available = pos[2] + pageDepth / 2
  else if (fall === 'front') available = pageDepth / 2 - pos[2]
  else if (fall === 'spine') available = spineDist + 0.3
  else available = (face === 'left' ? pos[0] + pageWidth / 2 : pageWidth / 2 - pos[0]) + 0.3
  const footprint = height
  // 端の余白ぶんを引いて収める。相似縮小は閉じ際だけ働く
  const shrink = footprint > available - 0.2 ? Math.max(0.25, (available - 0.2) / Math.max(0.01, footprint)) : 1
  // 横幅も紙面へ収める
  const fitScale = Math.min(shrink, Math.min(1, pageWidth / Math.max(0.01, width)))

  if (mechanism === 'airborne-route') {
    // ファンタジー迂回: 小口の外まで確実に張り出す振幅。
    // 本の輪郭の外は紙が無いため位相遅延を要しない
    const outwardRoom = pageWidth - spineDist
    const eject = outwardRoom + 1.5 + width * 0.25
    return { phase: authorPhase, fitScale, fall, eject, spineClearance, reach }
  }

  // パネルの蓋の下にある部品か (z範囲と、翼の水平到達距離で判定)。
  // 翼は折り目が傾くぶん糊しろの到達より外へ届くため、高さの一部を上乗せする
  const lidReach = lid === undefined ? 0
    : (face === 'left' ? lid.reachLeft : lid.reachRight) + (lid.zFront - lid.z0) * 0.25
  const lidSpan = lid !== undefined
    && pos[2] > lid.z0 - 0.1 && pos[2] < lid.zFront
    && spineDist < lidReach
    ? Math.max(0.05, pos[2] - lid.z0)
    : undefined

  // 位相の導出: 先端軌跡が全tで対面の天井とパネルの蓋を越えない最小の位相を探す
  let phase = authorPhase
  while (lidSpan !== undefined && phase < 0.85 && !phaseIsContained(phase, reach, spineDist, fitScale, lidSpan)) phase += 0.025
  phase = Math.min(phase, 0.85)
  if (lidSpan !== undefined && !phaseIsContained(phase, reach, spineDist, fitScale, lidSpan)) {
    warnings.push(`${element.name}: no phase fits inside the wedge`)
  }

  return { phase, fitScale, fall, eject: 0, spineClearance, reach }
}

/**
 * 展開位相 a で機構を駆動したとき、部品の先端 (接地線ヒンジの起き上がり、
 * 閉じ際の相似縮小を合成) が次の両方を全tで越えないか:
 *
 * - 対面の天井平面 (背表紙を通り帰属面と角δをなす)。δ ≥ π/2 では
 *   対面が垂直を越えるため制約しない
 * - 見開きまたぎパネルの蓋 (lidSpan指定時)。パネル足元z0で面にヒンジ
 *   した平面が角度 vfoldLidAngle(t) まで降りてくるとみなす
 */
function phaseIsContained(
  a: number,
  reach: number,
  spineDist: number,
  fitScale: number,
  lidSpan?: number,
): boolean {
  for (let step = 1; step <= 40; step++) {
    // t は生の二面角 δ/π。天井と蓋は実際の紙の角度で降りてくるが、
    // 部品のほうは settledT で詰めた変数に従う (描画と同じ式)
    const t = step / 40
    const f = smooth(Math.min(1, Math.max(0, (settledT(t) - a) / Math.max(1e-6, 1 - a))))
    if (f <= 0) continue
    const scaleMul = fitScale < 1 && f < FIT_SCALE_ONSET_F
      ? fitScale + (1 - fitScale) * smooth(f / FIT_SCALE_ONSET_F)
      : 1
    const tipHeight = reach * scaleMul * Math.sin((Math.PI / 2) * f)
    if (tipHeight < 1e-4) continue
    if (lidSpan !== undefined) {
      const lidAngle = vfoldLidAngle(t)
      if (lidAngle < Math.PI / 2 - 1e-3 && tipHeight > lidSpan * Math.tan(lidAngle) + 0.15) return false
    }
    if (t < 0.5 && Math.atan2(tipHeight, spineDist) > Math.PI * t + 1e-3) return false
  }
  return true
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}
