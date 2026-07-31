/**
 * 見開き二面角の導出 (docs/006 §4)。
 *
 * 見開きkの左面はシートk、右面はシートk+1が担う。
 * δ(k) = (α(k) − α(k+1)) × π であり、閉じた状態で0、完全に開いてπになる。
 * 表紙開き、ページ送り、裏表紙閉じはすべてこの一式に含まれ、別の式を持たない。
 */
export function spreadDihedrals(sheetAngles: number[]): number[] {
  const dihedrals: number[] = []
  for (let spread = 0; spread + 1 < sheetAngles.length; spread++) {
    dihedrals.push(Math.max(0, (sheetAngles[spread] - sheetAngles[spread + 1]) * Math.PI))
  }
  return dihedrals
}

/** 正規化二面角 (0..1)。支持機構と装飾トラックの評価変数 */
export function normalizedDihedral(dihedral: number): number {
  return Math.min(1, Math.max(0, dihedral / Math.PI))
}
