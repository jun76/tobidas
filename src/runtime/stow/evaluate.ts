import type { MotionTrack, Transform } from '../../schema/stageElement'
import type { MotionDelta } from '../motion'
import type { SpanningVFold, StowItem } from './model'

/**
 * 支持機構の閉形式評価。
 *
 * 入力は正規化二面角 t = δ/π だけである。
 * t=1 は制作者の開姿勢へ厳密に一致し、t=0 は帰属面の紙面スラブへ収まる。
 * ビート種別と露出度をここへ持ち込むことを禁止する。
 */

export interface StowPose {
  position: [number, number, number]
  rotationDeg: [number, number, number]
  scale: [number, number, number]
  opacityMul: number
}

/**
 * 平坦時の紙面リフト。寝かせた部品を紙面から浮かせる高さ。
 *
 * **これが紙面との前後を決めている唯一の仕掛け**。寝た部品は紙とほぼ同一平面にいるので、
 * 深度バッファの分解能を越える隔たりが要る。線形深度の分解能は 距離² / near × 2⁻²⁴ で、
 * 見開きを見込む距離 40 では 3e-4 に達する。ここを 0.001 まで薄くすると 3 段しか
 * 離れず、紙が視線に対して寝るほど射影が縮む。二面角 45° では紙面の部品が埋もれ、
 * 起き上がる位相まで見えなくなる。
 *
 * `layerDepthBias` の polygonOffset を当てにしてはいけない。実装依存で丸ごと無視される
 * ことがあり、headless Chromium の WebKit WebGL では -5000 単位でも効かない。
 * 同一平面の前後を支える保証にならない。層どうしの重なりは `renderOrder` (100 + layer) の
 * 描画順が解いていて、深度が同値なら後から描いたほうが勝つ。だから LAYER_LIFT は
 * 層を離すためではなく、層の順で単調に積むためだけの微量でよい。
 *
 * **ただし紙の厚みの半分を越えてはいけない**。寝かせた部品は向かい合う紙のスラブの中へ
 * 潜り込む形になるので、半分を越えると相手の紙の裏側へ抜ける。とくに背表紙のきわは
 * 向かい合う二面の隙間が 0 へ収束するため、二面角がいくら開いていても隙間で隠せない。
 * ページ送りの最中、まだ大きく開いている前の見開きの綴じ目に次の見開きの部品が
 * 一瞬だけ現れる。たとえば layer 20 で 0.072 浮くと、紙の厚み 0.015 を越えて前の面へ抜ける。
 * layer 100 まで積んでも 0.007 で、既定の 0.015 の半分に収まる。
 */
const SURFACE_Y = 0.006
const LAYER_LIFT = 0.00001
/** 相似縮小が働き始める展開係数。これ以上では厳密に恒等 */
export const FIT_SCALE_ONSET_F = 0.5

/**
 * 収納が終わっている二面角 (度)。閉じ際のこの角度から先は紙だけが動く。
 *
 * ページをめくる始まりと終わりでは、隣の見開きが浅く開いた状態で手前へ
 * かぶさってくる。紙どうしの隙間はそこでいちばん狭いので、部品がまだ
 * 起きていると閉じてくる紙を突き抜けて一瞬ちらつく。見えるかどうかは
 * カメラ次第で変わるため、露出ではなく角度で切る。
 *
 * この角度を境に、部品は「収納し切った状態で紙に挟まれて閉じる」だけになる。
 */
export const STOW_SETTLED_DEG = 30
const SETTLED_T = STOW_SETTLED_DEG / 180

/**
 * 部品を描くのをやめる二面角 (度)。収納の完了 (STOW_SETTLED_DEG) より更に浅い側。
 *
 * 残っている理由は**背表紙のきわ**だけになった。向かい合う二面の隙間は
 * 背表紙から離れるほど広がり、綴じ目では 0 に収束する。だから綴じ目に置いた部品は
 * 二面角がいくら開いていても隙間で隠せず、隣の面へ抜けて見える。角度で切るしかない。
 *
 * 抜ける帯の幅は リフト / sin(二面角) で決まる。リフトを紙の厚みより薄い 0.002 に
 * したので、2° なら綴じ目から 0.057 の帯しか出ない = 実質見えない。0° まで下げると
 * 二面が完全に重なり、綴じ目の部品が丸ごと隣の面へ出るので、ここが下限になる。
 *
 * 必ず STOW_SETTLED_DEG より小さくすること。動いている最中に消すと、
 * 部品が起きたまま突然消えるのが見えてしまう。
 */
