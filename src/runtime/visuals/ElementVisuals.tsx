import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Asset } from '../../schema/assets'
import type { StageElement, VisualElement } from '../../schema/stageElement'
import { useImageTexture, useSvgTexture, useVideoTexture, useVisualTexture } from '../assets'
import type { StowItem } from '../stow/model'
import { SPARKLE, buildSparkleField } from './sparkleField'
import { buildSparkleSpriteGeometry } from './sparkleGeometry'
import { VideoAudioSource } from '../videoAudio'

/**
 * 消えた部品は影も落とさない。
 *
 * 影のパスはテクスチャのalphaTestだけを見るため、材質の不透明度を0にしても
 * 影は残る。フェードアウトで見えなくしたつもりの部品が、ページを閉じるあいだ
 * 小口の外へ迂回して本の外に影だけを落とす、という形で表面化する。
 */
const castsShadow = (opacity: number): boolean => opacity > 0.01

interface VideoAudioWing {
  group: THREE.Group
  weight: number
}

/** 中央線で二分された同じ動画の左右片。音源を両片の面積中心へ置くため一時的に共有する。 */
const videoAudioWings = new Map<string, Partial<Record<'left' | 'right', VideoAudioWing>>>()

/**
 * layer ぶんの深度ずらし。同じ面に同じ位置で重ねた板の取り合いを断つ。
 *
 * 平坦時のリフト (stow/evaluate.ts の LAYER_LIFT) は寝かせ切ったときにしか効かず、
 * 開姿勢へ近づくほど隔たりが 0 へ戻る。だから重ね置きの2枚は開いている間は完全に
 * 一致していて、閉じ際の 0<f<1 だけ極小の隔たりを持って倒れていく。この区間で
 * 視線に対する前後が画素ごとに入れ替わり、閉じるあいだだけちらつく。
 *
 * 動かすのは深度テストの値だけで姿勢には触れないので、「t=1 は制作者の開姿勢へ
 * 厳密に一致」を破らない。傾き項 (factor) は板が視線と平行に近づくと際限なく
 * 効いてしまい、紙や隣の面との前後まで狂わせるので使わず、定数項だけで切る。
 * 共面の2枚は傾きが同一なので定数項だけで足りる。
 *
 * **これを紙面との前後の拠り所にしてはいけない**。polygonOffset は実装依存で
 * 丸ごと無視されることがある。headless Chromium の WebKit WebGL では -5000 単位を
 * 与えても寝た部品が紙へ埋もれたまま動かない。寝かせた部品を紙面より前に
 * 置いているのは `stow/evaluate.ts` の SURFACE_Y のリフトで、こちらは幾何なので
 * どの実装でも効く。ここは同じ場所に重ねた板どうしの取り合いを均すだけの補助で、
 * 層の順そのものは下の `renderOrder` (100 + layer) が持っている。
 */
export function layerDepthBias(layer: number) {
  return { polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -layer * 2 }
}

export function visualPivotOffset(element: StageElement): [number, number] {
  if (element.type === 'group') return [0, 0]
  return [(0.5 - element.pivot[0]) * element.width, (0.5 - element.pivot[1]) * element.height]
}

export function ElementVisual({ element, assets, opacityMul, openFactor = 1, instanceKey }: {
  element: StageElement
  assets: Map<string, Asset>
  opacityMul: number
  /** 収納の展開係数。0=紙面へ収納済み、1=制作者の開姿勢 */
  openFactor?: number
  instanceKey?: string
}) {
  if (element.type === 'group') return null
  return <>
    <VisualPlane element={element} asset={assetFor(assets, element.image)} back={assetFor(assets, element.backImage)}
      opacity={element.opacity * opacityMul} instanceKey={instanceKey ?? element.id} />
    {element.particles.enabled && <SparkleCloud seed={element.id}
      width={element.width * openFactor} height={element.height * openFactor} count={element.particles.count}
      color={element.particles.color} drift={element.particles.drift} period={element.particles.period}
      size={element.particles.size} opacity={element.opacity * opacityMul * openFactor}
      renderOrder={101 + element.layer} />}
  </>
}

// ---------------------------------------------------------------------------
// 光の欠片
// ---------------------------------------------------------------------------

