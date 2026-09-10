import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Plane, Raycaster, RepeatWrapping, Vector2, Vector3 } from 'three'
import { faceContains, type PaperFace } from '../../parts/geometry'
import { paperMeshData } from '../../parts/paperDisplay'
import type { PartSurfaceRef } from '../../parts/schema'
import { PagePointerMarker } from '../viewport/PageDropController'
import { newConnectedContent, upsertPartContentCommand } from './contentCommands'
import { usePartContentPlacementStore } from './contentPlacementState'
import { usePartEditorStore } from './store'

export function ContentSurfacePicker({ surfaces }: { surfaces: { reference: PartSurfaceRef; face: PaperFace }[] }) {
  const { camera, gl } = useThree(), kind = usePartContentPlacementStore((state) => state.kind)
  const hover = useRef<Mesh>(null), marker = useRef<Group>(null)
  const hatch = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ffffff55'; ctx.fillRect(0, 0, 32, 32)
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3
    for (let x = -32; x <= 32; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 32, 32); ctx.stroke() }
    const texture = new CanvasTexture(canvas); texture.wrapS = texture.wrapT = RepeatWrapping; texture.repeat.set(10, 10); return texture
  }, [])
  useEffect(() => () => hatch.dispose(), [hatch])
  useEffect(() => {
    if (!kind) return
    const canvas = gl.domElement, ray = new Raycaster(), plane = new Plane()
    const geometries = surfaces.map(({ face }) => {
      const data = paperMeshData(face), geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3)); geometry.setAttribute('uv', new Float32BufferAttribute(data.uvs, 2)); return geometry
    })
    const hitAt = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      ray.setFromCamera(new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera)
      return surfaces.flatMap((surface, index) => {
        const { face } = surface, normal = face.u.clone().cross(face.v)
        const point = ray.ray.intersectPlane(plane.setFromNormalAndCoplanarPoint(normal, face.origin), new Vector3())
        if (!point || !faceContains(face, point)) return []
        const delta = point.clone().sub(face.origin)
        return [{ ...surface, index, normal, point, side: normal.dot(ray.ray.direction) < 0 ? 'front' as const : 'back' as const,
          material: [delta.dot(face.u), delta.dot(face.v)] as [number, number], distance: ray.ray.origin.distanceTo(point) }]
      }).sort((a, b) => a.distance - b.distance)[0]
    }
    const move = (event: PointerEvent) => {
      const hit = hitAt(event)
      if (hover.current) hover.current.visible = !!hit
      if (marker.current) marker.current.visible = !!hit
      if (!hit) return
      if (hover.current) { hover.current.geometry = geometries[hit.index]
        hover.current.matrix.copy(new Matrix4().makeBasis(hit.face.u, hit.face.v, hit.normal).setPosition(hit.face.origin.clone().addScaledVector(hit.normal, hit.side === 'front' ? .015 : -.015)))
        ;(hover.current.material as MeshBasicMaterial).color.set('#529dff') }
      marker.current?.position.copy(hit.point.clone().addScaledVector(hit.normal, hit.side === 'front' ? .025 : -.025))
    }
    let down: [number, number] | undefined
    const press = (event: PointerEvent) => { if (!event.button) { down = [event.clientX, event.clientY]; event.stopPropagation() } }
    const release = (event: PointerEvent) => {
      if (event.button || !down) return
      event.stopPropagation(); canvas.addEventListener('click', (e) => e.stopPropagation(), { capture: true, once: true })
      const moved = Math.hypot(event.clientX - down[0], event.clientY - down[1]); down = undefined
      if (moved > 5) return
      const hit = hitAt(event); if (!hit) return
      const element = newConnectedContent(kind, { type: 'surface', surface: hit.reference, point: hit.material, side: hit.side })
      const result = upsertPartContentCommand({ content: { element, tracks: [] } })
      if (result.ok) { usePartEditorStore.getState().select('content:' + element.id); usePartContentPlacementStore.getState().cancel() }
      else { usePartContentPlacementStore.setState({ error: result.message }); if (hover.current) (hover.current.material as MeshBasicMaterial).color.set('#ff5260') }
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') usePartContentPlacementStore.getState().cancel() }
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerdown', press, true); canvas.addEventListener('pointerup', release, true); window.addEventListener('keydown', key)
    return () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerdown', press, true); canvas.removeEventListener('pointerup', release, true); window.removeEventListener('keydown', key)
      geometries.forEach((geometry) => geometry.dispose()); if (hover.current) hover.current.visible = false; if (marker.current) marker.current.visible = false }
  }, [kind, surfaces, camera, gl])
  return <><PagePointerMarker markerRef={marker} /><mesh ref={hover} matrixAutoUpdate={false} visible={false} renderOrder={10000} raycast={() => {}}>
    <bufferGeometry /><meshBasicMaterial map={hatch} side={DoubleSide} transparent opacity={.8} depthWrite={false} />
  </mesh></>
}