export const STOW_HIDDEN_DEG = 2

/** 部品を描くか。二面角がこれより浅い見開きは中身を描かない */
export function stowIsDrawn(tRaw: number): boolean {
  return tRaw > STOW_HIDDEN_DEG / 180
}

/**
 * 空中の部品 (strut) が薄れ始める二面角 (度)。ここから収納の完了
 * (STOW_SETTLED_DEG) までで不透明度を 0 まで落とす。
 *
 * 紙に貼った部品・立てた板は、閉じてくる紙そのものが隠してくれる。透明支持片で
 * 浮かせた部品にはその紙が無い。とくに背表紙の上 (x≈0) に浮かせた部品は、
 * 向かい合う二面の隙間が綴じ目で 0 へ収束するせいでどれだけ開いていても隙間に
 * 隠れず、紙面から離れて宙にいるぶん STOW_HIDDEN_DEG (2°) の帯にも入らない。
 * 送りの最中、前の見開きのランタンが次の見開きの上に丸ごと残って見えるのがこれ。
 *
 * 角度で切るのは他の2つの閾値と同じで、露出やカメラを持ち込まない。ただし空中の
 * 部品は突然消すと目立つので、切るのではなく 60°..30° の30度かけて薄れさせる。
 * 収納が終わる 30° で 0 に達するので、そこから先の「紙だけが閉じる」区間では
 * 空中の部品はもう一つも描かれていない。開くときは同じ式を逆にたどる。
 */
export const STRUT_FADE_DEG = 60

/**
 * 空中の部品の不透明度係数。t=STRUT_FADE_DEG/180 以上で 1、
 * 収納完了 (SETTLED_T) 以下で 0。機構が strut 以外なら常に 1。
 */
export function strutFade(mechanism: StowItem['mechanism'], tRaw: number): number {
  if (mechanism !== 'strut') return 1
  const deg = clamp01(tRaw) * 180
  return smooth((deg - STOW_SETTLED_DEG) / (STRUT_FADE_DEG - STOW_SETTLED_DEG))
}

/**
 * 収納の評価変数。入力は正規化二面角 t = δ/π のままで、
 * 残り STOW_SETTLED_DEG 度で収納し切るよう詰め直す。
 *
 * t=1 は制作者の開姿勢へ厳密に一致し、t ≤ SETTLED_T はすべて収納済み。
 * 収納コンパイラの包含検証もこの関数を通すので、検証と描画がずれない。
 */
export function settledT(tRaw: number): number {
  return clamp01((clamp01(tRaw) - SETTLED_T) / (1 - SETTLED_T))
}

/** 開き位相を織り込んだ展開係数。入力は詰め直したあとの t */
function openFactor(item: StowItem, t: number): number {
  return smooth(clamp01((t - item.phase) / Math.max(1e-6, 1 - item.phase)))
}

/** 0=紙面へ収納済み、1=制作者の開姿勢。正対を含む表示効果もこの係数へ従属させる。 */
export function stowOpenFactor(item: StowItem, tRaw: number): number {
  return openFactor(item, settledT(tRaw))
}

