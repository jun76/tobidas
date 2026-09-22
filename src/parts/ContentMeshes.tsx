import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BackSide, BufferGeometry, CanvasTexture, DoubleSide, FrontSide, Group, Mesh, MeshBasicMaterial } from 'three'
import type { Asset } from '../schema/assets'
import type { ConnectedContent } from '../schema/content'
import type { VisualElement } from '../schema/stageElement'
import { useVisualTexture, useImageTexture, useSvgTexture, useVideoTexture } from '../runtime/assets'
import { ClockStore } from '../runtime/clock'
import { VideoAudioSource } from '../runtime/videoAudio'
import { contentAsStage, evaluateContents, type ContentContext, type EvaluatedContent } from './contents'
import { contentMeshData } from './contentDisplay'
import { updateContentGeometry } from './contentGeometry'
import type { BoundPaperContent } from './geometry'
import type { BookPaperSurface } from './paperDisplay'

export function ContentMeshes({ bindings, context, assets, clocks, clockPrefix, surfaces = [], onSelect }: {
  bindings: BoundPaperContent[]; context: Omit<ContentContext, 'clock'>; assets: Map<string, Asset>; clocks: ClockStore
  clockPrefix: string; playing?: boolean; surfaces?: BookPaperSurface[]; onSelect?: (id: string, contentId: string) => void
}) {
  const camera = useThree((state) => state.camera)
  // 同じlayerでは作品内の後の要素を手前へ描く。不可視の間も順番を確保し、フェードで入れ替えない。
  const sorted = [...bindings].sort((a, b) => a.element.layer - b.element.layer)
  const orders = new Map(sorted.map((item, index) => [item.id, index]))
  // 同じ面に重ねた印刷の順位。透明な紙では印刷が深度を書くので、後の印刷ほど手前へ寄せて重なりを描画順どおりに保つ
  const stacks = new Map<string, number>(), perFace = new Map<string, number>()
  for (const item of sorted) if (item.face && item.element.presentation.kind === 'decal') { const n = perFace.get(item.face.id) ?? 0; stacks.set(item.id, n); perFace.set(item.face.id, n + 1) }
  const evaluate = () => evaluateContents(bindings, { ...context, billboardQuaternion: camera.quaternion, clock: (id, mode) => mode === 'story-time' ? clocks.storyTime : clocks.peek(`${clockPrefix}/${id}`) })
  const snapshots = useRef(new Map<string, EvaluatedContent>())
  const initial = evaluate(); snapshots.current = new Map(initial.map((item) => [item.id, item]))
  useFrame((_, delta) => {
    // ページ送りの停止と表示中の周期運動は別の時計。旧Content Clockの意味を保つ。
    for (const bound of bindings) if (snapshots.current.get(bound.id)?.visible) clocks.advance(`${clockPrefix}/${bound.id}`, delta)
    snapshots.current = new Map(evaluate().map((item) => [item.id, item]))
  }, -1)
  return <group>{initial.map((item) => <ContentMesh key={item.id} initial={item} current={() => snapshots.current.get(item.id) ?? item}
    assets={assets} surfaces={surfaces} order={orders.get(item.id)!} stack={stacks.get(item.id) ?? 0} onSelect={onSelect} />)}</group>
}
const artworkKey = (element: ConnectedContent) => element.type !== 'visual' ? '' : JSON.stringify([
  element.image, element.backImage, element.text, element.fontSize, element.font, element.bold, element.italic, element.underline,
  element.align, element.width, element.height, element.foregroundColor, element.backgroundColor,
])
/** 紙自体を描かない面に貼られているか。その面では印刷が紙の役割 (深度と影) を引き受ける */
const onBarePaper = (item: EvaluatedContent) => Boolean(item.face?.material.transparent && !item.face.material.image && !item.face.material.backImage && !item.face.material.text)

