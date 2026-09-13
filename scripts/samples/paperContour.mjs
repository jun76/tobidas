export function applyPaperContour(element, contour) {
  if (contour) {
    // 抽出時の下端の微小な余白だけを地面へ届かせる。幅いっぱいの接着帯は加えない。
    const bottom = Math.min(...contour.outer.map(([, v]) => v))
    element.part.shapes = { panel: { outer: contour.outer.map(([u, v]) => [u, v === bottom ? 0 : v]), holes: contour.holes ?? [] } }
  }
}
