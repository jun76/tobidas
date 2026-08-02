/**
 * 光の欠片の粒を透明な縦置き平面へ配置する純関数。
 *
 * 収納コンパイラが動かすのは要素の原点だけなので、広がりのほうを収納へ
 * 従わせるのはここの仕事になる。畳まれた要素の雲が広がりを持ったままだと、
 * 紙面へ寝かせても粒は原点のまわりに散り、見開きが閉じてページが傾いたときに
 * 紙の輪郭から外へ出て、本の外や隣の面の上に浮いて見える。
 */

/** 揺れと粒の寸法。振れ幅は世界単位、周期は秒 */
export const SPARKLE = {
  count: 6,
  /** 一粒が動く範囲 (世界単位、片振幅)。片面幅 8 に対して 0.05 は指先ほど */
  drift: 0.05,
  /** 一往復にかける秒数 */
  period: 11,
  /** 一粒の直径 (世界単位)。透明平面内の実寸なので紙との深度関係も保たれる */
  size: 0.45,
}

/** 要素IDから決まる乱数。同じ部品はいつ組み立て直しても同じ雲になる */
export function seededRandom(seed: string): () => number {
  let state = 0x9e3779b9
  for (const ch of seed) state = Math.imul(state ^ ch.charCodeAt(0), 0x85ebca6b) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SparkleField {
  positions: Float32Array
  phases: Float32Array
  rates: Float32Array
}

/**
 * 粒の配置と位相を組む。
 *
 * spread は平面の差し渡し (世界単位)。粒はローカルXYの ±spread/2 に収まり、
 * ローカルZは常に0なので、ほかの平面部品と同じ包含判定と谷折りを使える。
 * spread=0 なら全粒が原点へ重なる = 収納し切った状態になる。
 */
export function buildSparkleField(
  seed: string,
  spread: number | { width: number; height: number; count?: number },
): SparkleField {
  const random = seededRandom(seed)
  const width = Math.max(0, typeof spread === 'number' ? spread : spread.width)
  const height = Math.max(0, typeof spread === 'number' ? spread : spread.height)
  const count = typeof spread === 'number' ? SPARKLE.count : Math.max(1, Math.round(spread.count ?? SPARKLE.count))
  const positions = new Float32Array(count * 3)
  const phases = new Float32Array(count * 3)
  const rates = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    for (let axis = 0; axis < 2; axis++) {
      positions[i * 3 + axis] = (random() - 0.5) * (axis === 0 ? width : height)
      phases[i * 3 + axis] = random() * Math.PI * 2
    }
    positions[i * 3 + 2] = 0
    phases[i * 3 + 2] = random() * Math.PI * 2
    // 一斉に同じ向きへ動くと群れの体操に見えるので、速さを粒ごとに散らす
    rates[i] = 0.75 + random() * 0.5
  }
  return { positions, phases, rates }
}
