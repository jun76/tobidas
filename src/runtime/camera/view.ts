/**
 * 編集ビューと再生ビューが共有する視錐台と深度バッファの設定。
 *
 * 紙どうしは pageThickness (既定 0.015) しか離れておらず、表紙の内側と最初の紙面に至っては
 * その半分しか空いていない。線形深度の分解能は視点からの距離の二乗で粗くなるので、
 * 視点を引くとこの隙間が同じ深度値へ丸められ、紙面と表紙が奪い合ってちらつく。
 * 分解能はおおよそ `距離² / near × 2⁻²⁴` で、near=0.05 のままだと距離90で 0.0097 に達し、
 * 紙の隙間 0.0075 を越える。実際そこでちらついた。
 *
 * **対数深度バッファは使えない**。距離によらず一定の相対精度が得られる代わりに、
 * シェーダから `gl_FragDepth` を書くため `polygonOffset` が丸ごと無効になる。
 * 同じ場所に重ねた板どうしの取り合いは `visuals/ElementVisuals.ts` の
 * `layerDepthBias` (polygonOffset) が均しているので、これを失うと重ね置きがちらつく。
 *
 * ただし紙面へ寝かせた部品を紙より前に置いているのは polygonOffset ではなく、
 * `runtime/stow/evaluate.ts` の SURFACE_Y による幾何のリフトのほうである。
 * polygonOffset は実装依存で無視されうるので、そちらを当てにしてはいけない。
 *
 * 代わりに near を上げて線形深度の精度を稼ぐ。0.3 なら距離200まで紙の隙間を割らない
 * (200²/0.3 × 2⁻²⁴ = 0.0079 ≒ 隙間ちょうど)。片面幅8の本を見るのに200も引くことはない。
 * これ以上上げると寄ったときに手前の部品が前面でクリップされる。
 */
export const VIEW_CLIP = { near: 0.3, far: 300 } as const

/**
 * Canvas の `gl` へ渡す共通設定。
 * `logarithmicDepthBuffer` は上の理由で有効にしてはいけない。
 */
export const VIEW_GL = { antialias: true, logarithmicDepthBuffer: false } as const
