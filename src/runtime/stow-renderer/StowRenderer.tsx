import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Asset } from '../../schema/assets'
import type { Spread } from '../../schema/book'
import type { StageElement } from '../../schema/stageElement'
import { useVisualTexture } from '../assets'
import { ClockStore } from '../clock'
import { evaluateContentMotion } from '../motion'
import { clamp01 } from '../signals'
import { airborneFade, evaluateChildPose, evaluateStow, evaluateVFoldSpan, stowIsDrawn, stowOpenFactor, type StowPose, type VFoldSpanPose } from '../stow/evaluate'
import type { PlanarElement, SpanningVFold, StowItem } from '../stow/model'
import { evaluateElementTimeline } from '../timeline/evaluate'
import type { BookRuntimeProps, RenderSpreadFrame } from '../types'
import { ElementVisual, SparkleMaterial, WingVisual, assetFor, layerDepthBias, visualPivotOffset } from '../visuals/ElementVisuals'
import { SPARKLE, buildSparkleField } from '../visuals/sparkleField'
import { buildSparkleSpriteGeometry } from '../visuals/sparkleGeometry'
import { VideoAudioSource } from '../videoAudio'

interface StowElementsProps {
  frame: RenderSpreadFrame
  side: 'left' | 'right'
  assets: Map<string, Asset>
  clocks: ClockStore
  isHidden?: BookRuntimeProps['isHidden']
  onSelect?: BookRuntimeProps['onSelect']
}

export function StowElements({ frame, side, assets, clocks, isHidden, onSelect }: StowElementsProps) {
  const all = side === 'left' ? frame.stow.left : frame.stow.right
  // 閉じ切りぎわは中身を描かない。呼び出し側が4か所あるので、ここで一度だけ切る
  const drawn = stowIsDrawn(frame.t)
  const items = isHidden ? all.filter((item) => !isHidden(frame.spread.id, item.element)) : all
  const childrenMap = useMemo(() => {
    const map = new Map<string, StageElement[]>()
    for (const element of frame.spread.elements) {
      if (element.parent.type !== 'element') continue
      map.set(element.parent.elementId, [...(map.get(element.parent.elementId) ?? []), element])
    }
    for (const list of map.values()) list.sort((a, b) => a.layer - b.layer)
    return map
  }, [frame.spread.elements])
  if (!drawn) return null
  return <>{items.map((item) => (
    <StowNode key={item.half ? `${item.element.id}:${item.face}` : item.element.id}
      item={item} childrenMap={childrenMap} assets={assets} clocks={clocks} t={frame.t} spread={frame.spread}
      spreadTime={frame.spreadTime} isHidden={isHidden} onSelect={onSelect} />
  ))}</>
}

interface StowNodeProps {
  item: StowItem
  childrenMap: Map<string, StageElement[]>
  assets: Map<string, Asset>
  clocks: ClockStore
  t: number
  spread: Spread
  spreadTime: number
  isHidden?: BookRuntimeProps['isHidden']
  onSelect?: BookRuntimeProps['onSelect']
}