/**
 * 揺れの寸法と粒の配置は sparkleField.ts が持つ。
 *
 * drei の Sparkles を使っていたときは、揺れが
 *   modelPosition.y += sin(time * speed + 位相) * 0.2
 * と modelMatrix の *後* に足されていた。0.2 は世界単位の固定値で、しかも
 * world space なので親の scale でも要素の size でも縮まない。外から効くのは
 * speed だけ = 同じ 0.2 の箱をゆっくり歩くようになるだけで、粒を大きくすると
 * 「ゆっくり飛び回る小バエ」にしかならなかった。振れ幅を持つために自前で描く。
 */
function buildSparkleGeometry(seed: string, width: number, height: number, count: number): THREE.BufferGeometry {
  return buildSparkleSpriteGeometry(buildSparkleField(seed, { width, height, count }))
}

/** 平面粒子のうち指定した横区間だけを、区間中心原点の実寸座標へ切り出す。 */
function buildSparkleSliceGeometry(seed: string, width: number, height: number, count: number, u0: number, u1: number): THREE.BufferGeometry {
  const field = buildSparkleField(seed, { width, height, count })
  const positions: number[] = []
  const phases: number[] = []
  const rates: number[] = []
  const centerX = ((u0 + u1) / 2 - 0.5) * width
  for (let index = 0; index < field.rates.length; index++) {
    const x = field.positions[index * 3]
    const u = x / Math.max(1e-6, width) + 0.5
    if (u < u0 || u > u1) continue
    positions.push(x - centerX, field.positions[index * 3 + 1], 0)
    phases.push(field.phases[index * 3], field.phases[index * 3 + 1], field.phases[index * 3 + 2])
    rates.push(field.rates[index])
  }
  return buildSparkleSpriteGeometry({
    positions: new Float32Array(positions),
    phases: new Float32Array(phases),
    rates: new Float32Array(rates),
  })
}

/**
 * 自前のシェーダなので、深度の書き方も自分で three に合わせる責任がある。
 *
 * 今は対数深度バッファを使っていない (view.ts の VIEW_GL) ので、以下のチャンクは
 * `#ifdef` で消える。将来有効にしたときに粒だけ壊れないよう残してある。
 *
 * `logarithmicDepthBuffer` を有効にすると、three の組み込み材質は
 * 深度を対数で書くよう `logdepthbuf` チャンクを差し込まれる。ここが線形のまま放っておくと
 * 同じ距離が違う値で表され、粒は深度検査で必ず負けて紙や板の裏へ全部隠れる。
 * `depthWrite: false` でも検査そのものは gl_FragDepth を見るので逃げられない。
 * 差し込み位置は決まっていて、頂点側は gl_Position を決めた後、断片側は main の頭。
 */
