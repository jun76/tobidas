import * as THREE from 'three'
import type { Spread } from '../../schema/book'
import type { ParentSpace, StageElement } from '../../schema/stageElement'

export interface OpenBounds {
  min: [number, number, number]
  max: [number, number, number]
}

export const penetrationEpsilon = (pageWidth: number): number => Math.max(.00001, pageWidth * .000001)
/** 接地予定部品の制作上の微小リフトも吸収する。既定幅8では0.08世界単位。 */
export const contactMargin = (pageWidth: number): number => Math.max(.08, pageWidth * .008)
export const ownershipMargin = (pageWidth: number): number => Math.max(.01, pageWidth * .001)

export function pageAnchorX(parent: ParentSpace, pageWidth: number): number {
  if (parent.type === 'left-page') return -pageWidth / 2
  if (parent.type === 'right-page') return pageWidth / 2
  return 0
}

export function childrenByParent(spread: Spread): Map<string, StageElement[]> {
  const result = new Map<string, StageElement[]>()
  for (const element of spread.elements) {
    if (element.parent.type !== 'element') continue
    result.set(element.parent.elementId, [...(result.get(element.parent.elementId) ?? []), element])
  }
  return result
}

/** 部品ツリーを、最上位部品の所属ページ座標で囲む。 */
export function subtreeOpenBounds(
  root: StageElement,
  children: Map<string, StageElement[]>,
): OpenBounds {
  const box = new THREE.Box3()
  const visit = (element: StageElement, parentMatrix: THREE.Matrix4) => {
    const matrix = parentMatrix.clone().multiply(elementMatrix(element))
    if (element.type === 'visual') {
      const x0 = -element.pivot[0] * element.width
      const x1 = (1 - element.pivot[0]) * element.width
      const y0 = -element.pivot[1] * element.height
      const y1 = (1 - element.pivot[1]) * element.height
      for (const x of [x0, x1]) for (const y of [y0, y1]) {
        box.expandByPoint(new THREE.Vector3(x, y, 0).applyMatrix4(matrix))
      }
    }
    for (const child of children.get(element.id) ?? []) visit(child, matrix)
  }
  visit(root, new THREE.Matrix4())
  if (box.isEmpty()) {
    const point = new THREE.Vector3(...root.baseTransform.position)
    box.set(point, point)
  }
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  }
}

export function spreadOpenBounds(
  root: StageElement,
  children: Map<string, StageElement[]>,
  pageWidth: number,
): OpenBounds {
  const bounds = subtreeOpenBounds(root, children)
  const anchor = pageAnchorX(root.parent, pageWidth)
  return {
    min: [bounds.min[0] + anchor, bounds.min[1], bounds.min[2]],
    max: [bounds.max[0] + anchor, bounds.max[1], bounds.max[2]],
  }
}

/** 紙面下へ入った最上位部品を、ツリーごと真上へ戻す。 */
export function constrainAbovePaper(
  root: StageElement,
  children: Map<string, StageElement[]>,
  pageWidth: number,
): number {
  const minY = subtreeOpenBounds(root, children).min[1]
  if (minY >= -penetrationEpsilon(pageWidth)) {
    if (minY < 0) root.baseTransform.position[1] -= minY
    return Math.max(0, -minY)
  }
  root.baseTransform.position[1] -= minY
  return -minY
}

/** 中央線越境後も開姿勢を変えず、所属ページの座標基準だけを替える。 */
export function updatePageOwnership(
  root: StageElement,
  children: Map<string, StageElement[]>,
  pageWidth: number,
): boolean {
  if (root.parent.type !== 'left-page' && root.parent.type !== 'right-page') return false
  const bounds = spreadOpenBounds(root, children, pageWidth)
  const centerX = (bounds.min[0] + bounds.max[0]) / 2
  const margin = ownershipMargin(pageWidth)
  const current = root.parent.type
  const next = centerX < -margin ? 'left-page' : centerX > margin ? 'right-page' : current
  if (next === current) return false
  const oldAnchor = pageAnchorX(root.parent, pageWidth)
  const newParent = { type: next } as const
  const newAnchor = pageAnchorX(newParent, pageWidth)
  root.baseTransform.position[0] += oldAnchor - newAnchor
  root.parent = newParent
  return true
}

function elementMatrix(element: StageElement): THREE.Matrix4 {
  const { position, rotation, scale } = element.baseTransform
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(rotation[0]),
      THREE.MathUtils.degToRad(rotation[1]),
      THREE.MathUtils.degToRad(rotation[2]),
      'XYZ',
    )),
    new THREE.Vector3(...scale),
  )
}
