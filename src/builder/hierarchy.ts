import * as THREE from 'three'
import type { Spread } from '../schema/book'
import type { ParentSpace, Transform } from '../schema/stageElement'

function transformMatrix(transform: Transform) {
  const matrix = new THREE.Matrix4()
  matrix.compose(
    new THREE.Vector3(...transform.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])),
    new THREE.Vector3(...transform.scale),
  )
  return matrix
}

function parentFrame(spread: Spread, parent: ParentSpace, pageWidth: number, seen = new Set<string>()): THREE.Matrix4 | null {
  if (parent.type === 'left-page') return new THREE.Matrix4().makeTranslation(-pageWidth / 2, 0, 0)
  if (parent.type === 'right-page') return new THREE.Matrix4().makeTranslation(pageWidth / 2, 0, 0)
  if (seen.has(parent.elementId)) return null
  const element = spread.elements.find((item) => item.id === parent.elementId)
  if (!element) return null
  seen.add(element.id)
  const ancestor = parentFrame(spread, element.parent, pageWidth, seen)
  return ancestor?.multiply(transformMatrix(element.baseTransform)) ?? null
}

export function elementDescendantIds(spread: Spread, id: string): Set<string> {
  const found = new Set<string>()
  const visit = (parentId: string) => {
    for (const element of spread.elements) {
      if (element.parent.type !== 'element' || element.parent.elementId !== parentId || found.has(element.id)) continue
      found.add(element.id)
      visit(element.id)
    }
  }
  visit(id)
  return found
}

export type RootParentType = 'left-page' | 'right-page'

export function containerElementIds(spread: Spread, parentType: RootParentType): Set<string> {
  const found = new Set<string>()
  for (const element of spread.elements) {
    if (element.parent.type !== parentType) continue
    found.add(element.id)
    for (const descendantId of elementDescendantIds(spread, element.id)) found.add(descendantId)
  }
  return found
}

/** 部品の開いた状態でのワールド姿勢を保ったまま親を変更する。 */
export function reparentElement(spread: Spread, id: string, nextParent: ParentSpace, pageWidth: number): boolean {
  const element = spread.elements.find((item) => item.id === id)
  if (!element) return false
  if (nextParent.type === 'element' && (nextParent.elementId === id || elementDescendantIds(spread, id).has(nextParent.elementId))) return false

  const oldFrame = parentFrame(spread, element.parent, pageWidth)
  const nextFrame = parentFrame(spread, nextParent, pageWidth)
  if (!oldFrame || !nextFrame) return false

  const world = oldFrame.multiply(transformMatrix(element.baseTransform))
  const local = nextFrame.clone().invert().multiply(world)
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  local.decompose(position, rotation, scale)
  const euler = new THREE.Euler().setFromQuaternion(rotation)

  element.parent = structuredClone(nextParent)
  element.baseTransform = {
    position: [position.x, position.y, position.z],
    rotation: [euler.x, euler.y, euler.z].map(THREE.MathUtils.radToDeg) as [number, number, number],
    scale: [scale.x, scale.y, scale.z],
  }
  return true
}
