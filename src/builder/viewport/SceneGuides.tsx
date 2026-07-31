import { TransformControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { TransformControls as TransformControlsImpl } from 'three-stdlib'
import type { Book, BookLights, Spread } from '../../schema/book'
import { evaluatePlayCameraPose } from '../../runtime/camera/playCamera'
import { evaluateSpreadCamera, type CameraPose } from '../../runtime/timeline/evaluate'
import { useBuilderStore } from '../store'
import { selectActiveSpread } from '../state/selectors'
import { emphasizeHoveredAxis } from './gizmoHighlight'
import { didGizmoPress, markGizmoPress } from './gizmoInteraction'

const CAMERA_COLOR = 0x6d7cff
const SAVED_CAMERA_COLOR = 0xe43d3d

export function CameraPreview({ book, progress }: { book: Book; progress: number }) {
  const size = useThree((state) => state.size)
  const camera = useMemo(() => new THREE.PerspectiveCamera(45, 1.6, 0.15, 2), [])
  const helper = useMemo(() => {
    const result = new THREE.CameraHelper(camera)
    const color = new THREE.Color(CAMERA_COLOR)
    result.setColors(color, color, color, color, color)
    return result
  }, [camera])
  const targetLine = useMemo(() => new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineDashedMaterial({ color: CAMERA_COLOR, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.6 }),
  ), [])
  const targetRef = useRef<THREE.Mesh>(null)
  const position = useMemo(() => new THREE.Vector3(), [])
  useEffect(() => () => {
    helper.dispose()
    targetLine.geometry.dispose()
    targetLine.material.dispose()
  }, [helper, targetLine])

  useFrame(({ camera: viewCamera }) => {
    const pose = evaluatePlayCameraPose(book, progress, size.width / Math.max(1, size.height))
    position.set(...pose.position)
    camera.fov = pose.fov
    camera.position.copy(position)
    camera.updateProjectionMatrix()
    camera.lookAt(...pose.target)
    camera.updateMatrixWorld(true)
    helper.update()
    const visible = viewCamera.position.distanceToSquared(position) > 0.25
    helper.visible = visible
    targetLine.visible = visible
    const points = targetLine.geometry.attributes.position as THREE.BufferAttribute
    points.setXYZ(0, position.x, position.y, position.z)
    points.setXYZ(1, ...pose.target)
    points.needsUpdate = true
    targetLine.computeLineDistances()
    targetRef.current?.position.set(...pose.target)
  })

  return <>
    <primitive object={helper} />
    <primitive object={targetLine} />
    <mesh ref={targetRef}>
      <sphereGeometry args={[0.08, 12, 8]} />
      <meshBasicMaterial color={CAMERA_COLOR} />
    </mesh>
  </>
}

/**
 * カメラキー保存ボタンで焼いた視点を赤い枠で置く。青い枠 (CameraPreview) は現在の進行値から
 * 評価される最終的な再生視点で、こちらは制作者が保存した原本そのもの。枠をつつくとその時刻へ飛ぶ。
 * 出すのは編集中の見開きのぶんだけ — キーの時刻はその見開きの保持区間の秒だから。
 */
export function SavedCameraMarkers() {
  const store = useBuilderStore()
  const spread = selectActiveSpread(store)
  const fallback = store.project.book.camera
  const saved = useMemo(() => collectCameraKeyPoses(spread, fallback), [spread, fallback])
  if (!spread) return null
  return <>
    {saved.map(({ time, pose }) => (
      <SavedCameraMarker key={time} pose={pose} onSelect={() => store.setSpreadTime(spread.id, time)} />
    ))}
  </>
}

function collectCameraKeyPoses(spread: Spread | undefined, fallback: Book['camera']): { time: number; pose: CameraPose }[] {
  if (!spread) return []
  const times = new Set<number>()
  for (const track of spread.timeline.tracks) {
    if (track.target.type !== 'camera') continue
    for (const key of track.keys) times.add(key.time)
  }
  return [...times].sort((a, b) => a - b)
    .map((time) => ({ time, pose: evaluateSpreadCamera(spread, time, fallback) }))
}

