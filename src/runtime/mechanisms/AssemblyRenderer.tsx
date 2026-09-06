import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Book, Spread } from '../../schema/book'
import type { Asset } from '../../schema/assets'
import type { BookRuntimeProps } from '../types'
import type { ClockStore } from '../clock'
import { useImageTexture, useSvgTexture } from '../assets'
import { assetFor, ElementVisual, visualPivotOffset } from '../visuals/ElementVisuals'
import { evaluateAssemblyScene, type AssemblyScene, type AssemblySurfaceInstance, type AssemblyVisualInstance } from './scene'

export function AssemblyRenderer({ book, spread, open, leftAngle, rightAngle, spreadTime, assets, clocks, isHidden, onSelect }: {
  book: Book; spread: Spread; open: number; leftAngle: number; rightAngle: number; spreadTime: number
  assets: Map<string, Asset>; clocks: ClockStore
  isHidden?: BookRuntimeProps['isHidden']; onSelect?: BookRuntimeProps['onSelect']
}) {
  const evaluate = () => evaluateAssemblyScene(book, spread, { open, leftAngle, rightAngle, spreadTime,
    clock: clocks.storyTime, isHidden: isHidden ? (element) => isHidden(spread.id, element) : undefined })
  const initial = evaluate()
  const current = useRef<AssemblyScene>(initial)
  current.current = initial
  // 子のメッシュ更新より先に全体を一度だけ評価する。
  useFrame(() => { current.current = evaluate() }, -1)
  return <group>{initial.surfaces.map((entry) => <SurfaceMesh key={entry.key} initial={entry} current={current}
    assets={assets} onSelect={() => onSelect?.({ type: 'element', spreadId: spread.id, elementId: entry.elementId })} />)}
    {initial.visuals.map((entry) => <AttachedVisual key={entry.key} initial={entry} current={current} assets={assets}
      onSelect={() => onSelect?.({ type: 'element', spreadId: spread.id, elementId: entry.element.id })} />)}
  </group>
}