function ContentMesh({ initial, current, assets, surfaces, order: index, stack, onSelect }: {
  initial: EvaluatedContent; current: () => EvaluatedContent; assets: Map<string, Asset>; surfaces: BookPaperSurface[]; order: number; stack: number; onSelect?: (id: string, contentId: string) => void
}) {
  const [art, setArt] = useState(initial.element), lastArt = useRef(artworkKey(art)), group = useRef<Group>(null), audioRoot = useRef<Group>(null)
  const visual = art.type === 'visual' ? contentAsStage(art) as VisualElement : undefined
  const front = useVisualTexture(visual, visual?.image ? assets.get(visual.image) : undefined, initial.id)
  const backAsset = visual?.backImage ? assets.get(visual.backImage) : undefined
  const backImage = useImageTexture(backAsset?.type === 'image' ? backAsset : undefined), backSvg = useSvgTexture(backAsset?.type === 'svg' ? backAsset : undefined)
  const backVideo = useVideoTexture(backAsset?.type === 'video' ? backAsset : undefined, initial.id + ':back')
  const back = backImage?.texture ?? backSvg?.texture ?? backVideo?.texture
  const geometries = useMemo(() => [new BufferGeometry(), new BufferGeometry()], [])
  const meshes = useRef<(Mesh | null)[]>([]), sparkle = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64
    const ctx = canvas.getContext('2d')!, fill = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    fill.addColorStop(0, '#ffffffff'); fill.addColorStop(.35, '#ffffffff'); fill.addColorStop(1, '#ffffff00')
    ctx.fillStyle = fill; ctx.fillRect(0, 0, 64, 64); return new CanvasTexture(canvas)
  }, [])
  useEffect(() => () => { geometries.forEach((g) => g.dispose()); sparkle.dispose() }, [geometries, sparkle])
  const update = () => {
    const item = current(), element = item.element
    if (group.current) group.current.visible = item.visible
    if (audioRoot.current) audioRoot.current.position.setFromMatrixPosition(item.matrix)
    const key = artworkKey(element)
    if (key !== lastArt.current) { lastArt.current = key; setArt(element) }
    if (!item.visible || element.type === 'group') return
    const hasParticles = element.type === 'particle' || element.particles.enabled
    for (let i = 0; i < 2; i++) {
      const data = (i === 0 && element.type !== 'visual') || (i === 1 && !hasParticles) ? { positions: [], uvs: [] } : contentMeshData(item, surfaces, i === 1)
      updateContentGeometry(geometries[i], data)
    }
    for (const mesh of meshes.current) if (mesh) {
      const material = mesh.material as MeshBasicMaterial
      material.opacity = item.opacity
      // 透明な紙に貼った印刷は、紙の代わりに影を落とす (紙自体は影を落とさない)
      mesh.castShadow = element.type === 'visual' && item.opacity > .01 && (element.presentation.kind === 'fiction' || onBarePaper(item))
    }
    const particleMesh = meshes.current[2]
    if (particleMesh) { (particleMesh.material as MeshBasicMaterial).color.set(element.particles.color); particleMesh.castShadow = false }
  }
  useLayoutEffect(update)
  useFrame(update)
  if (art.type === 'group') return null
  const decal = art.presentation.kind === 'decal', order = 1000 + index * 2
  // 印刷は実紙の深度で遮蔽し、インク同士は描画順で合成する。
  // 独立して動く画像は深度を書き、同一平面の重なりだけを層ごとの定数補正で安定させる。
  // 透明な紙に貼った印刷は紙が深度を書かないので、印刷自身が紙の代わりに深度を書く (alphaTest で絵の形だけ)。
  // 同じ面に重ねた印刷は同一平面で深度が一致せず互いに欠けるため、重ねる順に少しずつ手前へ寄せる。
  // 斜めから見た面では補間誤差が傾きに比例して増えるので、定数 (units) だけでなく傾き比例 (factor) も重ねる。
  const bare = decal && onBarePaper(initial)
  const depth = { depthWrite: !decal || bare, polygonOffset: true, polygonOffsetFactor: bare ? -stack : 0, polygonOffsetUnits: bare ? -4 - stack * 4 : decal ? -4 : -4 - index * 4 }
  return <group ref={group} onClick={(event) => { if (onSelect) { event.stopPropagation(); onSelect(initial.ownerId, initial.id) } }}>
    <group ref={audioRoot}><VideoAudioSource video={front?.video} settings={visual?.videoAudio} active={initial.visible} />
      <VideoAudioSource video={backVideo?.video} settings={visual?.backVideoAudio} active={initial.visible} /></group>
    {art.type === 'visual' && <mesh ref={(mesh) => { meshes.current[0] = mesh }} geometry={geometries[0]} renderOrder={order} frustumCulled={false}>
      <meshBasicMaterial key={Boolean(front?.texture) ? 'textured' : 'plain'} map={front?.texture} color="#ffffff" side={decal || back ? FrontSide : DoubleSide} transparent opacity={initial.opacity} alphaTest={.02} toneMapped={false}
        {...depth} />
    </mesh>}
    {back && <mesh ref={(mesh) => { meshes.current[1] = mesh }} geometry={geometries[0]} renderOrder={order} frustumCulled={false}>
      <meshBasicMaterial map={back} side={BackSide} transparent opacity={initial.opacity} alphaTest={.02} toneMapped={false} {...depth} />
    </mesh>}
    <mesh ref={(mesh) => { meshes.current[2] = mesh }} geometry={geometries[1]} renderOrder={order + 1} frustumCulled={false}>
      <meshBasicMaterial map={sparkle} side={DoubleSide} transparent opacity={initial.opacity} {...depth} depthWrite={false}
        polygonOffsetUnits={depth.polygonOffsetUnits - 2} alphaTest={.01} toneMapped={false} />
    </mesh>
  </group>
}
