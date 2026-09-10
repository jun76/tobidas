import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { placementSurfaces, type PartPlacementPlan, type SurfacePick } from '../../parts/placement'
import { useBuilderStore } from '../store'
import { usePartPlacementStore } from '../parts/placementState'
import { placePartOnSurfacesCommand, previewSurfacePlacement } from '../parts/commands'
import { newConnectedContent, placeContentCommand } from '../parts/contentCommands'
import { faceContains, pointOnFace } from '../../parts/geometry'
import { PagePointerMarker } from './PageDropController'

export function PartPlacementController() {
  const { camera, gl, scene } = useThree(), store = useBuilderStore()
  const tool = usePartPlacementStore((state) => state.tool), first = usePartPlacementStore((state) => state.first)
  const marker = useRef<THREE.Group>(null), hover = useRef<THREE.Mesh>(null), chosen = useRef<THREE.Mesh>(null)
  const hatch = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32
    const context = canvas.getContext('2d')!
    context.fillStyle = '#ffffff55'; context.fillRect(0, 0, 32, 32)
    context.strokeStyle = '#ffffffff'; context.lineWidth = 3
    for (let x = -32; x <= 32; x += 16) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x + 32, 32); context.stroke() }
    const texture = new THREE.CanvasTexture(canvas)
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(14, 14)
    return texture
  }, [])
  useEffect(() => () => hatch.dispose(), [hatch])
  useEffect(() => {
    if (!first && chosen.current) chosen.current.visible = false
    if (!tool) return
    const spread = store.project.book.spreads.find((item) => item.id === store.activeSpreadId)
    if (!spread) return
    const faces = placementSurfaces(store.project, spread), raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2()
    const canvas = gl.domElement
    let down: [number, number] | null = null, pending = 0, position: [number, number] | null = null
    const hide = () => {
      if (marker.current) marker.current.visible = false
      if (hover.current) hover.current.visible = false
      usePartPlacementStore.getState().showHover(null, null)
    }
    const hitAt = (x: number, y: number) => {
      const rect = canvas.getBoundingClientRect()
      pointer.set((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1)
      scene.updateMatrixWorld(true); raycaster.setFromCamera(pointer, camera)
      const targets: THREE.Mesh[] = []
      scene.traverseVisible((object) => {
        if (!(object instanceof THREE.Mesh)) return
        const target = object.userData.partSurfaceTarget ?? object.userData.pageDropTarget
        if (target?.spreadId === spread.id) targets.push(object)
      })
      for (const hit of raycaster.intersectObjects(targets, false)) {
        const mesh = hit.object as THREE.Mesh, data = mesh.userData
        const target = faces.find((item) => data.partSurfaceTarget ? item.face.id === data.partSurfaceTarget.faceId
          : item.reference.nodeId === '$book' && item.reference.portId === `${data.pageDropTarget.side}-page`)
        if (!target) continue
        const delta = hit.point.clone().sub(target.face.origin)
        // 描画用の紙厚補正を取り除き、実際に触れた材料座標を保存する。
        const local = mesh.worldToLocal(hit.point.clone())
        const pick: SurfacePick = { surface: target.reference, point: data.partSurfaceTarget ? [local.x, local.y] : [delta.dot(target.face.u), delta.dot(target.face.v)] }
        if (!faceContains(target.face, pointOnFace(target.face, ...pick.point), 1e-6)) continue
        const materialNormal = target.face.u.clone().cross(target.face.v)
        const side = materialNormal.dot(raycaster.ray.direction) < 0 ? 'front' as const : 'back' as const
        const normal = hit.face!.normal.clone().transformDirection(mesh.matrixWorld)
        if (normal.dot(raycaster.ray.direction) > 0) normal.negate()
        return { mesh, pick, side, point: hit.point.clone().addScaledVector(normal, .025), normal }
      }
      return null
    }
    const update = (x: number, y: number) => {
      const hit = hitAt(x, y)
      if (!hit) { hide(); return null }
      const plan: PartPlacementPlan | undefined = tool.reference && first ? previewSurfacePlacement(spread.id, tool.reference, first, hit.pick)
        : tool.reference && tool.faces === 1 ? previewSurfacePlacement(spread.id, tool.reference, hit.pick) : undefined
      const invalid = plan && !plan.ok
      if (hover.current) {
        hover.current.geometry = hit.mesh.geometry
        hover.current.matrix.copy(hit.mesh.matrixWorld)
        hover.current.matrix.setPosition(new THREE.Vector3().setFromMatrixPosition(hit.mesh.matrixWorld).addScaledVector(hit.normal, .012))
        ;(hover.current.material as THREE.MeshBasicMaterial).color.set(invalid ? '#ff5260' : '#529dff')
        hover.current.visible = true
      }
      if (marker.current) { marker.current.position.copy(hit.point); marker.current.visible = true }
      usePartPlacementStore.getState().showHover(`${hit.pick.surface.nodeId}/${hit.pick.surface.portId}`, invalid ? plan.reason : null)
      return { ...hit, plan }
    }
    const move = (event: PointerEvent) => {
      position = [event.clientX, event.clientY]
      if (!pending) pending = requestAnimationFrame(() => { pending = 0; if (position) update(...position) })
    }
    const press = (event: PointerEvent) => {
      if (event.button !== 0) return
      down = [event.clientX, event.clientY]; event.stopPropagation()
    }
    const release = (event: PointerEvent) => {
      if (event.button !== 0) return
      event.stopPropagation()
      // 配置確定によって選択モードが解除されても、直後のclickを通常選択へ渡さない。
      canvas.addEventListener('click', (click) => click.stopPropagation(), { capture: true, once: true })
      if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) { down = null; return }
      down = null
      const hit = update(event.clientX, event.clientY)
      if (!hit || hit.plan && !hit.plan.ok) return
      if (!first && tool.faces === 2) {
        if (chosen.current && hover.current) {
          chosen.current.geometry = hover.current.geometry; chosen.current.matrix.copy(hover.current.matrix); chosen.current.visible = true
        }
        usePartPlacementStore.getState().chooseFirst(hit.pick); return
      }
      const result = tool.content ? placeContentCommand({ spreadId: spread.id, element: newConnectedContent(tool.content, { type: 'surface', surface: hit.pick.surface, point: hit.pick.point, side: hit.side }) }) : placePartOnSurfacesCommand({ spreadId: spread.id, name: tool.name, definition: tool.reference!,
        first: first ?? hit.pick, second: first ? hit.pick : undefined })
      if (result.ok) usePartPlacementStore.getState().cancel()
      else usePartPlacementStore.setState({ error: result.message })
    }
    const leave = () => { position = null; down = null; hide() }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); usePartPlacementStore.getState().cancel() }
    }
    const previousCursor = canvas.style.cursor; canvas.style.cursor = 'crosshair'
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerdown', press, true)
    canvas.addEventListener('pointerup', release, true); canvas.addEventListener('pointerleave', leave); window.addEventListener('keydown', key)
    return () => {
      cancelAnimationFrame(pending); canvas.style.cursor = previousCursor
      canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerdown', press, true)
      canvas.removeEventListener('pointerup', release, true); canvas.removeEventListener('pointerleave', leave); window.removeEventListener('keydown', key)
      hide()
      if (!usePartPlacementStore.getState().tool && chosen.current) chosen.current.visible = false
    }
  }, [camera, gl, scene, store.project, store.activeSpreadId, tool, first])
  return <>
    <PagePointerMarker markerRef={marker} />
    <mesh ref={hover} visible={false} matrixAutoUpdate={false} renderOrder={40} raycast={() => {}}>
      <bufferGeometry /><meshBasicMaterial map={hatch} side={THREE.DoubleSide} transparent opacity={.8} depthWrite={false} />
    </mesh>
    <mesh ref={chosen} visible={false} matrixAutoUpdate={false} renderOrder={39} raycast={() => {}}>
      <bufferGeometry /><meshBasicMaterial color="#7fb7ff" side={THREE.DoubleSide} transparent opacity={.22} depthWrite={false} />
    </mesh>
  </>
}
