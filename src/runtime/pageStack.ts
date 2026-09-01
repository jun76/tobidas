/**
 * 表表紙の蝶番高さ。
 *
 * 閉じている間は紙束へ密着する 0。表紙を開き切った最初の見開きでは、
 * 紙束へ直接載せた右紙葉の表面まで持ち上げる。最初の紙葉を送ると同時に
 * 0 へ戻し、以降の左紙束の下へ表紙を収める。
 */
export function frontCoverRestHeight(
  pageThickness: number,
  coverAngle: number,
  firstSheetAngle: number,
): number {
  const closed = Math.min(1, Math.max(0, coverAngle))
  const firstTurn = Math.min(1, Math.max(0, firstSheetAngle))
  return Math.max(0, pageThickness) * closed * (1 - firstTurn)
}

/** 可視紙葉の中心高。底面を厚紙束の上面 Y=0 へ密着させる。 */
export function pageLeafRestHeight(pageThickness: number): number {
  return Math.max(0, pageThickness) / 2
}