function StowNode({ item, childrenMap, assets, clocks, t, spread, spreadTime, isHidden, onSelect }: StowNodeProps) {
  const ref = useRef<THREE.Group>(null)
  const element = evaluateElementTimeline(item.element, spread, spreadTime)
  const evaluatedItem = element === item.element ? item : { ...item, element }
  const spreadId = spread.id
  const clockKey = `${spreadId}:${element.id}`
  const poseFor = (time: number): StowPose =>
    evaluateStow(evaluatedItem, t, evaluateContentMotion(element.motion, time))

  useFrame((_, dt) => {
    if (!ref.current) return
    const time = element.clock === 'story-time' ? clocks.storyTime : clocks.advance(clockKey, dt)
    const pose = poseFor(time)
    ref.current.position.set(...pose.position)
    ref.current.rotation.set(...pose.rotationDeg.map(THREE.MathUtils.degToRad) as [number, number, number])
    ref.current.scale.set(...pose.scale)
  })

  if (!element.visible) return null
  const initial = poseFor(element.clock === 'story-time' ? clocks.storyTime : clocks.peek(clockKey))
  const facingStrength = stowOpenFactor(evaluatedItem, t)
  // 空中の部品の薄れ (AIRBORNE_FADE_DEG)。子は親と一緒に浮いているので同じ係数を継がせる
  const fade = airborneFade(item.mechanism, t)
  const [pivotX, pivotY] = visualPivotOffset(element)
  const visual = item.half
    ? <WingVisual element={element} half={item.half}
      assets={assets} opacityMul={initial.opacityMul} instanceKey={clockKey}
      face={item.face} />
    : <group position={[pivotX, pivotY, 0]}>
      <ElementVisual element={element} assets={assets} opacityMul={initial.opacityMul}
        openFactor={facingStrength} instanceKey={clockKey} />
    </group>
  return <group ref={ref} position={initial.position}
    rotation={initial.rotationDeg.map(THREE.MathUtils.degToRad) as [number, number, number]}
    scale={initial.scale}
    onClick={(event) => {
      event.stopPropagation()
      onSelect?.({ type: 'element', spreadId, elementId: element.id })
    }}>
    {element.type === 'visual' && element.billboard && !item.half
      ? <CameraFacing strength={facingStrength}>{visual}</CameraFacing>
      : visual}
    {!item.half && (childrenMap.get(element.id) ?? []).map((child) => (
      <ChildNode key={child.id} element={child} childrenMap={childrenMap} assets={assets} clocks={clocks}
        spread={spread} spreadTime={spreadTime} facingStrength={facingStrength} fade={fade}
        isHidden={isHidden} onSelect={onSelect} />
    ))}
  </group>
}

function ChildNode({ element: sourceElement, childrenMap, assets, clocks, spread, spreadTime, facingStrength, fade, isHidden, onSelect }: {
  element: StageElement
  childrenMap: Map<string, StageElement[]>
  assets: Map<string, Asset>
  clocks: ClockStore
  spread: Spread
  spreadTime: number
  facingStrength: number
  /** 親から継いだ不透明度係数。空中の部品は閉じ際に薄れるので子も一緒に薄れる */
  fade: number
  isHidden?: BookRuntimeProps['isHidden']
  onSelect?: BookRuntimeProps['onSelect']
}) {
  const ref = useRef<THREE.Group>(null)
  const element = evaluateElementTimeline(sourceElement, spread, spreadTime)
  const spreadId = spread.id
  const clockKey = `${spreadId}:${element.id}`
  // 子は親の原点からの隔たりも収納へ従う (evaluateChildPose)
  const poseFor = (time: number) =>
    evaluateChildPose(element.baseTransform, evaluateContentMotion(element.motion, time), facingStrength)

  useFrame((_, dt) => {
    if (!ref.current) return
    const time = element.clock === 'story-time' ? clocks.storyTime : clocks.advance(clockKey, dt)
    const pose = poseFor(time)
    ref.current.position.set(...pose.position)
    ref.current.rotation.set(...pose.rotationDeg.map(THREE.MathUtils.degToRad) as [number, number, number])
    ref.current.scale.set(...pose.scale)
  })
  if (!element.visible || isHidden?.(spreadId, element)) return null
  // 畳み切った子は親の原点へ重なった点でしかない。背表紙の上に軸を置いた
  // 軌道部品はここへ集まるので、残すと閉じ際に背表紙のきわで貫通して見える
  if (facingStrength <= 0) return null
  const initial = poseFor(element.clock === 'story-time' ? clocks.storyTime : clocks.peek(clockKey))
  const [pivotX, pivotY] = visualPivotOffset(element)
  const visual = <group position={[pivotX, pivotY, 0]}>
    <ElementVisual element={element} assets={assets} opacityMul={fade} openFactor={facingStrength}
      instanceKey={clockKey} />
  </group>
  return <group ref={ref} position={initial.position}
    rotation={initial.rotationDeg.map(THREE.MathUtils.degToRad) as [number, number, number]} scale={initial.scale}
    onClick={(event) => {
      event.stopPropagation()
      onSelect?.({ type: 'element', spreadId, elementId: element.id })
    }}>
    {element.type === 'visual' && element.billboard
      ? <CameraFacing strength={facingStrength}>{visual}</CameraFacing>
      : visual}
    {(childrenMap.get(element.id) ?? []).map((child) => (
      <ChildNode key={child.id} element={child} childrenMap={childrenMap} assets={assets} clocks={clocks}
        spread={spread} spreadTime={spreadTime} facingStrength={facingStrength} fade={fade}
        isHidden={isHidden} onSelect={onSelect} />
    ))}
  </group>
}

