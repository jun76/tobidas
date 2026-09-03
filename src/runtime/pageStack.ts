/**
 * 表表紙が左支持束の下へ潜り込んだ度合い (0..1)。
 *
 * 潜りを最初の紙葉の後半へ寄せる。表紙の裏面は見開き1の左ページそのもので、
 * 送りの前半で沈めると、まだ次の紙葉が覆いかぶさっていないのに左ページだけが
 * 支持束の天面より下がる。地面画像は支持束にも同じものが敷かれていて
 * 差が出ないが、紙面から浮いている本文や平置き部品は束に埋まって消える。
 * 紙葉が寝るころ (角度が1へ近づくころ) まで潜りを遅らせれば、
 * 消える瞬間は必ず次の紙葉の下になる。
 *
 * 端点は従来どおり: 送る前は0、送り切ったら1。
 */
const COVER_DIVE_ONSET = 0.78

function frontCoverDive(firstSheetAngle: number): number {
  const turn = Math.min(1, Math.max(0, firstSheetAngle))
  if (turn <= COVER_DIVE_ONSET) return 0
  const u = (turn - COVER_DIVE_ONSET) / (1 - COVER_DIVE_ONSET)
  return u * u * (3 - 2 * u)
}

/**
 * 表表紙の蝶番高さ。
 *
 * 閉じている間と最初の見開きでは連続紙面の上へ載せる。最初の紙葉が
 * 寝るのに合わせて左支持束の下へ回し、その後は支持束の底へ密着させる。
 */
export function frontCoverRestHeight(
  pageThickness: number,
  leftSupportThickness: number,
  firstSheetAngle: number,
): number {
  const paper = Math.max(0, pageThickness)
  const support = Math.max(0, leftSupportThickness)
  const dive = frontCoverDive(firstSheetAngle)
  return paper * (1 - dive) - support * dive
}

/** 見開きの可視紙葉を、左右で連続する同じ上面高へ置く。 */
export function pageLeafRestHeight(pageThickness: number): number {
  return Math.max(0, pageThickness) / 2
}

/**
 * ページのクリック判定面へ与える、重なり順ぶんの微小な持ち上げ。
 *
 * 可視紙葉を同じ上面高へ並べたので、紙葉を2枚以上描いている間は
 * ページの判定面が同一平面へ重なり、どれが当たるかが描画順まかせになる。
 * 表示中の見開きを押したつもりで隣の見開きが選ばれるのはこれが原因。
 * 描いている紙葉の並び順から、束のどちら側でも物理的に手前の面ほど
 * 高くなる持ち上げを作る。
 *
 * 紙葉の表面(見開きの右ページ)は、束の右側では葉番号の小さいものが上、
 * 左へ倒れた後は葉番号の大きいものが上になる。裏面(左ページ)はその逆で、
 * 表裏で並び順を反転させると両側の順序が同時に揃う。
 * 刻みは紙厚の1/8に収め、持ち上げが隣の紙葉の面を越えないようにする。
 */
export function pageClickTargetLift(
  pageThickness: number,
  order: number,
  count: number,
  face: 'front' | 'back',
): number {
  const step = Math.max(0, pageThickness) / 8
  const rank = face === 'back' ? order : Math.max(0, count - 1 - order)
  return Math.max(0, rank) * step
}

/**
 * 最終見開きの右ページ(紙束の天面)が露出しているか。
 *
 * 可視紙葉を同じ高さへ並べたので、紙葉のクリック判定面はもう厚みぶんの
 * 前後を持たない。最終見開きの右ページの判定面は紙束の天面へ固定で置くため、
 * まだ手前の紙葉が覆っている間もその紙面より上に出てしまい、
 * 表示中の見開きを押したつもりで最終見開きが選ばれる。
 * 覆っている紙葉 (最終見開きの左面を担うシート) が背を越えて左へ倒れ、
 * 右半分から外れた後だけ天面の判定面を出す。
 */
export function lastPageIsExposed(coveringSheetAngle: number): boolean {
  return coveringSheetAngle > 0.5
}

/** 可視紙面の下にある支持紙束を、紙葉の回転量に応じて右から左へ移す。 */
export function paperStackSupportThickness(
  stackThickness: number,
  pageThickness: number,
  sheetAngles: readonly number[],
): { left: number; right: number } {
  const support = Math.max(0, stackThickness - Math.max(0, pageThickness))
  if (sheetAngles.length === 0) return { left: 0, right: support }
  const turns = sheetAngles.reduce(
    (sum, angle) => sum + Math.min(1, Math.max(0, angle)),
    0,
  )
  const fraction = turns / sheetAngles.length
  const left = support * fraction
  return { left, right: support - left }
}
