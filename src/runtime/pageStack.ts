/**
 * 表表紙の蝶番高さ。
 *
 * 閉じている間と最初の見開きでは連続紙面の上へ載せる。最初の紙葉を
 * 送る動きに合わせて左支持束の下へ回し、その後は支持束の底へ密着させる。
 */
export function frontCoverRestHeight(
  pageThickness: number,
  leftSupportThickness: number,
  firstSheetAngle: number,
): number {
  const paper = Math.max(0, pageThickness)
  const support = Math.max(0, leftSupportThickness)
  const firstTurn = Math.min(1, Math.max(0, firstSheetAngle))
  return paper * (1 - firstTurn) - support
}

/** 見開きの可視紙葉を、左右で連続する同じ上面高へ置く。 */
export function pageLeafRestHeight(pageThickness: number): number {
  return Math.max(0, pageThickness) / 2
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