export function evaluateStow(item: StowItem, tRaw: number, motion: MotionDelta): StowPose {
  const t = settledT(tRaw)
  const { element, mechanism, fall, offset } = item
  const base = element.baseTransform
  // 開き位相: f(1)=1、f(phase以下)=0。包含検証で決めた位相より早く起きない
  const f = openFactor(item, t)
  // 住人の変位は機構の先端ローカルで加算し、空間の畳みに応じて圧縮する
  const openPos: [number, number, number] = [
    base.position[0] + offset[0] + (item.half?.centerShiftX ?? 0) + motion.position[0] * f,
    base.position[1] + offset[1] + motion.position[1] * f,
    base.position[2] + offset[2] + motion.position[2] * f,
  ]
  // 自転は一回転へ折り返してから畳む。子 (evaluateChildPose) と違って上位の部品は
  // 収納し切った状態でも 30°..2° の間は描かれるので、変位は f=0 で消えないといけない。
  // 折り返さずに積み上がった角度へ f を掛けるとページ送りの瞬間だけ暴走する (motion.ts)。
  // 折り返しがあるぶん送り中に一度だけ 360·f 度の飛びが出ることはあるが、
  // 「f=1 で制作値へ厳密一致」と「f=0 で制作値へ戻る」を両立させる連続な畳み方は
  // 存在しない (円周上の写像の次数が 1 と 0 で変わる) ので、暴走ではなく飛びを採る
  const openRot: [number, number, number] = [
    base.rotation[0] + (motion.rotationDeg[0] + wrapDeg(motion.spinDeg[0])) * f,
    base.rotation[1] + (motion.rotationDeg[1] + wrapDeg(motion.spinDeg[1])) * f,
    base.rotation[2] + (motion.rotationDeg[2] + wrapDeg(motion.spinDeg[2])) * f,
  ]
  const motionScale = 1 + (motion.scaleMul - 1) * f
  let position: [number, number, number]
  let rotationDeg: [number, number, number]

  if (mechanism === 'page-glue') {
    position = openPos
    rotationDeg = openRot
  } else if (mechanism === 'strut') {
    // 透明支持片のファンタジー迂回: 部品を一旦小口の外へ大きく運び出し、
    // 本の輪郭の外側を弧で回ってから定位置へ運ぶ。ページの外周より外は
    // 紙が存在しないため、楔の掃引や見開きまたぎパネルの蓋と干渉しない。
    // sin窓で膨らみは両端厳密にゼロ (t=1で開姿勢、t=0で真下へ平坦)
    const bump = Math.sin(Math.PI * f)
    const outward = item.face === 'left' ? -1 : 1
    const hingeY = flatY(item)
    position = [
      openPos[0] + outward * item.eject * bump,
      lerp(hingeY, openPos[1], f) + item.eject * 0.35 * bump,
      openPos[2],
    ]
    rotationDeg = f >= 1 ? openRot : [
      lerp(fall === 'front' ? 90 : -90, openRot[0], f),
      openRot[1],
      openRot[2],
    ]
  } else {
    // flapとv-foldの翼: 接地線ヒンジ。回転だけで寝るため高さ方向の掃引が小さい
    const flatX = fall === 'front' ? 90 : -90
    position = [openPos[0], f >= 1 ? openPos[1] : lerp(flatY(item), openPos[1], f), openPos[2]]
    rotationDeg = f >= 1 ? openRot : [lerp(flatX, openRot[0], f), openRot[1], openRot[2]]
  }

  if (f >= 1) {
    position = openPos
    rotationDeg = openRot
  }

  // 閉じ際だけ働く相似縮小。展開係数と結び付け、
  // 平坦になった時点では必ず縮小し切っている
  let scaleMul = 1
  if (item.fitScale < 1 && f < FIT_SCALE_ONSET_F) {
    scaleMul = lerp(item.fitScale, 1, smooth(f / FIT_SCALE_ONSET_F))
  }

  const pose: StowPose = {
    position,
    rotationDeg,
    scale: [base.scale[0] * motionScale * scaleMul, base.scale[1] * motionScale * scaleMul, base.scale[2] * motionScale * scaleMul],
    opacityMul: 1,
  }
  // 装飾は機構が開いてから効く。収納中の部品を動かさない
  applyFlourish(pose, element.stowFlourish, t, f)
  // 空中の部品は隠してくれる紙が無いので、閉じ際は角度で薄れさせる (STRUT_FADE_DEG)。
  // 装飾の不透明度より後に掛け、30°で必ず 0 になるようにする
  pose.opacityMul *= strutFade(mechanism, tRaw)
  return pose
}

