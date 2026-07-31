import type { ContentMotion } from '../schema/stageElement'

/**
 * Content Motionの評価 (docs/005 §8.2)。
 * 入力はContent Clockの経過時間だけであり、Book進行値を参照しない。
 * 返すのは展開姿勢へ加える変位で、折り畳み写像が空間ごと圧縮する。
 */

/**
 * 自転を往復運動と分けて返す。混ぜてはいけない。
 *
 * 自転の角度は住人時間に比例して積み上がり続ける。これを畳み係数 f で圧縮すると
 * 表示角は θ(t)·f になり、その速さは θ'·f + θ·f' になる。第2項は θ に上限が
 * ないので、f が動く瞬間 (= ページ送り) だけ何十倍もの速さで回って見え、
 * f が減る側では逆回転する。しかも表示していた時間が長いほど酷くなる。
 * 往復運動 (bob / sway / drift / pulse) の振れ幅は有界なのでこの項は問題にならず、
 * 畳みから外す必要があるのは自転だけ。畳む側の判断は evaluate.ts が持つ。
 */
export interface MotionDelta {
  position: [number, number, number]
  /** 原点まわりで往復する回転 (sway)。有界なので畳みに従わせてよい */
  rotationDeg: [number, number, number]
  /** 積み上がり続ける自転 (spin)。畳み係数を掛けてはいけない */
  spinDeg: [number, number, number]
  scaleMul: number
}

export const IDENTITY_MOTION: MotionDelta = {
  position: [0, 0, 0], rotationDeg: [0, 0, 0], spinDeg: [0, 0, 0], scaleMul: 1,
}

export function evaluateContentMotion(motions: ContentMotion[], time: number): MotionDelta {
  if (!motions.length) return IDENTITY_MOTION
  const delta: MotionDelta = {
    position: [0, 0, 0], rotationDeg: [0, 0, 0], spinDeg: [0, 0, 0], scaleMul: 1,
  }
  for (const motion of motions) {
    if (motion.type === 'spin') {
      const axis = motion.axis === 'x' ? 0 : motion.axis === 'y' ? 1 : 2
      delta.spinDeg[axis] += time * motion.speed * (180 / Math.PI)
      continue
    }
    const angle = time * Math.PI * 2 / motion.period + motion.phase
    switch (motion.type) {
      case 'bob':
        delta.position[1] += Math.sin(angle) * motion.amplitude
        break
      case 'sway':
        delta.rotationDeg[2] += Math.sin(angle) * motion.amplitude
        break
      case 'drift':
        delta.position[0] += Math.sin(angle) * motion.amplitude[0]
        delta.position[1] += Math.sin(angle * 0.83) * motion.amplitude[1]
        delta.position[2] += Math.cos(angle) * motion.amplitude[2]
        break
      case 'pulse':
        delta.scaleMul *= 1 + Math.sin(angle) * motion.amplitude
        break
    }
  }
  return delta
}
