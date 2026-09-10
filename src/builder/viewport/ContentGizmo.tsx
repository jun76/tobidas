import { TransformControls } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Euler, MathUtils, Object3D, Quaternion, Vector3 } from 'three'
import type { TransformControls as Controls } from 'three-stdlib'
import { bindBookContents, evaluateContents, type EvaluatedContent } from '../../parts/contents'
import { evaluateBookParts } from '../../parts/book'
import type { ContentEditIntent } from '../../parts/contentEdit'
import { useBuilderStore } from '../store'
import { useContentEditStore } from '../parts/contentEditState'
import { markGizmoPress } from './gizmoInteraction'
import { emphasizeHoveredAxis } from './gizmoHighlight'
import { fixFlippedTranslationArrows } from './SceneGuides'

export function ContentGizmo({ spreadId, elementId }: { spreadId: string; elementId: string }) {
  const store = useBuilderStore(), edit = useContentEditStore()
  const source = useMemo(() => {
    const spread = store.project.book.spreads.find((item) => item.id === spreadId)!
    try { return evaluateContents(bindBookContents(store.project, spread, evaluateBookParts(store.project, spread, Math.PI, 0), Math.PI, 0),
      { openingAngleDeg: 180, maxOpeningAngleDeg: 180, holdTime: 0, clock: () => 0 }).find((item) => item.id === elementId) }
    catch { return undefined }
  }, [store.project, spreadId, elementId])
  return source ? <ContentTransformGizmo source={source} mode={store.gizmo} error={edit.error}
    begin={() => edit.begin(spreadId, elementId)} preview={edit.preview} finish={edit.finish} cancel={edit.cancel} /> : null
}
/** 本とカスタム部品で、材料座標へ戻す操作を共有する。保存とUndoは呼び出し側の共通コマンドが担う。 */
export function ContentTransformGizmo({ source, mode, error, begin, preview, finish, cancel: abort }: {
  source: EvaluatedContent; mode: 'translate' | 'rotate' | 'scale'; error: string
  begin: () => void; preview: (intent: ContentEditIntent) => void; finish: () => void; cancel: () => void
}) {
  const object = useMemo(() => new Object3D(), [])
  const [controls, setControls] = useState<Controls | null>(null), [alt, setAlt] = useState(false), dragging = useRef(false)
  const reset = () => {
    if (!source) return
    source.anchor.decompose(object.position, object.quaternion, new Vector3())
    if (mode !== 'translate') {
      object.position.copy(new Vector3(...source.element.baseTransform.position).applyMatrix4(source.anchor))
      object.quaternion.multiply(new Quaternion().setFromEuler(new Euler(...source.element.baseTransform.rotation.map(MathUtils.degToRad) as [number, number, number])))
    }
    object.position.y += .015
    object.scale.set(...(mode === 'scale' ? source.element.baseTransform.scale : [1, 1, 1]) as [number, number, number])
  }
  useEffect(() => { if (!dragging.current) reset() }, [source, mode])
  useEffect(() => { if (controls) { emphasizeHoveredAxis(controls); fixFlippedTranslationArrows(controls) } }, [controls])
  useEffect(() => {
    const cancel = () => { dragging.current = false; abort(); if (controls) { controls.reset(); (controls as unknown as { dragging: boolean }).dragging = false }; reset() }
    const key = (event: KeyboardEvent) => { setAlt(event.altKey); if (event.key === 'Escape') cancel() }
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', cancel)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', cancel) }
  }, [controls, source, mode])
  if (!source) return null
  const decal = source.element.presentation.kind === 'decal'
  const change = () => {
    if (!dragging.current) return
    const attachment = source.element.attachment
    let intent: ContentEditIntent
    if (mode === 'translate') {
      const local = object.position.clone().sub(new Vector3(0, .015, 0)).applyMatrix4(source.anchor.clone().invert())
      intent = attachment.type === 'surface' ? { type: 'anchor', point: [attachment.point[0] + local.x * (attachment.side === 'back' ? -1 : 1), attachment.point[1] + local.y],
        offset: decal ? 0 : source.element.baseTransform.position[2] + local.z } : { type: 'position', value: local.add(new Vector3(...source.element.baseTransform.position)).toArray() }
    } else if (mode === 'rotate') {
      const rotation = new Euler().setFromQuaternion(new Quaternion().setFromRotationMatrix(source.anchor).invert().multiply(object.quaternion))
      intent = { type: 'rotation', value: [rotation.x, rotation.y, rotation.z].map(MathUtils.radToDeg) as [number, number, number] }
    } else intent = { type: 'scale', value: object.scale.toArray() }
    preview(intent)
  }
  return <><primitive object={object}><mesh renderOrder={10000}><sphereGeometry args={[.065, 12, 8]} /><meshBasicMaterial color={error ? '#ff485e' : '#ff5fc8'} depthTest={false} /></mesh></primitive>
    <TransformControls ref={setControls} object={object} mode={mode} space="local" size={.75}
      showX={!decal || mode !== 'rotate'} showY={!decal || mode !== 'rotate'} showZ={!decal || mode === 'rotate'}
      translationSnap={alt ? null : .1} rotationSnap={alt ? null : MathUtils.degToRad(5)} scaleSnap={alt ? null : .05}
      onMouseDown={() => { markGizmoPress(); dragging.current = true; begin() }} onObjectChange={change}
      onMouseUp={() => { if (!dragging.current) return; dragging.current = false; finish(); reset() }} />
  </>
}