/**
 * 子部品の姿勢。親の原点からの隔たりも、住人の変位も、畳みに応じて畳む。
 *
 * 子は親へ剛体追従するが、親が寝るときの回転は接地線まわりの90度なので、
 * 開姿勢では紙面と平行だった隔たりが、寝かせたあとは紙面の法線へ倒れる。
 * 軌道する惑星のように隔たりの大きい子は、これで紙面から持ち上がり、
 * ページの傾きに乗って本の外へ飛び出す。半径2.1なら紙面から1.2上がり、
 * 世界座標で片面幅の外側へ出るため、隔たりのほうを畳む必要がある。
 *
 * ただし**自転だけは畳まない** (`spinDeg`)。積み上がる角度に f を掛けると
 * ページ送りの瞬間だけ何十倍の速さで逆回転する (motion.ts の説明)。子は f<=0 で
 * 描画ごと落ちる (ChildNode) ので、自転を制作値の向きへ戻す必要がそもそもない。
 *
 * 隔たりを畳まずに「開姿勢での足跡へ降ろす」方法は成り立たない。
 * 軌道する部品の軸は背表紙の上に置かれることがあり、その足跡は左右両方の面へ
 * またがる。収納先は片面なので、足跡を保つと必ず面の外へ出てしまう。
 * 親の原点へ畳むのが、親の検証済みの足跡から出ないことを保証できる唯一の畳み方。
 *
 * 変位のほうも畳まないと、紙面へ寝たあとも子がその場で回り続ける。回り続ける板は
 * 法線方向へ立ち上がるので、ここでも紙を突き抜ける。
 *
 * **ただし親の板に沿った縦の隔たり (local y) は畳まない**。板が寝るときの回転は
 * 接地線まわりなので、local y は寝たあとも紙面と平行のままで、紙から浮かない。
 * しかも 0..親の高さ の範囲なら、寝かせた親の板の footprint の中にいる。畳んでしまうと、
 * 親が起き上がる7秒のあいだ子が板の上を根元から先端へ滑り続け、風車の羽根が塔の軸から
 * 外れ、踏切の遮断桿が支柱から離れて見える。
 *
 * 横 (local x) と板の法線 (local z) は畳んだままにする。z は寝かせたあと紙面の法線へ
 * 倒れる危険な軸そのもので、x は軌道する子が親の板の外まで回り込む余地があるため。
 *
 * f=0 では親の板の上へ寝て、f=1 では制作値へ厳密一致。
 * 畳み切った子は線でしかないので、そこでは描かない (ChildNode)。
 */
export function evaluateChildPose(base: Transform, motion: MotionDelta, openFactor: number): {
  position: [number, number, number]
  rotationDeg: [number, number, number]
  scale: [number, number, number]
} {
  const f = clamp01(openFactor)
  const motionScale = 1 + (motion.scaleMul - 1) * f
  return {
    position: [
      (base.position[0] + motion.position[0]) * f,
      // 縦だけは畳まない。子は親の板に据え付けられたまま、板と一緒に起き上がる
      base.position[1] + motion.position[1] * f,
      (base.position[2] + motion.position[2]) * f,
    ],
    rotationDeg: [
      base.rotation[0] + motion.rotationDeg[0] * f + motion.spinDeg[0],
      base.rotation[1] + motion.rotationDeg[1] * f + motion.spinDeg[1],
      base.rotation[2] + motion.rotationDeg[2] * f + motion.spinDeg[2],
    ],
    scale: [
      base.scale[0] * motionScale,
      base.scale[1] * motionScale,
      base.scale[2] * motionScale,
    ],
  }
}

function flatY(item: StowItem): number {
  return SURFACE_Y + item.element.layer * LAYER_LIFT
}

export interface VFoldSpanPose {
  /** 折り目の足元 (リグ座標。背表紙は x=0) */
  origin: [number, number, number]
  /** 折り目の上方向 (単位)。開き切りで垂直、閉じるにつれ手前へ倒れる */
  creaseDir: [number, number, number]
  /** 左右翼の糊しろ方向 (単位、各面内)。翼平面は creaseDir と直交基底を張る */
  leftDir: [number, number, number]
  rightDir: [number, number, number]
  scaleMul: number
  opacityMul: number
}

/**
 * 糊しろ (翼と面のヒンジ線) が背表紙となす角。90°だと剛体では畳めない
 * (退化)。背側へ振るぶんだけ折り目が手前へ倒れる運動が生まれ、
 * 開き切りには上面視 (90°−γ) の浅いVが付く (実物のV-foldと同じ)
 */
