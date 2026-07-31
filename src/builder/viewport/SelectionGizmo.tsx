import { Billboard, TransformControls } from '@react-three/drei'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import type { TransformControls as TransformControlsImpl } from 'three-stdlib'
import { evaluateBookSignals } from '../../runtime/signals'
import { normalizedDihedral } from '../../runtime/stow/dihedral'
import { evaluateElementTimeline } from '../../runtime/timeline/evaluate'
import { useBuilderStore } from '../store'
import { emphasizeHoveredAxis } from './gizmoHighlight'
import { markGizmoPress } from './gizmoInteraction'
import { fixFlippedTranslationArrows } from './SceneGuides'

export function SelectionGizmo() {
  const store = useBuilderStore()
  const object = useMemo(() => new THREE.Object3D(), [])
  const [controls, setControls] = useState<TransformControlsImpl | null>(null)
  const [altHeld, setAltHeld] = useState(false)
  const selection = store.selection
  const spread = 'spreadId' in selection
    ? store.project.book.spreads.find((item) => item.id === selection.spreadId)
    : undefined
  const spreadIndex = spread ? store.project.book.spreads.indexOf(spread) : -1
  const signals = evaluateBookSignals(store.project.book, store.previewProgress)
  const openness = spreadIndex < 0 ? 1 : normalizedDihedral(signals.dihedrals[spreadIndex])
  const spreadTime = spreadIndex < 0 ? 0 : signals.spreadTimes[spreadIndex]
  const editableOpen = openness > 0.999
  let pose: { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] } | undefined
  let anchor: [number, number, number] = [0, 0, 0]
  let size: [number, number] = [1, 1]
  let visualOffset: [number, number] = [0, 0]
  let billboard = false
  if (selection.type === 'element' && spread) {
    const element = spread.elements.find((item) => item.id === selection.elementId)
    if (element) {
      pose = evaluateElementTimeline(element, spread, spreadTime).baseTransform
      const width = store.project.book.format.pageWidth
      if (element.parent.type === 'left-page') anchor = [-width / 2, 0, 0]
      else if (element.parent.type === 'right-page') anchor = [width / 2, 0, 0]
      if (element.type === 'image' || element.type === 'text') {
        size = [element.width, element.height]
      }
      if (element.type !== 'group' && element.type !== 'effect') {
        visualOffset = [(0.5 - element.pivot[0]) * size[0], (0.5 - element.pivot[1]) * size[1]]
      }
      billboard = element.type === 'image' && element.billboard
    }
  }

  useEffect(() => {
    if (!pose) return
    object.position.set(anchor[0] + pose.position[0], anchor[1] + pose.position[1], anchor[2] + pose.position[2])
    object.rotation.set(...pose.rotation.map(THREE.MathUtils.degToRad) as [number, number, number])
    object.scale.set(...pose.scale)
  }, [anchor, object, pose])
  useEffect(() => {
    if (!controls) return
    fixFlippedTranslationArrows(controls)
    emphasizeHoveredAxis(controls)
  }, [controls])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Alt') setAltHeld(true) }
    const onKeyUp = (event: KeyboardEvent) => { if (event.key === 'Alt') setAltHeld(false) }
    const onBlur = () => setAltHeld(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  if (!pose || selection.type !== 'element' || !editableOpen) return null
  const save = () => {
    const position: [number, number, number] = [
      object.position.x - anchor[0],
      object.position.y - anchor[1],
      object.position.z - anchor[2],
    ]
    const rotation = [object.rotation.x, object.rotation.y, object.rotation.z]
      .map(THREE.MathUtils.radToDeg) as [number, number, number]
    const scale: [number, number, number] = [object.scale.x, object.scale.y, object.scale.z]
    store.applyGizmoTransform(selection.spreadId, selection.elementId, spreadTime, { position, rotation, scale })
  }
  const outline = <mesh position={[visualOffset[0], visualOffset[1], 0]}>
    <boxGeometry args={[size[0], size[1], 0.03]} />
    <meshBasicMaterial color="#6d7cff" wireframe transparent opacity={0.5} />
  </mesh>
  return <>
    <primitive object={object}>
      {billboard ? <Billboard>{outline}</Billboard> : outline}
      <mesh><sphereGeometry args={[0.07, 12, 8]} /><meshBasicMaterial color="#ff5fc8" depthTest={false} /></mesh>
    </primitive>
    <TransformControls
      ref={setControls}
      object={object}
      mode={store.gizmo}
      space="world"
      size={0.75}
      showX
      showY
      showZ
      translationSnap={altHeld ? null : 0.25}
      rotationSnap={altHeld ? null : THREE.MathUtils.degToRad(5)}
      scaleSnap={altHeld ? null : 0.05}
      onMouseDown={markGizmoPress}
      onMouseUp={save}
    />
  </>
}

