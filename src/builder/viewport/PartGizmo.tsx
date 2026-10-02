import { TransformControls } from '@react-three/drei'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Euler, Line, LineBasicMaterial, MathUtils, Matrix4, Object3D, Quaternion } from 'three'
import type { TransformControls as Controls } from 'three-stdlib'
import { describePartEdit, type PartEditDescription, type PartEditIntent } from '../../parts/edit'
import { bookEditScene } from '../../parts/bookEdit'
import { useBuilderStore } from '../store'
import { usePartEditStore } from '../parts/editState'
import { markGizmoPress } from './gizmoInteraction'
import { emphasizeHoveredAxis } from './gizmoHighlight'
import { fixFlippedTranslationArrows } from './SceneGuides'

export function PartGizmo({ spreadId, elementId }: { spreadId: string; elementId: string }) {
  const project = useBuilderStore((state) => state.project), mode = useBuilderStore((state) => state.gizmo)
  const selectedAngle = usePartEditStore((state) => state.angleId), session = usePartEditStore((state) => state.session)
  const description = useMemo(() => {
    try { return describePartEdit(bookEditScene(project, spreadId), elementId) } catch { return null }
  }, [project, spreadId, elementId])
  return description ? <ConnectedPartGizmo description={description} mode={mode} angleId={selectedAngle} active={!!session} invalid={!!session?.error}
    begin={() => usePartEditStore.getState().begin(spreadId, elementId)} preview={(intent) => usePartEditStore.getState().preview(intent)}
    finish={() => usePartEditStore.getState().finish()} cancel={() => usePartEditStore.getState().cancel()} /> : null
}
export function ConnectedPartGizmo({ description, mode, angleId, active, invalid, begin, preview, finish, cancel }: {
  description: PartEditDescription; mode: 'translate' | 'rotate' | 'scale'; angleId?: string; active: boolean; invalid: boolean
  /** 確定できたら true。確定後の位置が届くまでギズモを放した位置に残す */
  begin: () => void; preview: (intent: PartEditIntent) => void; finish: () => boolean; cancel: () => void
}) {
  const [controls, setControls] = useState<Controls | null>(null), [alt, setAlt] = useState(false)
  const object = useMemo(() => new Object3D(), []), dragging = useRef(false)
  const callbacks = useRef({ begin, preview, finish, cancel }); callbacks.current = { begin, preview, finish, cancel }
  const angle = description.angles.find((item) => item.id === angleId) ?? description.angles[0]
  const rotation = useMemo(() => {
    let x = description.x, y = description.y, z = description.normal
    if (mode === 'rotate' && angle?.axis) {
      z = angle.axis.clone().normalize()
      x = description.x.clone().addScaledVector(z, -description.x.dot(z))
      if (x.lengthSq() < 1e-8) x = description.y.clone().addScaledVector(z, -description.y.dot(z))
      x.normalize(); y = z.clone().cross(x).normalize()
    }
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z))
  }, [description, mode, angle])
  const reset = () => { object.position.copy(mode === 'rotate' && angle?.pivot ? angle.pivot : description.pivot); object.quaternion.copy(rotation); object.scale.setScalar(1) }
  // 確定後の新しい位置へ描画前に合わせる
  useLayoutEffect(() => { if (!active) dragging.current = false; if (!dragging.current) reset() }, [description, rotation, mode, active])
  useEffect(() => {
    if (!controls) return
    fixFlippedTranslationArrows(controls); emphasizeHoveredAxis(controls)
    const root = (controls as unknown as { gizmo: Object3D & { gizmo: Record<string, Object3D>; picker: Record<string, Object3D> } }).gizmo
    if (root.userData.paperScaleOnly) return
    root.userData.paperScaleOnly = true
    for (const handle of root.gizmo.scale.children) if (handle instanceof Line && /^[XYZ]$/.test(handle.name)) {
      handle.material = new LineBasicMaterial({ color: '#ffffff', opacity: .65, transparent: true, depthTest: false, depthWrite: false })
      handle.geometry.scale(1.375, 1.375, 1.375)
    }
    const update = root.updateMatrixWorld.bind(root)
    root.updateMatrixWorld = (force) => {
      update(force)
      // 白い等比ハンドルだけを表示し、軸別拡縮や平面拡縮を選ばせない。
      for (const group of [root.gizmo.scale, root.picker.scale]) for (const handle of group.children) {
        const guide = group === root.gizmo.scale && handle instanceof Line && /^[XYZ]$/.test(handle.name)
        if (!handle.name.startsWith('XYZ') && !guide) handle.visible = false
      }
    }
  }, [controls])
  useEffect(() => {
    const abort = () => {
      dragging.current = false; callbacks.current.cancel()
      if (controls) {
        controls.reset()
        // 組み込みのresetはドラッグを終えない。状態イベントを通してカメラ操作も戻す。
        ;(controls as unknown as { dragging: boolean }).dragging = false
      }
      reset(); setAlt(false)
    }
    const key = (event: KeyboardEvent) => {
      setAlt(event.altKey)
      if (event.key === 'Escape') abort()
    }
    const blur = abort
    window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', blur); if (dragging.current) callbacks.current.cancel() }
  }, [controls, description, rotation, mode, angle])
  if (!description || mode === 'rotate' && !angle) return null
  return <>
    <primitive object={object}><mesh renderOrder={10000}><sphereGeometry args={[.055, 12, 8]} />
      <meshBasicMaterial color={invalid ? '#ff485e' : '#ff5fc8'} depthTest={false} /></mesh></primitive>
    <TransformControls ref={setControls} object={object} mode={mode} space="local" size={.75}
      showX={mode !== 'rotate'}
      showY={mode === 'scale' || mode === 'translate' && description.translateY}
      showZ={mode === 'scale' || mode === 'rotate'}
      translationSnap={alt ? null : .1} rotationSnap={alt ? null : MathUtils.degToRad(5)} scaleSnap={alt ? null : .05}
      onMouseDown={() => { markGizmoPress(); dragging.current = true; callbacks.current.begin() }}
      onObjectChange={() => {
        if (!dragging.current) return
        if (mode === 'translate') {
          const delta = object.position.clone().sub(description.pivot)
          callbacks.current.preview({ type: 'translate', delta: [delta.dot(description.x), description.translateY ? delta.dot(description.y) : 0] })
        } else if (mode === 'rotate' && angle) {
          const q = rotation.clone().invert().multiply(object.quaternion), euler = new Euler().setFromQuaternion(q)
          callbacks.current.preview({ type: 'rotate', handle: angle.id, value: angle.value + MathUtils.radToDeg(euler.z) })
        } else if (mode === 'scale') {
          const values = object.scale.toArray(), ratio = values.reduce((a, b) => Math.abs(b - 1) > Math.abs(a - 1) ? b : a, 1)
          callbacks.current.preview({ type: 'scale', value: description.scale * ratio })
        }
      }} onMouseUp={() => {
        dragging.current = false
        // 確定前の位置へ戻すと、新しい位置が届くまでの描画で一瞬古い位置が映る。戻すのは確定できなかったときだけ
        if (!callbacks.current.finish()) reset()
      }} />
  </>
}