function CameraFacing({ strength, children }: { strength: number; children: React.ReactNode }) {
  const outer = useRef<THREE.Group>(null)
  const facing = useRef<THREE.Group>(null)
  const parentWorld = useMemo(() => new THREE.Quaternion(), [])
  const cameraWorld = useMemo(() => new THREE.Quaternion(), [])
  useFrame(({ camera }) => {
    if (!outer.current || !facing.current) return
    outer.current.updateWorldMatrix(true, false)
    outer.current.getWorldQuaternion(parentWorld)
    camera.getWorldQuaternion(cameraWorld)
    cameraWorld.premultiply(parentWorld.invert())
    facing.current.quaternion.identity().slerp(cameraWorld, clamp01(strength))
  })
  return <group ref={outer}><group ref={facing}>{children}</group></group>
}

interface SpanningVFoldNodeProps {
  span: SpanningVFold
  leftAngle: number
  rightAngle: number
  assets: Map<string, Asset>
  clocks: ClockStore
  spread: Spread
  spreadTime: number
  onSelect?: BookRuntimeProps['onSelect']
}

export function SpanningVFoldNode({ span, leftAngle, rightAngle, assets, clocks, spread, spreadTime, onSelect }: SpanningVFoldNodeProps) {
  const element = evaluateElementTimeline(span.element, spread, spreadTime) as PlanarElement
  const widthRatio = element.width * Math.abs(element.baseTransform.scale[0])
    / Math.max(0.01, span.element.width * Math.abs(span.element.baseTransform.scale[0]))
  const heightRatio = element.height * Math.abs(element.baseTransform.scale[1])
    / Math.max(0.01, span.element.height * Math.abs(span.element.baseTransform.scale[1]))
  const evaluatedSpan = element === span.element ? span : {
    ...span,
    element,
    widthLeft: span.widthLeft * widthRatio,
    widthRight: span.widthRight * widthRatio,
    height: span.height * heightRatio,
    baseY: element.baseTransform.position[1] - element.pivot[1] * span.height * heightRatio,
    baseZ: element.baseTransform.position[2],
    fitScale: Math.min(span.fitScale, span.fitScale / Math.max(1, widthRatio, heightRatio)),
  }
  const spreadId = spread.id
  const clockKey = `${spreadId}:${element.id}`
  const leftMesh = useRef<THREE.Mesh>(null)
  const rightMesh = useRef<THREE.Mesh>(null)
  const audioAnchor = useRef<THREE.Group>(null)
  const composite = useVisualTexture(element, assetFor(assets, element.image), clockKey)
  const texture = composite?.texture
  const geometryLeft = useMemo(() => spanWingGeometry(span.creaseU, 'left'), [span.creaseU])
  const geometryRight = useMemo(() => spanWingGeometry(span.creaseU, 'right'), [span.creaseU])
  useEffect(() => () => { geometryLeft.dispose(); geometryRight.dispose() }, [geometryLeft, geometryRight])
  const basis = useMemo(() => ({
    x: new THREE.Vector3(),
    y: new THREE.Vector3(),
    z: new THREE.Vector3(),
  }), [])
  const poseFor = (time: number): VFoldSpanPose =>
    evaluateVFoldSpan(evaluatedSpan, leftAngle, rightAngle, evaluateContentMotion(element.motion, time))

  const apply = (pose: VFoldSpanPose) => {
    const wings: Array<[THREE.Mesh | null, [number, number, number], number]> = [
      [leftMesh.current, pose.leftDir, evaluatedSpan.widthLeft],
      [rightMesh.current, pose.rightDir, evaluatedSpan.widthRight],
    ]
    for (const [mesh, direction, width] of wings) {
      if (!mesh) continue
      basis.x.set(...direction).multiplyScalar(width * pose.scaleMul)
      basis.y.set(...pose.creaseDir).multiplyScalar(evaluatedSpan.height * pose.scaleMul)
      basis.z.copy(basis.x).cross(basis.y)
      if (basis.z.lengthSq() < 1e-9) basis.z.set(0, 0, 1)
      else basis.z.normalize()
      mesh.matrix.makeBasis(basis.x, basis.y, basis.z)
      mesh.matrix.setPosition(...pose.origin)
      mesh.matrixWorldNeedsUpdate = true
      ;(mesh.material as THREE.MeshBasicMaterial).opacity = element.opacity * pose.opacityMul
    }
    if (audioAnchor.current) {
      const totalWidth = Math.max(1e-6, evaluatedSpan.widthLeft + evaluatedSpan.widthRight)
      audioAnchor.current.position.set(...pose.origin)
      basis.y.set(...pose.creaseDir)
      audioAnchor.current.position.addScaledVector(
        basis.y,
        evaluatedSpan.height * pose.scaleMul / 2,
      )
      basis.x.set(...pose.leftDir)
      audioAnchor.current.position.addScaledVector(
        basis.x,
        evaluatedSpan.widthLeft * evaluatedSpan.widthLeft * pose.scaleMul / (2 * totalWidth),
      )
      basis.x.set(...pose.rightDir)
      audioAnchor.current.position.addScaledVector(
        basis.x,
        evaluatedSpan.widthRight * evaluatedSpan.widthRight * pose.scaleMul / (2 * totalWidth),
      )
    }
  }

  useFrame((_, dt) => {
    const time = element.clock === 'story-time' ? clocks.storyTime : clocks.advance(clockKey, dt)
    apply(poseFor(time))
  })
  useEffect(() => {
    apply(poseFor(element.clock === 'story-time' ? clocks.storyTime : clocks.peek(clockKey)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftAngle, rightAngle, span])

  if (!element.visible) return null
  const select = (event: { stopPropagation: () => void }) => {
    event.stopPropagation()
    onSelect?.({ type: 'element', spreadId, elementId: element.id })
  }
  const bias = layerDepthBias(element.layer)
  const material = texture
    ? <meshBasicMaterial color="#ffffff" map={texture} transparent opacity={element.opacity}
      alphaTest={.02} side={THREE.DoubleSide} toneMapped={false} {...bias} />
    : null
  return <>
    <group ref={audioAnchor}>
      <VideoAudioSource video={composite?.video} settings={element.videoAudio} />
    </group>
    {material && <mesh ref={leftMesh} geometry={geometryLeft} matrixAutoUpdate={false} castShadow
      renderOrder={100 + element.layer} onClick={select}>{material}</mesh>
    }
    {material && <mesh ref={rightMesh} geometry={geometryRight} matrixAutoUpdate={false} castShadow
      renderOrder={100 + element.layer} onClick={select}>{material}</mesh>}
    {element.particles.enabled && <SpanningParticleNode span={evaluatedSpan} leftAngle={leftAngle} rightAngle={rightAngle}
      clocks={clocks} clockKey={`${clockKey}:particles`} element={element} spreadId={spreadId} onSelect={onSelect} />}
  </>
}

function SpanningParticleNode({ span, leftAngle, rightAngle, clocks, clockKey, element, spreadId, onSelect }: {
  span: SpanningVFold
  leftAngle: number
  rightAngle: number
  clocks: ClockStore
  clockKey: string
  element: PlanarElement
  spreadId: string
  onSelect?: BookRuntimeProps['onSelect']
}) {
  const left = useRef<THREE.Mesh>(null)
  const right = useRef<THREE.Mesh>(null)
  const geometries = useMemo(() => ({
    left: spanParticleGeometry(element, span.creaseU, 'left'),
    right: spanParticleGeometry(element, span.creaseU, 'right'),
  }), [element.id, element.width, element.height, element.particles.count, span.creaseU])
  const driftScale = element.particles.drift / Math.max(1, span.widthLeft, span.widthRight, span.height)
  const materials = useMemo(() => ({
    left: new SparkleMaterial(driftScale, element.particles.period, element.particles.size),
    right: new SparkleMaterial(driftScale, element.particles.period, element.particles.size),
  }), [driftScale, element.particles.period, element.particles.size])
  useEffect(() => () => {
    geometries.left.dispose(); geometries.right.dispose()
    materials.left.dispose(); materials.right.dispose()
  }, [geometries, materials])
  const basis = useMemo(() => ({ x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() }), [])
  const apply = (pose: VFoldSpanPose) => {
    const wings: Array<[THREE.Mesh | null, [number, number, number], number, SparkleMaterial]> = [
      [left.current, pose.leftDir, span.widthLeft, materials.left],
      [right.current, pose.rightDir, span.widthRight, materials.right],
    ]
    for (const [points, direction, width, material] of wings) {
      if (!points) continue
      basis.x.set(...direction).multiplyScalar(width * pose.scaleMul)
      basis.y.set(...pose.creaseDir).multiplyScalar(span.height * pose.scaleMul)
      basis.z.copy(basis.x).cross(basis.y).normalize()
      points.matrix.makeBasis(basis.x, basis.y, basis.z)
      points.matrix.setPosition(...pose.origin)
      points.matrixWorldNeedsUpdate = true
      material.uniforms.color.value.set(element.particles.color)
      material.uniforms.opacity.value = element.opacity * pose.opacityMul
    }
  }
  const poseFor = (time: number) =>
    evaluateVFoldSpan(span, leftAngle, rightAngle, evaluateContentMotion(element.motion, time))
  useFrame((state, dt) => {
    const time = element.clock === 'story-time' ? clocks.storyTime : clocks.advance(clockKey, dt)
    materials.left.uniforms.time.value = state.clock.elapsedTime
    materials.right.uniforms.time.value = state.clock.elapsedTime
    apply(poseFor(time))
  })
  useEffect(() => {
    apply(poseFor(element.clock === 'story-time' ? clocks.storyTime : clocks.peek(clockKey)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftAngle, rightAngle, span])
  const select = (event: { stopPropagation: () => void }) => {
    event.stopPropagation()
    onSelect?.({ type: 'element', spreadId, elementId: element.id })
  }
  return <>
    <mesh ref={left} geometry={geometries.left} material={materials.left} matrixAutoUpdate={false}
      renderOrder={100 + element.layer} onClick={select} />
    <mesh ref={right} geometry={geometries.right} material={materials.right} matrixAutoUpdate={false}
      renderOrder={100 + element.layer} onClick={select} />
  </>
}

function spanParticleGeometry(element: PlanarElement, creaseU: number, side: 'left' | 'right') {
  const field = buildSparkleField(element.id, { width: element.width, height: element.height, count: element.particles.count })
  const positions: number[] = []
  const phases: number[] = []
  const rates: number[] = []
  for (let index = 0; index < field.rates.length; index++) {
    const u = field.positions[index * 3] / Math.max(1e-6, element.width) + 0.5
    if (side === 'left' ? u > creaseU : u < creaseU) continue
    positions.push(
      side === 'left' ? (creaseU - u) / Math.max(1e-6, creaseU) : (u - creaseU) / Math.max(1e-6, 1 - creaseU),
      field.positions[index * 3 + 1] / Math.max(1e-6, element.height) + 0.5,
      0,
    )
    phases.push(field.phases[index * 3], field.phases[index * 3 + 1], field.phases[index * 3 + 2])
    rates.push(field.rates[index])
  }
  return buildSparkleSpriteGeometry({
    positions: new Float32Array(positions),
    phases: new Float32Array(phases),
    rates: new Float32Array(rates),
  })
}

function spanWingGeometry(creaseU: number, side: 'left' | 'right'): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  const outerU = side === 'left' ? 0 : 1
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([creaseU, 0, outerU, 0, outerU, 1, creaseU, 1], 2))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  return geometry
}
