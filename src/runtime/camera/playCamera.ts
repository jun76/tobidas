import type { Book } from '../../schema/book'
import { activeSpreadHasCameraTracks, evaluateTimelineCamera } from '../camera'
import { evaluateBookSignals } from '../signals'
import { normalizedDihedral } from '../stow/dihedral'

export interface PlayCameraPose {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

/** 制作時の1.6画面に小口側の安全余白を加えた、横幅contain用の基準比率。 */
export const CAMERA_REFERENCE_ASPECT = 1.7

function fitTrackedPoseToAspect(pose: PlayCameraPose, aspect: number): PlayCameraPose {
  const fit = Math.max(1, CAMERA_REFERENCE_ASPECT / Math.max(.01, aspect))
  if (fit === 1) return pose
  return {
    ...pose,
    position: pose.position.map((value, axis) =>
      pose.target[axis] + (value - pose.target[axis]) * fit) as [number, number, number],
  }
}

export function evaluatePlayCameraPose(book: Book, progress: number, aspect: number): PlayCameraPose {
  // 保存した姿勢は基準比率以上なら厳密に維持する。狭い画面では水平視野だけが縮んで
  // 見開きの小口側が切れるため、注視点からの方向を保ったまま距離だけを増やす。
  if (activeSpreadHasCameraTracks(book, progress)) {
    return fitTrackedPoseToAspect(evaluateTimelineCamera(book, progress), aspect)
  }

  const aspectFit = Math.max(1, CAMERA_REFERENCE_ASPECT / Math.max(0.01, aspect))
  const signals = evaluateBookSignals(book, progress)
  const w = book.format.pageWidth
  const upright = Math.max(...signals.sheetAngles.map((angle) => Math.sin(Math.PI * angle)))
  let activeRadius = w * 0.55
  for (const [index, spread] of book.spreads.entries()) {
    let radius = w * 0.55
    for (const element of spread.elements) {
      const [x, y, z] = element.baseTransform.position
      const sizeGuess = ('width' in element ? Math.max(element.width, element.height) : 2)
        * Math.max(...element.baseTransform.scale)
      radius = Math.max(radius, Math.abs(x) + sizeGuess / 2, y + sizeGuess / 2, Math.abs(z) + sizeGuess / 2)
    }
    activeRadius = Math.max(activeRadius, normalizedDihedral(signals.dihedrals[index]) * radius)
  }
  const reach = Math.max(1, activeRadius / (w * 0.72))
  const fit = aspectFit * (1 + upright * 0.55) * reach
  return {
    position: [book.camera.position[0], book.camera.position[1] * fit, book.camera.position[2] * fit],
    target: [...book.camera.target],
    fov: book.camera.fov,
  }
}
