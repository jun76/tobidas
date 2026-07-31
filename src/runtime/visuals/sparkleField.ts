/**
 * 光の欠片の粒の配置 (描画から切り離した純関数)。
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
  /** 点の大きさ。距離で減衰するので世界寸法ではなく画面上の目安 */
  size: 18,
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
 * spread は雲の差し渡し (世界単位)。粒は原点のまわり ±spread/2 に収まり、
 * spread=0 なら全粒が原点へ重なる = 収納し切った状態になる。
 */
export function buildSparkleField(seed: string, spread: number): SparkleField {
  const random = seededRandom(seed)
  const extent = Math.max(0, spread)
  const positions = new Float32Array(SPARKLE.count * 3)
  const phases = new Float32Array(SPARKLE.count * 3)
  const rates = new Float32Array(SPARKLE.count)
  for (let i = 0; i < SPARKLE.count; i++) {
    for (let axis = 0; axis < 3; axis++) {
      positions[i * 3 + axis] = (random() - 0.5) * extent
      phases[i * 3 + axis] = random() * Math.PI * 2
    }
    // 一斉に同じ向きへ動くと群れの体操に見えるので、速さを粒ごとに散らす
    rates[i] = 0.75 + random() * 0.5
  }
  return { positions, phases, rates }
}