function SavedCameraMarker({ pose, onSelect }: { pose: CameraPose; onSelect: () => void }) {
  const size = useThree((state) => state.size)
  const camera = useMemo(() => new THREE.PerspectiveCamera(pose.fov, 1.6, 0.08, 0.9), []) // eslint-disable-line react-hooks/exhaustive-deps
  const helper = useMemo(() => {
    const marker = new THREE.CameraHelper(camera)
    const color = new THREE.Color(SAVED_CAMERA_COLOR)
    marker.setColors(color, color, color, color, color)
    return marker
  }, [camera])

  useEffect(() => {
    camera.aspect = size.width / Math.max(1, size.height)
    camera.fov = pose.fov
    camera.position.set(...pose.position)
    camera.lookAt(...pose.target)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    helper.update()
  }, [camera, helper, pose, size.height, size.width])
  useEffect(() => () => helper.dispose(), [helper])

  // 保存した視点そのものに立っているときは枠が視界を埋めるだけなので引っ込める
  useFrame(({ camera: viewCamera }) => {
    helper.visible = viewCamera.position.distanceToSquared(camera.position) > 0.25
  })

  return <>
    <primitive object={helper} />
    <mesh
      position={pose.position}
      onClick={(event) => {
        event.stopPropagation()
        if (!didGizmoPress()) onSelect()
      }}
    >
      <sphereGeometry args={[0.18, 10, 8]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  </>
}

export function EditableLight({ lights }: { lights: BookLights }) {
  const store = useBuilderStore()
  const { position, color } = lights.directional
  const selected = store.selection.type === 'light'
  const object = useMemo(() => new THREE.Object3D(), [])
  const [controls, setControls] = useState<TransformControlsImpl | null>(null)
  const line = useMemo(() => new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineDashedMaterial({ color, dashSize: 0.15, gapSize: 0.12, transparent: true, opacity: 0.5 }),
  ), [color])
  useEffect(() => { object.position.set(...position) }, [object, position])
  useEffect(() => {
    if (!controls) return
    fixFlippedTranslationArrows(controls)
    emphasizeHoveredAxis(controls)
  }, [controls])
  useEffect(() => () => {
    line.geometry.dispose()
    line.material.dispose()
  }, [line])

  useFrame(() => {
    const points = line.geometry.attributes.position as THREE.BufferAttribute
    points.setXYZ(0, object.position.x, object.position.y, object.position.z)
    points.setXYZ(1, 0, 0, 0)
    points.needsUpdate = true
    line.computeLineDistances()
  })

  const selectLight = (event: { stopPropagation: () => void }) => {
    event.stopPropagation()
    store.setGizmo('translate')
    store.select({ type: 'light' })
  }

  return <>
    <primitive object={object}>
      <mesh onClick={selectLight}>
        <sphereGeometry args={[0.16, 14, 10]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh onClick={selectLight}>
        <sphereGeometry args={[0.28, 10, 8]} />
        <meshBasicMaterial color={selected ? '#8996ff' : color} wireframe transparent opacity={selected ? 0.9 : 0.45} />
      </mesh>
    </primitive>
    <primitive object={line} />
    {selected && <TransformControls
      ref={setControls}
      object={object}
      mode="translate"
      space="world"
      size={0.75}
      translationSnap={0.25}
      onMouseDown={markGizmoPress}
      onMouseUp={() => {
        const next: [number, number, number] = [object.position.x, object.position.y, object.position.z]
        store.commit((project) => { project.book.lights.directional.position = next })
      }}
    />}
  </>
}

export function fixFlippedTranslationArrows(control: TransformControlsImpl): void {
  type TaggedMesh = THREE.Mesh & { tag?: string }
  const forward = new Map<string, TaggedMesh>()
  const backward: TaggedMesh[] = []
  control.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !['X', 'Y', 'Z'].includes(node.name)) return
    const handle = node as TaggedMesh
    if (handle.tag === 'fwd') forward.set(handle.name, handle)
    else if (handle.tag === 'bwd') backward.push(handle)
  })
  for (const handle of backward) {
    const source = forward.get(handle.name)
    if (!source) continue
    handle.geometry.dispose()
    handle.geometry = source.geometry.clone()
  }
}
