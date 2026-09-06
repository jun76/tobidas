import * as THREE from 'three'
import type { Book, Spread } from '../../schema/book'
import { evaluateBookSignals } from '../signals'
import { blendCamera, evaluateSpreadCamera } from '../timeline/evaluate'
import { spreadCameraBounds } from './bounds'

export interface PlayCameraPose {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

/** 制作時の1.6画面に小口側の安全余白を加えた、横幅contain用の基準比率。 */
export const CAMERA_REFERENCE_ASPECT = 1.7

/** 自動構図の余白。開閉中の部品寸法では変化させない。 */
const FRAMING_MARGIN = 1.12

function fitTrackedPoseToAspect(pose: PlayCameraPose, aspect: number): PlayCameraPose {
  const fit = Math.max(1, CAMERA_REFERENCE_ASPECT / Math.max(.01, aspect))
  if (fit === 1) return pose
  return {
    ...pose,
    position: pose.position.map((value, axis) =>
      pose.target[axis] + (value - pose.target[axis]) * fit) as [number, number, number],
  }
}

/** 注視方向とFOVを保ち、境界の8頂点が視野へ入る距離を求める。 */
export function fitCameraPoseToBounds(
  pose: PlayCameraPose, bounds: THREE.Box3, aspect: number,
): PlayCameraPose {
  if (bounds.isEmpty()) return { position: [...pose.position], target: [...pose.target], fov: pose.fov }
  const position = new THREE.Vector3(...pose.position)
  const target = new THREE.Vector3(...pose.target)
  if (position.distanceToSquared(target) < 1e-12) position.add(new THREE.Vector3(0, 1, 2))
  const basis = new THREE.Matrix4().lookAt(position, target, new THREE.Vector3(0, 1, 0))
  const right = new THREE.Vector3().setFromMatrixColumn(basis, 0)
  const up = new THREE.Vector3().setFromMatrixColumn(basis, 1)
  const back = new THREE.Vector3().setFromMatrixColumn(basis, 2)
  const tangent = Math.tan(THREE.MathUtils.degToRad(pose.fov) / 2) / FRAMING_MARGIN
  const horizontal = tangent * Math.max(.01, aspect)
  let distance = position.distanceTo(target)
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const relative = new THREE.Vector3(x, y, z).sub(target)
        distance = Math.max(distance, relative.dot(back) + Math.max(
          Math.abs(relative.dot(right)) / horizontal,
          Math.abs(relative.dot(up)) / tangent,
          .3,
        ))
      }
    }
  }
  return { position: target.addScaledVector(back, distance).toArray(), target: [...pose.target], fov: pose.fov }
}

/** 編集時の全体表示。再生用の作者カメラは変更しない。 */
export function evaluateEditCameraPose(
  book: Book, spread: Spread, aspect: number, view: PlayCameraPose = book.camera,
): PlayCameraPose {
  const bounds = spreadCameraBounds(book, spread)
  const target = bounds.getCenter(new THREE.Vector3())
  const direction = new THREE.Vector3(...view.position).sub(new THREE.Vector3(...view.target)).normalize()
  return fitCameraPoseToBounds({
    position: target.clone().add(direction).toArray(), target: target.toArray(), fov: view.fov,
  }, bounds, aspect)
}

function spreadPose(book: Book, spread: Spread, time: number, aspect: number): PlayCameraPose {
  const pose = evaluateSpreadCamera(spread, time, book.camera)
  // 明示したカメラは巨大部品の拡大を強調する構図としても使う。部品境界を重ねない。
  if (spread.timeline.tracks.some((track) => track.target.type === 'camera' && track.keys.length)) {
    return fitTrackedPoseToAspect(pose, aspect)
  }
  return fitCameraPoseToBounds(pose, spreadCameraBounds(book, spread), aspect)
}

export function evaluatePlayCameraPose(book: Book, progress: number, aspect: number): PlayCameraPose {
  const signals = evaluateBookSignals(book, progress)
  const spread = book.spreads[signals.activeSpreadIndex]
  // 見開きごとに全開境界から構図を決め、ページ送りでは二つの構図だけを補間する。
  // 毎フレームの二面角や収納途中の縮尺で再フィットすると、巨大展開と逆向きにズームする。
  if (signals.beat.kind === 'turn' && signals.activeSpreadIndex + 1 < book.spreads.length) {
    return blendCamera(
      spreadPose(book, spread, spread.sequence.holdSeconds, aspect),
      spreadPose(book, book.spreads[signals.activeSpreadIndex + 1], 0, aspect),
      signals.beatProgress,
    )
  }
  if (signals.beat.kind === 'cover-open') {
    const first = spreadPose(book, spread, 0, aspect)
    // 自動構図では開き始めから全開時の距離を使い、拡大する機構を追って後退しない。
    if (!spread.timeline.tracks.some((track) => track.target.type === 'camera' && track.keys.length)) return first
    return blendCamera(fitTrackedPoseToAspect(book.camera, aspect), first, signals.beatProgress)
  }
  const time = signals.beat.kind === 'back-cover-close' ? spread.sequence.holdSeconds
    : signals.spreadTimes[signals.activeSpreadIndex]
  return spreadPose(book, spread, time, aspect)
}