export class SparkleMaterial extends THREE.ShaderMaterial {
  constructor(drift = SPARKLE.drift, period = SPARKLE.period, particleSize = SPARKLE.size) {
    super({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        time: { value: 0 },
        drift: { value: drift },
        omega: { value: (Math.PI * 2) / period },
        particleSize: { value: particleSize },
        color: { value: new THREE.Color('#ffffff') },
        opacity: { value: 1 },
      },
      vertexShader: /* glsl */`
        uniform float time;
        uniform float drift;
        uniform float omega;
        uniform float particleSize;
        attribute vec3 phase;
        attribute float rate;
        attribute vec2 corner;
        varying vec2 circleUv;
        // logdepthbuf_vertex が呼ぶ isPerspectiveMatrix は common チャンクが持つ。
        // 落とすとリンクで転けて材質ごと描かれなくなる (粒が全部消える)
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vec3 local = position;
          float t = time * omega * rate;
          local.x += sin(t + phase.x) * drift;
          local.y += sin(t + phase.y) * drift;
          vec4 world = modelMatrix * vec4(local, 1.0);
          world.xyz += normalize(modelMatrix[0].xyz) * corner.x * particleSize;
          world.xyz += normalize(modelMatrix[1].xyz) * corner.y * particleSize;
          vec4 view = viewMatrix * world;
          gl_Position = projectionMatrix * view;
          circleUv = corner + 0.5;
          #include <logdepthbuf_vertex>
        }
      `,
      /**
       * 中心はべた塗り、外へ向かって暈。
       *
       * drei の 0.05/d - 0.1 は芯を持たないので、淡い色 (#ffe9a8) の粒を
       * 明るい紙の上へ置くと滲みにしか見えなかった。ホタルとして読ませるには
       * 「小さくても不透明な芯」が要る。
       */
      fragmentShader: /* glsl */`
        uniform vec3 color;
        uniform float opacity;
        varying vec2 circleUv;
        #include <logdepthbuf_pars_fragment>
        void main() {
          float d = distance(circleUv, vec2(0.5)) * 2.0;
          if (d > 1.0) discard;
          #include <logdepthbuf_fragment>
          float core = smoothstep(0.36, 0.20, d);
          float halo = 0.22 * pow(1.0 - d, 3.0);
          gl_FragColor = vec4(color, min(1.0, core + halo) * opacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
  }
}

function SparkleCloud({ seed, width, height, count, color, drift, period, size, opacity, renderOrder }: {
  seed: string
  width: number
  height: number
  count: number
  color: string
  drift: number
  period: number
  size: number
  opacity: number
  /**
   * 板と同じ帯 (100 + layer) へ並べる。
   *
   * 既定の0のままだと、粒は透明パスの先頭で描かれる。粒は深度を書かないので、
   * あとから描かれる板は距離に関係なく粒を塗り潰す。木より手前にある粒まで
   * 木の陰に隠れて見えなくなるのはこれが理由で、奥行きの問題ではない。
   */
  renderOrder: number
}) {
  const geometry = useMemo(() => buildSparkleGeometry(seed, width, height, count), [seed, width, height, count])
  return <SparklePoints geometry={geometry} color={color} opacity={opacity} renderOrder={renderOrder}
    drift={drift} period={period} size={size} />
}

function SparklePoints({ geometry, color, opacity, renderOrder, drift = SPARKLE.drift, period = SPARKLE.period, size = SPARKLE.size }: {
  geometry: THREE.BufferGeometry
  color: string
  opacity: number
  renderOrder: number
  drift?: number
  period?: number
  size?: number
}) {
  const material = useMemo(() => new SparkleMaterial(drift, period, size), [drift, period, size])
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])
  material.uniforms.color.value.set(color)
  material.uniforms.opacity.value = opacity
  useFrame((state) => { material.uniforms.time.value = state.clock.elapsedTime })
  if (opacity <= 0.01) return null
  return <mesh geometry={geometry} material={material} renderOrder={renderOrder} />
}

export function WingVisual({ element, half, assets, opacityMul, instanceKey, face }: {
  element: StageElement
  half: NonNullable<StowItem['half']>
  assets: Map<string, Asset>
  opacityMul: number
  instanceKey?: string
  face: 'left' | 'right'
}) {
  if (element.type === 'group') return null
  const audioKey = instanceKey ?? element.id
  const composite = useVisualTexture(element, assetFor(assets, element.image), audioKey)
  const group = useRef<THREE.Group>(null)
  const audioAnchor = useRef<THREE.Group>(null)
  const positions = useMemo(() => ({
    left: new THREE.Vector3(),
    right: new THREE.Vector3(),
    target: new THREE.Vector3(),
  }), [])

  useEffect(() => {
    const registeredGroup = group.current
    if (!registeredGroup) return
    const wings = videoAudioWings.get(audioKey) ?? {}
    wings[face] = { group: registeredGroup, weight: half.width }
    videoAudioWings.set(audioKey, wings)
    return () => {
      const registered = videoAudioWings.get(audioKey)
      if (registered?.[face]?.group === registeredGroup) delete registered[face]
      if (registered && !registered.left && !registered.right) videoAudioWings.delete(audioKey)
    }
  }, [audioKey, face, half.width])

  useFrame(() => {
    if (face !== 'left' || !audioAnchor.current) return
    const wings = videoAudioWings.get(audioKey)
    if (!wings?.left || !wings.right) {
      audioAnchor.current.position.set(0, 0, 0)
      return
    }
    wings.left.group.updateWorldMatrix(true, false)
    wings.right.group.updateWorldMatrix(true, false)
    wings.left.group.getWorldPosition(positions.left)
    wings.right.group.getWorldPosition(positions.right)
    const totalWeight = Math.max(1e-6, wings.left.weight + wings.right.weight)
    positions.target.copy(positions.left).multiplyScalar(wings.left.weight / totalWeight)
      .addScaledVector(positions.right, wings.right.weight / totalWeight)
    wings.left.group.worldToLocal(positions.target)
    audioAnchor.current.position.copy(positions.target)
  })

  const offsetY = (0.5 - element.pivot[1]) * element.height
  return <group ref={group} position={[0, offsetY, 0]}>
    {face === 'left' && <group ref={audioAnchor}>
      <VideoAudioSource video={composite?.video} settings={element.videoAudio} />
    </group>}
    {composite && <HalfPlane width={half.width} height={element.height} u0={half.u0} u1={half.u1}
      texture={composite.texture} opacity={element.opacity * opacityMul} layer={element.layer} />}
    {element.particles.enabled && <ParticleWing element={element} half={half} opacityMul={opacityMul} />}
  </group>
}

function ParticleWing({ element, half, opacityMul }: {
  element: VisualElement
  half: NonNullable<StowItem['half']>
  opacityMul: number
}) {
  const geometry = useMemo(() => buildSparkleSliceGeometry(
    element.id, element.width, element.height, element.particles.count, half.u0, half.u1,
  ), [element.id, element.width, element.height, element.particles.count, half.u0, half.u1])
  return <>
    <SparklePoints geometry={geometry} color={element.particles.color} opacity={element.opacity * opacityMul}
      renderOrder={101 + element.layer} drift={element.particles.drift}
      period={element.particles.period} size={element.particles.size} />
  </>
}

function HalfPlane({ width, height, u0, u1, texture, opacity, layer }: {
  width: number
  height: number
  u0: number
  u1: number
  texture?: THREE.Texture
  opacity: number
  layer: number
}) {
  const geometry = useMemo(() => {
    const plane = new THREE.PlaneGeometry(width, height)
    const uv = plane.attributes.uv as THREE.BufferAttribute
    for (let index = 0; index < uv.count; index++) uv.setX(index, u0 + uv.getX(index) * (u1 - u0))
    uv.needsUpdate = true
    return plane
  }, [width, height, u0, u1])
  useEffect(() => () => geometry.dispose(), [geometry])
  const bias = layerDepthBias(layer)
  return <mesh castShadow={castsShadow(opacity)} geometry={geometry} renderOrder={100 + layer}>
    {texture
      ? <meshBasicMaterial color="#ffffff" map={texture} transparent opacity={opacity} alphaTest={.02}
        side={THREE.DoubleSide} toneMapped={false} {...bias} />
      : <meshBasicMaterial color="#ff79a8" transparent opacity={opacity} side={THREE.DoubleSide} {...bias} />}
  </mesh>
}

export function AssetPlane({
  asset, back, width, height, opacity = 1, layer = 0, instanceKey,
  audio, backAudio, videoActive = true, backVideoActive = true,
}: {
  asset?: Asset
  back?: Asset
  width: number
  height: number
  opacity?: number
  layer?: number
  instanceKey?: string
  audio?: import('../../schema/audio').EmbeddedVideoAudio
  backAudio?: import('../../schema/audio').EmbeddedVideoAudio
  videoActive?: boolean
  backVideoActive?: boolean
}) {
  const image = useImageTexture(asset?.type === 'image' ? asset : undefined)
  const svg = useSvgTexture(asset?.type === 'svg' ? asset : undefined)
  const video = useVideoTexture(
    asset?.type === 'video' ? asset : undefined,
    `${instanceKey ?? 'surface'}:front`,
    videoActive,
  )
  const backImage = useImageTexture(back?.type === 'image' ? back : undefined)
  const backSvg = useSvgTexture(back?.type === 'svg' ? back : undefined)
  const backVideo = useVideoTexture(
    back?.type === 'video' ? back : undefined,
    `${instanceKey ?? 'surface'}:back`,
    backVideoActive,
  )
  const front = image ?? svg ?? video
  const reverse = backImage ?? backSvg ?? backVideo
  const bias = layerDepthBias(layer)
  return <mesh castShadow={castsShadow(opacity)} renderOrder={100 + layer}>
    <VideoAudioSource video={video?.video} settings={audio} />
    <VideoAudioSource video={backVideo?.video} settings={backAudio} />
    <planeGeometry args={[width, height]} />
    {front
      ? <meshBasicMaterial color="#ffffff" map={front.texture} transparent opacity={opacity} alphaTest={.02}
        side={reverse ? THREE.FrontSide : THREE.DoubleSide} toneMapped={false} {...bias} />
      : <meshBasicMaterial color="#ff79a8" transparent opacity={opacity} side={THREE.DoubleSide} {...bias} />}
    {reverse && <mesh position-z={-.002} rotation-y={Math.PI} renderOrder={100 + layer}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial color="#ffffff" map={reverse.texture} transparent opacity={opacity}
        alphaTest={.02} toneMapped={false} {...bias} />
    </mesh>}
  </mesh>
}

function VisualPlane({ element, asset, back, opacity, instanceKey }: {
  element: VisualElement
  asset?: Asset
  back?: Asset
  opacity: number
  instanceKey: string
}) {
  const front = useVisualTexture(element, asset, `${instanceKey}:front`)
  const backImage = useImageTexture(back?.type === 'image' ? back : undefined)
  const backSvg = useSvgTexture(back?.type === 'svg' ? back : undefined)
  const backVideo = useVideoTexture(back?.type === 'video' ? back : undefined, `${instanceKey}:back`)
  const reverse = backImage ?? backSvg ?? backVideo
  // 文字はページ面の遮蔽を深度バイアスで追い越さない。ページ送り中に
  // 綴じ目近くの文字だけが次の紙の上へ一瞬見えるため、紙との前後は実深度に任せる。
  const bias = element.text ? {} : layerDepthBias(element.layer)
  if (!front && !reverse) return null
  return <mesh castShadow={castsShadow(opacity)} renderOrder={100 + element.layer}>
    <VideoAudioSource video={front?.video} settings={element.videoAudio} />
    <VideoAudioSource video={backVideo?.video} settings={element.backVideoAudio} />
    <planeGeometry args={[element.width, element.height]} />
    <meshBasicMaterial color="#ffffff" map={front?.texture} transparent opacity={opacity}
      alphaTest={.02} side={reverse ? THREE.FrontSide : THREE.DoubleSide} toneMapped={false} {...bias} />
    {reverse && <mesh position-z={-.002} rotation-y={Math.PI}>
      <planeGeometry args={[element.width, element.height]} />
      <meshBasicMaterial color="#ffffff" map={reverse.texture} transparent opacity={opacity}
        alphaTest={.02} toneMapped={false} {...bias} />
    </mesh>}
  </mesh>
}

export function PaperSlab({
  position, size, color, edge, asset, back, backColor, instanceKey,
  audio, backAudio, videoActive = true, backVideoActive = true,
}: {
  position: [number, number, number]
  size: [number, number, number]
  color: string
  edge: string
  asset?: Asset
  back?: Asset
  backColor?: string
  instanceKey?: string
  audio?: import('../../schema/audio').EmbeddedVideoAudio
  backAudio?: import('../../schema/audio').EmbeddedVideoAudio
  videoActive?: boolean
  backVideoActive?: boolean
}) {
  return <group position={position}>
    <mesh castShadow receiveShadow><boxGeometry args={size} />
      <meshStandardMaterial color={edge} roughness={.94} /></mesh>
    <group position={[0, size[1] / 2 + .003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {asset
        ? <AssetPlane asset={asset} width={size[0]} height={size[2]} audio={audio}
          videoActive={videoActive}
          instanceKey={`${instanceKey ?? 'paper'}:front`} />
        : <mesh><planeGeometry args={[size[0], size[2]]} /><meshStandardMaterial color={color} /></mesh>}
    </group>
    {(back || backColor) && <group position={[0, -size[1] / 2 - .003, 0]} rotation={[Math.PI / 2, 0, Math.PI]}>
      {back
        ? <AssetPlane asset={back} width={size[0]} height={size[2]} audio={backAudio}
          videoActive={backVideoActive}
          instanceKey={`${instanceKey ?? 'paper'}:back`} />
        : <mesh><planeGeometry args={[size[0], size[2]]} /><meshStandardMaterial color={backColor} /></mesh>}
    </group>}
  </group>
}

export function assetFor(assets: Map<string, Asset>, id?: string): Asset | undefined {
  return id ? assets.get(id) : undefined
}