const GLUE_ANGLE = (80 / 180) * Math.PI
/** 開き切りの水平スパンを制作値へ保つための糊しろ方向の幅補正 */
export const GLUE_WIDTH_FACTOR = 1 / Math.sin(GLUE_ANGLE)

/**
 * 背をまたぐ一枚パネルの閉形式評価。剛体V-foldの球面リンク。
 *
 * 入力は左右の面の角度 A, B (背表紙まわり、右面が水平で0、左面が水平でπ)。
 * 各翼は自面上の糊しろ線 ĝ = sinγ·r̂(面) − cosγ·ẑ にヒンジし、折り目は
 * 翼内で糊しろと直交する (矩形のまま歪まない)。折り目方向は両糊しろから
 * 等角となる ±normalize((ĝR+ĝL)×(ĝR−ĝL)) で一意に決まり、両翼が線分を
 * 厳密共有するため中央は割れない。開き切り (A=π, B=0) で折り目は垂直、
 * 閉じるにつれ折り目は本の手前 (+z) へ倒れながら両翼が面へ畳まれる。
 */
interface VFoldSpanFrame {
  crease: [number, number, number]
  glueLeft: [number, number, number]
  glueRight: [number, number, number]
}

/** 剛体V-foldの基底 (折り目と両糊しろの単位方向) を左右の面の角度から解く */
export function vfoldSpanFrame(leftAngle: number, rightAngle: number, fall: 'back' | 'front' = 'front'): VFoldSpanFrame {
  const sg = Math.sin(GLUE_ANGLE)
  const cg = Math.cos(GLUE_ANGLE)
  const depth = fall === 'front' ? -cg : cg
  const glueRight: [number, number, number] = [sg * Math.cos(rightAngle), sg * Math.sin(rightAngle), depth]
  const glueLeft: [number, number, number] = [sg * Math.cos(leftAngle), sg * Math.sin(leftAngle), depth]
  const sum = [glueRight[0] + glueLeft[0], glueRight[1] + glueLeft[1], glueRight[2] + glueLeft[2]]
  const diff = [glueRight[0] - glueLeft[0], glueRight[1] - glueLeft[1], glueRight[2] - glueLeft[2]]
  let crease: [number, number, number] = [
    sum[1] * diff[2] - sum[2] * diff[1],
    sum[2] * diff[0] - sum[0] * diff[2],
    sum[0] * diff[1] - sum[1] * diff[0],
  ]
  const creaseNorm = Math.hypot(...crease)
  if (creaseNorm < 1e-6) {
    // 両面が一致する極限 (完全に閉じた状態): 糊しろに直交して前方へ寝る
    const dot = glueRight[2]
    crease = normalize3([-dot * glueRight[0], -dot * glueRight[1], 1 - dot * glueRight[2]])
  } else {
    crease = [crease[0] / creaseNorm, crease[1] / creaseNorm, crease[2] / creaseNorm]
  }
  // 上向き (退化時は手前向き) の解を選ぶ
  if (crease[1] < -1e-6 || (Math.abs(crease[1]) <= 1e-6 && crease[2] < 0)) {
    crease = [-crease[0], -crease[1], -crease[2]]
  }
  return { crease, glueLeft, glueRight }
}

export function evaluateVFoldSpan(span: SpanningVFold, leftAngle: number, rightAngle: number, motion: MotionDelta): VFoldSpanPose {
  // 折り目と糊しろは左右の面へ剛体で繋がっているので、実際の面の角度で解く。
  // 足元の持ち上がりと住人の変位だけが収納の変数に従う
  const t = settledT((leftAngle - rightAngle) / Math.PI)
  const { crease, glueLeft, glueRight } = vfoldSpanFrame(leftAngle, rightAngle, span.fall)

  // 住人の変位は展開に応じて圧縮する。回転の変位は面を割るため適用しない
  const origin: [number, number, number] = [
    motion.position[0] * t,
    lerp(SURFACE_Y, span.baseY, t) + motion.position[1] * t,
    span.baseZ + motion.position[2] * t,
  ]
  const pose: VFoldSpanPose = {
    origin,
    creaseDir: crease,
    leftDir: glueLeft,
    rightDir: glueRight,
    scaleMul: 1 + (motion.scaleMul - 1) * t,
    opacityMul: 1,
  }
  applySpanFlourish(pose, span.element.stowFlourish, t)
  return pose
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const n = Math.hypot(...v) || 1
  return [v[0] / n, v[1] / n, v[2] / n]
}