function SurfaceMesh({ initial, current, assets, onSelect }: {
  initial: AssemblySurfaceInstance; current: MutableRefObject<AssemblyScene>; assets: Map<string, Asset>; onSelect: () => void
}) {
  const group = useRef<THREE.Group>(null)
  const frontMesh = useRef<THREE.Mesh>(null)
  const backMesh = useRef<THREE.Mesh>(null)
  const frontMaterial = useRef<THREE.MeshStandardMaterial>(null)
  const backMaterial = useRef<THREE.MeshStandardMaterial>(null)
  const textMaterial = useRef<THREE.MeshBasicMaterial>(null)
  const frontAsset = assetFor(assets, initial.material.image)
  const backAsset = assetFor(assets, initial.material.backImage)
  const frontImage = useImageTexture(frontAsset?.type === 'image' ? frontAsset : undefined)
  const frontSvg = useSvgTexture(frontAsset?.type === 'svg' ? frontAsset : undefined)
  const backImage = useImageTexture(backAsset?.type === 'image' ? backAsset : undefined)
  const backSvg = useSvgTexture(backAsset?.type === 'svg' ? backAsset : undefined)
  const frontMap = frontImage?.texture ?? frontSvg?.texture
  const backMap = backImage?.texture ?? backSvg?.texture ?? frontMap
  // 非同期に画像が届いたとき、mapの有無で変わるシェーダを再コンパイルする。
  useEffect(() => {
    if (frontMaterial.current) frontMaterial.current.needsUpdate = true
    if (backMaterial.current) backMaterial.current.needsUpdate = true
  }, [frontMap, backMap])
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(initial.surface.positions, 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(initial.surface.textureUvs ?? initial.surface.uvs, 2))
    g.setIndex(initial.surface.indices)
    g.computeVertexNormals()
    return g
  }, [initial.key, initial.surface.positions.length, initial.surface.indices.length])
  useEffect(() => () => geometry.dispose(), [geometry])
  // 胴の画像は一周連続、面のラベルは面ごとのUVで描く。
  const labelGeometry = useMemo(() => {
    if (!initial.material.text) return undefined
    const g = geometry.clone()
    g.setAttribute('uv', new THREE.Float32BufferAttribute(initial.surface.uvs, 2))
    return g
  }, [geometry, initial.material.text])
  useEffect(() => () => labelGeometry?.dispose(), [labelGeometry])
  const textTexture = useMemo(() => {
    if (!initial.material.text) return undefined
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256
    const context = canvas.getContext('2d')!
    context.fillStyle = '#322719'; context.textAlign = 'center'; context.textBaseline = 'middle'
    context.font = 'bold 42px sans-serif'
    context.fillText(initial.material.text, 256, 128, 480)
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }, [initial.material.text])
  useEffect(() => () => textTexture?.dispose(), [textTexture])
  useFrame(() => {
    const next = current.current.surfaces.find((candidate) => candidate.key === initial.key)
    if (!group.current) return
    group.current.visible = !!next
    if (!next) return
    group.current.matrix.copy(next.matrix); group.current.matrixWorldNeedsUpdate = true
    for (const target of [geometry, labelGeometry]) {
      if (!target) continue
      const position = target.getAttribute('position') as THREE.BufferAttribute
      position.set(next.surface.positions); position.needsUpdate = true
      target.computeVertexNormals(); target.computeBoundingSphere()
    }
    if (frontMaterial.current) frontMaterial.current.opacity = next.opacity
    if (backMaterial.current) backMaterial.current.opacity = next.opacity
    if (textMaterial.current) textMaterial.current.opacity = next.opacity
    if (frontMesh.current) frontMesh.current.castShadow = next.opacity > .01
    if (backMesh.current) backMesh.current.castShadow = next.opacity > .01
  })
  return <group ref={group} matrix={initial.matrix} matrixAutoUpdate={false} onClick={(event) => { event.stopPropagation(); onSelect() }}>
    <mesh ref={frontMesh} geometry={geometry} castShadow={initial.opacity > .01} receiveShadow>
      <meshStandardMaterial ref={frontMaterial} map={frontMap} color={initial.material.color} roughness={.9}
        side={THREE.FrontSide} transparent opacity={initial.opacity} alphaTest={.1} />
    </mesh>
    <mesh ref={backMesh} geometry={geometry} castShadow={initial.opacity > .01} receiveShadow>
      <meshStandardMaterial ref={backMaterial} map={backMap} color={initial.material.color} roughness={.95}
        side={THREE.BackSide} transparent opacity={initial.opacity} alphaTest={.1} />
    </mesh>
    {textTexture && <mesh geometry={labelGeometry} renderOrder={10}>
      <meshBasicMaterial ref={textMaterial} map={textTexture} transparent opacity={initial.opacity} side={THREE.DoubleSide}
        depthWrite={false} polygonOffset polygonOffsetFactor={0} polygonOffsetUnits={-2} />
    </mesh>}
  </group>
}

function AttachedVisual({ initial, current, assets, onSelect }: {
  initial: AssemblyVisualInstance; current: MutableRefObject<AssemblyScene>; assets: Map<string, Asset>; onSelect: () => void
}) {
  const group = useRef<THREE.Group>(null)
  useFrame(() => {
    const next = current.current.visuals.find((candidate) => candidate.key === initial.key)
    if (!group.current) return
    group.current.visible = !!next
    if (next) { group.current.matrix.copy(next.matrix); group.current.matrixWorldNeedsUpdate = true }
  })
  const [x, y] = visualPivotOffset(initial.element)
  return <group ref={group} matrix={initial.matrix} matrixAutoUpdate={false} onClick={(event) => { event.stopPropagation(); onSelect() }}>
    <group position={[x, y, 0]}><ElementVisual element={initial.element} assets={assets}
      opacityMul={initial.opacity} openFactor={1} instanceKey={initial.key} /></group>
  </group>
}
