import * as THREE from 'three'
import type { Book } from '../schema/book'

const SHADOW_MAP_SIZE = 2048

/** 紙面、めくり途中の表紙、左右へ移動する本と受け皿を同じ影の範囲へ収める。 */
export function bookShadowSettings(book: Book, lightPosition: [number, number, number]) {
  const { pageWidth: width, pageAspect, coverThickness, pageThickness } = book.format
  const depth = width / pageAspect
  const stack = Math.max(pageThickness * (book.spreads.length + 1), coverThickness * .22)
  const ground = { y: -.31, z: .6, width: width * 2.5, depth: depth * 1.8 }
  // 光の向きと再生位置によらない包囲球。フレームごとに範囲を詰めると影が泳ぐ。
  const radius = Math.hypot(
    ground.width / 2 + width / 2,
    Math.max(width + coverThickness + stack, -ground.y),
    ground.depth / 2 + ground.z,
  ) + .05
  const direction = new THREE.Vector3(...lightPosition)
  const distance = Math.max(direction.length(), radius + .5)
  // 平行光源は距離で明るさが変わらない。同じ向きのまま影カメラを包囲球の外へ置き、
  // 大判の本でも光源側の紙が near 面で欠けないようにする。
  if (direction.lengthSq() === 0) direction.set(0, 0, 1)
  const position = direction.normalize().multiplyScalar(distance).toArray() as [number, number, number]
  const near = .5
  const far = distance + radius + .5
  // 自己影の縞を抑える補正は半テクセルに留め、光源が遠くても紙から影を離しすぎない。
  const normalBias = radius / SHADOW_MAP_SIZE
  return {
    ground, position, radius, mapSize: SHADOW_MAP_SIZE,
    near, far, normalBias, bias: -normalBias / (far - near),
  }
}
