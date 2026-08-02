import * as THREE from 'three'
import type { SparkleField } from './sparkleField'

/**
 * 粒の中心を、透明平面内に寝た小さな四角形へ展開する。
 *
 * THREE.Points は各粒を常に画面へ正対させ、四角形全体へ中心点の深度を使う。
 * そのため紙の裏にある中心から円の端だけが隣ページへ描かれてしまう。
 * 実際の面へすれば各断片が紙と同じ座標系・深度で検査される。
 */
export function buildSparkleSpriteGeometry(field: SparkleField): THREE.BufferGeometry {
  const positions: number[] = []
  const phases: number[] = []
  const rates: number[] = []
  const corners: number[] = []
  const indices: number[] = []
  const quadCorners = [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]

  for (let particle = 0; particle < field.rates.length; particle++) {
    const vertexBase = particle * 4
    for (let corner = 0; corner < 4; corner++) {
      positions.push(
        field.positions[particle * 3],
        field.positions[particle * 3 + 1],
        field.positions[particle * 3 + 2],
      )
      phases.push(
        field.phases[particle * 3],
        field.phases[particle * 3 + 1],
        field.phases[particle * 3 + 2],
      )
      rates.push(field.rates[particle])
      corners.push(quadCorners[corner * 2], quadCorners[corner * 2 + 1])
    }
    indices.push(vertexBase, vertexBase + 1, vertexBase + 2, vertexBase, vertexBase + 2, vertexBase + 3)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('phase', new THREE.Float32BufferAttribute(phases, 3))
  geometry.setAttribute('rate', new THREE.Float32BufferAttribute(rates, 1))
  geometry.setAttribute('corner', new THREE.Float32BufferAttribute(corners, 2))
  geometry.setIndex(indices)
  return geometry
}
