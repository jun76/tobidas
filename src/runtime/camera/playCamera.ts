import type { Book } from '../../schema/book'
import { activeSpreadHasCameraTracks, evaluateTimelineCamera } from '../camera'
import { evaluateBookSignals } from '../signals'
import { normalizedDihedral } from '../stow/dihedral'

export interface PlayCameraPose {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

export function evaluatePlayCameraPose(book: Book, progress: number, aspect: number): PlayCameraPose {
  // カメラキーのある見開きは制作者が焼いた姿勢をそのまま使う。自動フィットを重ねると
  // 画面の縦横比しだいで注視点から引き伸ばされ、カメラを打った意味が消える。
  // ビルダーの赤いマーカー (保存値) と青い枠 (再生位置) が一致するのもこの約束による
  if (activeSpreadHasCameraTracks(book, progress)) return evaluateTimelineCamera(book, progress)

  const aspectFit = Math.max(1, 1.45 / Math.max(0.01, aspect))
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
