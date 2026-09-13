import { createRoot } from 'react-dom/client'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { DoubleSide, Vector3 } from 'three'
import { ContentMeshes } from '../../src/parts/ContentMeshes'
import { makeFace, type BoundPaperContent } from '../../src/parts/geometry'
import { createStageElement } from '../../src/schema/bookDefaults'
import { connectedContentSchema } from '../../src/schema/content'
import { ClockStore } from '../../src/runtime/clock'

// 本番と同じ描画部品で、共面の画像と粒子、手前の遮蔽物を比較する。
const face = makeFace('paper', new Vector3(-2, -2, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 4, 4)
const bind = (id: string, type: 'visual' | 'particle', layer: number): BoundPaperContent => ({
  id, ownerId: id, face, tracks: [], unitScale: 1,
  element: connectedContentSchema.parse({ ...createStageElement(type), id, layer, width: type === 'visual' ? 4 : 2, height: type === 'visual' ? 4 : 2,
    pivot: [.5, .5], backgroundColor: '#163d2fff',
    baseTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    attachment: { type: 'surface', surface: { nodeId: 'paper', portId: 'face' }, point: [2, 2], side: 'front' },
    presentation: { kind: 'fiction', closing: 'shrink-to-anchor' },
    particles: { enabled: false, color: '#ffffff', count: 12, size: .5, drift: .05, period: 11 },
  }),
})
const bindings = [bind('image', 'visual', 1), bind('light', 'particle', 2)]
const clocks = new ClockStore(); clocks.sampleTime = 0
const state = { occluded: false, ready: false }
function Scene() {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    Object.assign(window, { depthFixture: { state, async sample(occluded: boolean, time: number, x: number) {
      state.occluded = occluded; clocks.sampleTime = time
      scene.getObjectByName('occluder')!.visible = occluded
      camera.position.set(x, 1, 8); camera.lookAt(0, 0, 0); camera.updateMatrixWorld()
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      gl.render(scene, camera)
      const pixels = new Uint8Array(512 * 512 * 4)
      gl.getContext().readPixels(0, 0, 512, 512, gl.getContext().RGBA, gl.getContext().UNSIGNED_BYTE, pixels)
      let bright = 0
      for (let i = 0; i < pixels.length; i += 4) if (Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 200) bright++
      return bright
    } } })
    state.ready = true
  }, [gl, scene, camera])
  return <>
    <ContentMeshes bindings={bindings} context={{ openingAngleDeg: 180, maxOpeningAngleDeg: 180, holdTime: 0 }} assets={new Map()} clocks={clocks} clockPrefix="depth-test" />
    <mesh name="occluder" position={[0, 0, .2]} visible={false}>
      <planeGeometry args={[4, 4]} /><meshBasicMaterial color="#24120f" side={DoubleSide} toneMapped={false} />
    </mesh>
  </>
}
createRoot(document.getElementById('root')!).render(<Canvas dpr={1} gl={{ logarithmicDepthBuffer: true, preserveDrawingBuffer: true }} camera={{ position: [0, 1, 8], fov: 35 }}><Scene /></Canvas>)
