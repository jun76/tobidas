import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ASSET_POINTER_DRAG_EVENT, type AssetPointerDragDetail } from '../assetPointerDrag'
import { assetKindForMode } from '../presets'
import { useBuilderStore } from '../store'

interface PageDropTargetData {
  spreadId: string
  side: 'left' | 'right'
}

export function PageDropController() {
  const store = useBuilderStore()
  const { camera, gl, scene } = useThree()
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const pointer = useMemo(() => new THREE.Vector2(), [])
  const marker = useRef<THREE.Group>(null)
  const width = store.project.book.format.pageWidth
  const depth = width / store.project.book.format.pageAspect

  useEffect(() => {
    type PageMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> & {
      userData: { pageDropTarget?: PageDropTargetData }
    }
    const show = (point: THREE.Vector3 | null) => {
      if (!marker.current) return
      marker.current.visible = Boolean(point)
      if (point) marker.current.position.copy(point)
    }
    const hitPage = (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect()
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null
      pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      scene.updateMatrixWorld(true)
      raycaster.setFromCamera(pointer, camera)
      const targets: PageMesh[] = []
      scene.traverse((object) => {
        const mesh = object as PageMesh
        if (mesh.isMesh && mesh.userData.pageDropTarget?.spreadId === store.activeSpreadId) targets.push(mesh)
      })
      const intersection = raycaster.intersectObjects(targets, false)[0]
      if (!intersection) return null
      const mesh = intersection.object as PageMesh
      const local = mesh.worldToLocal(intersection.point.clone())
      const normal = intersection.face?.normal.clone().transformDirection(mesh.matrixWorld) ?? new THREE.Vector3(0, 1, 0)
      if (normal.dot(raycaster.ray.direction) > 0) normal.negate()
      return {
        markerPoint: intersection.point.clone().addScaledVector(normal, 0.025),
        side: mesh.userData.pageDropTarget!.side,
        point: {
          x: THREE.MathUtils.clamp(local.x / width + 0.5, 0, 1),
          y: THREE.MathUtils.clamp(-local.y / depth + 0.5, 0, 1),
        },
      }
    }
    const onAssetDrag = (event: Event) => {
      const detail = (event as CustomEvent<AssetPointerDragDetail>).detail
      if (detail.phase === 'cancel') {
        show(null)
        return
      }
      // 画像プリセットを選んでいないときは紙面へ落とせない。どの型で置くかを
      // 決めずに置ける経路を残すと、投入導線が二本立てへ戻る
      const placing = assetKindForMode(store.placement) === 'image'
      const hit = placing ? hitPage(detail.clientX, detail.clientY) : null
      if (detail.phase === 'move') {
        show(hit?.markerPoint ?? null)
        return
      }
      show(null)
      if (hit) store.placeAsset(store.activeSpreadId, hit.side, detail.assetId, hit.point)
    }
    window.addEventListener(ASSET_POINTER_DRAG_EVENT, onAssetDrag)
    return () => {
      window.removeEventListener(ASSET_POINTER_DRAG_EVENT, onAssetDrag)
      show(null)
    }
  }, [camera, depth, gl, pointer, raycaster, scene, store, width])

  return <group ref={marker} visible={false}>
    <mesh renderOrder={30}>
      <sphereGeometry args={[0.055, 16, 12]} />
      <meshBasicMaterial color="#ff3344" depthTest />
    </mesh>
    <mesh renderOrder={29}>
      <sphereGeometry args={[0.11, 16, 12]} />
      <meshBasicMaterial color="#ff6677" transparent opacity={0.3} depthWrite={false} />
    </mesh>
  </group>
}
