import * as THREE from 'three'
import type { Spread } from '../schema/book'
import type { ParentSpace, Transform } from '../schema/stageElement'
import { evaluateMechanism, surfaceFrame } from '../runtime/mechanisms/evaluate'

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
  const isSpace = element.type === 'assembly' && (element.mechanism.mount.type === 'space' || element.mechanism.mount.type === 'gutter')
  const basis = isSpace ? new THREE.Matrix4() : ancestor
  if (!basis) return null
  const attachment = element.type === 'assembly' && element.mechanism.mount.type === 'surface' ? element.mechanism.mount : element.surfaceAttachment
  if (attachment && element.parent.type === 'element') {
    const parentId = element.parent.elementId
    const attachedParent = spread.elements.find((item) => item.id === parentId)
    if (attachedParent?.type === 'assembly') {
      const frame = surfaceFrame(evaluateMechanism(attachedParent.mechanism, { open: 1, clock: 0 }), attachment.surfaceId, attachment.u, attachment.v, attachment.offset)
      if (frame) basis.multiply(new THREE.Matrix4().fromArray(frame.matrix))
    }
  }
  return basis.multiply(transformMatrix(element.baseTransform))
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
  if (element.type === 'assembly') return false
  if (nextParent.type === 'element' && spread.elements.some((item) => item.id === nextParent.elementId && item.type === 'assembly')) return false
  if (nextParent.type === 'element' && (nextParent.elementId === id || elementDescendantIds(spread, id).has(nextParent.elementId))) return false

  const oldFrame = parentFrame(spread, element.parent, pageWidth)
  const nextFrame = parentFrame(spread, nextParent, pageWidth)
  if (!oldFrame || !nextFrame) return false
  if (element.surfaceAttachment && element.parent.type === 'element') {
    const parentId = element.parent.elementId
    const parent = spread.elements.find((item) => item.id === parentId)
    const mount = element.surfaceAttachment
    if (parent?.type === 'assembly') {
      const frame = surfaceFrame(evaluateMechanism(parent.mechanism, { open: 1, clock: 0 }), mount.surfaceId, mount.u, mount.v, mount.offset)
      if (frame) oldFrame.multiply(new THREE.Matrix4().fromArray(frame.matrix))
    }
  }

  const world = oldFrame.multiply(transformMatrix(element.baseTransform))
  const local = nextFrame.clone().invert().multiply(world)
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  local.decompose(position, rotation, scale)
  const euler = new THREE.Euler().setFromQuaternion(rotation)

  element.parent = structuredClone(nextParent)
  element.surfaceAttachment = undefined
  element.baseTransform = {
    position: [position.x, position.y, position.z],
    rotation: [euler.x, euler.y, euler.z].map(THREE.MathUtils.radToDeg) as [number, number, number],
    scale: [scale.x, scale.y, scale.z],
  }
  return true
}
