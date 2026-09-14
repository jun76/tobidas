import { Vector3 } from 'three'
import { faceCorners, type PaperEvaluation } from './geometry'
import { paperSimilarity } from './similarity'

export interface PaperStowFit { scale: number; radialShift: number; depthShift: number }

/** 剛体機構の閉姿勢を測る。紙を寝かせる仕事は機構側に残す。 */
export function planPaperStow(result: PaperEvaluation, width: number, depth: number, direction = new Vector3(1, 0, 0)): PaperStowFit {
  const points = result.faces.flatMap(faceCorners)
  if (!points.length) return { scale: 1, radialShift: 0, depthShift: 0 }
  const xs = points.map(p => p.dot(direction)), zs = points.map(p => p.z)
  const lowX = Math.min(0, ...xs), highX = Math.max(width, ...xs)
  const lowZ = Math.min(-depth / 2, ...zs), highZ = Math.max(depth / 2, ...zs)
  const scale = Math.min(1, width / (highX - lowX), depth / (highZ - lowZ))
  // 綴じ目に寄せた縮小を基本とし、奥への張り出しだけ必要量を紙面内へ戻す。
  return { scale, radialShift: -lowX * scale,
    depthShift: Math.max(-depth / 2 - lowZ * scale, Math.min(0, depth / 2 - highZ * scale)) }
}

/** 全開の構図は不変。支持・子・接着線を一緒に、一度だけ相似変換する。 */
export function deployPaper<T extends PaperEvaluation>(result: T, fit: PaperStowFit, angle: number, direction = new Vector3(1, 0, 0)): T {
  const t = Math.max(0, Math.min(1, angle / 180)), opened = t * t * (3 - 2 * t)
  const scale = fit.scale + (1 - fit.scale) * opened
  const translation = direction.clone().multiplyScalar(fit.radialShift * (1 - opened))
    .add(new Vector3(0, 0, fit.depthShift * (1 - opened)))
  if (scale === 1 && translation.lengthSq() === 0) return result
  return { ...paperSimilarity(new Vector3(), scale, translation).evaluation(result), deploymentScale: scale } as T
}