/** 装飾トラックのうち一枚パネルへ適用できる成分 (位置・スケール・不透明度) */
function applySpanFlourish(pose: VFoldSpanPose, tracks: MotionTrack[] | undefined, t: number): void {
  if (!tracks?.length) return
  const w = flourishWindow(t) * t
  if (w <= 0) return
  for (const track of tracks) {
    const value = sampleTrack(track, t) * w
    switch (track.property) {
      case 'position.x': pose.origin[0] += value; break
      case 'position.y': pose.origin[1] += value; break
      case 'position.z': pose.origin[2] += value; break
      case 'scale': pose.scaleMul *= Math.max(0.001, 1 + value); break
      case 'opacity': pose.opacityMul = clamp01(pose.opacityMul + value); break
      default: break // 回転トラックは折り目を割るため適用しない
    }
  }
}

/**
 * 見開きまたぎパネルの翼が面となす角 (蓋の降り具合、ラジアン)。
 * 動く面と静止面のうち小さい方を返す保守的な値で、面上の部品が
 * 蓋より先に寝るべきかの包含検証 (assign) が使う。
 * t=1で π/2 (パネル垂直)、閉じるにつれ0へ降りる
 */
export function vfoldLidAngle(t: number): number {
  const leftAngle = Math.PI
  const rightAngle = (1 - clamp01(t)) * Math.PI
  const { crease } = vfoldSpanFrame(leftAngle, rightAngle)
  // 面の上側法線: 左面 (sinA, -cosA), 右面 (-sinB, cosB)
  const sinStatic = crease[0] * Math.sin(leftAngle) - crease[1] * Math.cos(leftAngle)
  const sinMover = -crease[0] * Math.sin(rightAngle) + crease[1] * Math.cos(rightAngle)
  const lower = Math.min(Math.max(sinStatic, 0), Math.max(sinMover, 0))
  return Math.asin(Math.min(1, lower))
}

/** 窓関数: t=0とt=1で必ず0。装飾は端点を崩せない */
export function flourishWindow(t: number): number {
  return smooth(t / 0.18) * smooth((1 - t) / 0.18)
}

function applyFlourish(pose: StowPose, tracks: MotionTrack[] | undefined, t: number, deploy: number): void {
  if (!tracks?.length) return
  const w = flourishWindow(t) * clamp01(deploy)
  if (w <= 0) return
  for (const track of tracks) {
    const value = sampleTrack(track, t) * w
    switch (track.property) {
      case 'position.x': pose.position[0] += value; break
      case 'position.y': pose.position[1] += value; break
      case 'position.z': pose.position[2] += value; break
      case 'rotation.x': pose.rotationDeg[0] += value; break
      case 'rotation.y': pose.rotationDeg[1] += value; break
      case 'rotation.z': pose.rotationDeg[2] += value; break
      case 'scale': {
        const mul = Math.max(0.001, 1 + value)
        pose.scale = [pose.scale[0] * mul, pose.scale[1] * mul, pose.scale[2] * mul]
        break
      }
      case 'opacity': pose.opacityMul = clamp01(pose.opacityMul + value); break
    }
  }
}

export function sampleTrack(track: MotionTrack, t: number): number {
  const keys = [...track.keys].sort((a, b) => a.t - b.t)
  if (keys.length === 1) return keys[0].value
  if (t <= keys[0].t) return keys[0].value
  const last = keys[keys.length - 1]
  if (t >= last.t) return last.value
  for (let index = 1; index < keys.length; index++) {
    const prev = keys[index - 1]
    const next = keys[index]
    if (t <= next.t) {
      const local = (t - prev.t) / Math.max(1e-9, next.t - prev.t)
      const eased = next.ease === 'linear' ? local : smooth(local)
      return prev.value + (next.value - prev.value) * eased
    }
  }
  return last.value
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function smooth(t: number): number {
  const c = clamp01(t)
  return c * c * (3 - 2 * c)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** 角度を (-180, 180] へ折り返す。姿勢としては元の角度と同じ */
function wrapDeg(deg: number): number {
  return deg - Math.round(deg / 360) * 360
}
