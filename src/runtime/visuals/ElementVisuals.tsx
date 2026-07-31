import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Asset } from '../../schema/assets'
import type { StageElement } from '../../schema/stageElement'
import { useImageTexture, useSvgTexture, useTextTexture } from '../assets'
import type { StowItem } from '../stow/model'
import { SPARKLE, buildSparkleField } from './sparkleField'

/**
 * 消えた部品は影も落とさない。
 *
 * 影のパスはテクスチャのalphaTestだけを見るため、材質の不透明度を0にしても
 * 影は残る。フェードアウトで見えなくしたつもりの部品が、ページを閉じるあいだ
 * 小口の外へ迂回して本の外に影だけを落とす、という形で表面化する。
 */
const castsShadow = (opacity: number): boolean => opacity > 0.01

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
  if (element.type === 'group' || element.type === 'effect') return [0, 0]
  return [(0.5 - element.pivot[0]) * element.width, (0.5 - element.pivot[1]) * element.height]
}

export function ElementVisual({ element, assets, opacityMul, openFactor = 1 }: {
  element: StageElement
  assets: Map<string, Asset>
  opacityMul: number
  /** 収納の展開係数。0=紙面へ収納済み、1=制作者の開姿勢 */
  openFactor?: number
}) {
  if (element.type === 'group') return null
  if (element.type === 'effect') {
    /**
     * 雲の広がりは収納に従わせる。
     *
     * 収納が動かすのは要素の原点だけなので、広がりを持たせたままだと、
     * 紙面へ寝かせても粒は原点のまわり ±size/2 に散ったままになる。
     * 見開きが閉じてページが傾くと、その散らばりが紙の輪郭から外へ出て、
     * 本の外や隣の面の上に粒が浮いて見える。畳まれたら粒も畳む。
     */
    return <SparkleCloud seed={element.id} spread={element.size * openFactor} color={element.color}
      opacity={element.opacity * opacityMul * openFactor} renderOrder={100 + element.layer} />
  }
  if (element.type === 'text') {
    return <TextPlane element={element} layer={element.layer} opacityMul={element.opacity * opacityMul} />
  }
  return <AssetPlane asset={assetFor(assets, element.asset)} back={assetFor(assets, element.backAsset)}
    width={element.width} height={element.height} opacity={element.opacity * opacityMul}
    layer={element.layer} />
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
function buildSparkleGeometry(seed: string, spread: number): THREE.BufferGeometry {
  const field = buildSparkleField(seed, spread)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(field.positions, 3))
  geometry.setAttribute('phase', new THREE.BufferAttribute(field.phases, 3))
  geometry.setAttribute('rate', new THREE.BufferAttribute(field.rates, 1))
  return geometry
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
class SparkleMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      transparent: true,
      depthWrite: false,
      uniforms: {
        time: { value: 0 },
        pixelRatio: { value: 1 },
        drift: { value: SPARKLE.drift },
        omega: { value: (Math.PI * 2) / SPARKLE.period },
        pointSize: { value: SPARKLE.size },
        color: { value: new THREE.Color('#ffffff') },
        opacity: { value: 1 },
      },
      vertexShader: /* glsl */`
        uniform float time;
        uniform float pixelRatio;
        uniform float drift;
        uniform float omega;
        uniform float pointSize;
        attribute vec3 phase;
        attribute float rate;
        // logdepthbuf_vertex が呼ぶ isPerspectiveMatrix は common チャンクが持つ。
        // 落とすとリンクで転けて材質ごと描かれなくなる (粒が全部消える)
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          float t = time * omega * rate;
          world.x += sin(t + phase.x) * drift;
          world.y += sin(t + phase.y) * drift;
          world.z += cos(t + phase.z) * drift;
          vec4 view = viewMatrix * world;
          gl_Position = projectionMatrix * view;
          gl_PointSize = pointSize * 25.0 * pixelRatio / max(0.001, -view.z);
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
        #include <logdepthbuf_pars_fragment>
        void main() {
          float d = distance(gl_PointCoord, vec2(0.5)) * 2.0;
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

function SparkleCloud({ seed, spread, color, opacity, renderOrder }: {
  seed: string
  spread: number
  color: string
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
  const geometry = useMemo(() => buildSparkleGeometry(seed, spread), [seed, spread])
  const material = useMemo(() => new SparkleMaterial(), [])
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])
  const dpr = useThree((state) => state.viewport.dpr)
  material.uniforms.pixelRatio.value = dpr
  material.uniforms.color.value.set(color)
  material.uniforms.opacity.value = opacity
  useFrame((state) => { material.uniforms.time.value = state.clock.elapsedTime })
  if (opacity <= 0.01) return null
  return <points geometry={geometry} material={material} renderOrder={renderOrder} />
}

export function WingVisual({ element, half, assets, opacityMul }: {
  element: Extract<StageElement, { type: 'image' }>
  half: NonNullable<StowItem['half']>
  assets: Map<string, Asset>
  opacityMul: number
}) {
  const asset = assetFor(assets, element.asset)
  const image = useImageTexture(asset?.type === 'image' ? asset : undefined)
  const svg = useSvgTexture(asset?.type === 'svg' ? asset : undefined)
  const texture = (image ?? svg)?.texture
  const offsetY = (0.5 - element.pivot[1]) * element.height
  return <group position={[0, offsetY, 0]}>
    <HalfPlane width={half.width} height={element.height} u0={half.u0} u1={half.u1} texture={texture}
      opacity={element.opacity * opacityMul} layer={element.layer} />
  </group>
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

export function AssetPlane({ asset, back, width, height, opacity = 1, layer = 0 }: {
  asset?: Asset
  back?: Asset
  width: number
  height: number
  opacity?: number
  layer?: number
}) {
  const image = useImageTexture(asset?.type === 'image' ? asset : undefined)
  const svg = useSvgTexture(asset?.type === 'svg' ? asset : undefined)
  const backImage = useImageTexture(back?.type === 'image' ? back : undefined)
  const backSvg = useSvgTexture(back?.type === 'svg' ? back : undefined)
  const front = image ?? svg
  const reverse = backImage ?? backSvg
  const bias = layerDepthBias(layer)
  return <mesh castShadow={castsShadow(opacity)} renderOrder={100 + layer}>
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

function TextPlane({ element, layer, opacityMul }: {
  element: Extract<StageElement, { type: 'text' }>
  layer: number
  opacityMul: number
}) {
  const texture = useTextTexture({
    text: element.text, color: element.color, align: element.align,
    font: element.font, bold: element.bold, italic: element.italic, underline: element.underline,
  })
  return <mesh renderOrder={100 + layer}><planeGeometry args={[element.width, element.height]} />
    <meshBasicMaterial map={texture?.texture} transparent opacity={opacityMul} side={THREE.DoubleSide}
      {...layerDepthBias(layer)} /></mesh>
}

export function PaperSlab({ position, size, color, edge, asset, back, backColor }: {
  position: [number, number, number]
  size: [number, number, number]
  color: string
  edge: string
  asset?: Asset
  back?: Asset
  backColor?: string
}) {
  return <group position={position}>
    <mesh castShadow receiveShadow><boxGeometry args={size} />
      <meshStandardMaterial color={edge} roughness={.94} /></mesh>
    <group position={[0, size[1] / 2 + .003, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {asset
        ? <AssetPlane asset={asset} width={size[0]} height={size[2]} />
        : <mesh><planeGeometry args={[size[0], size[2]]} /><meshStandardMaterial color={color} /></mesh>}
    </group>
    {(back || backColor) && <group position={[0, -size[1] / 2 - .003, 0]} rotation={[Math.PI / 2, 0, Math.PI]}>
      {back
        ? <AssetPlane asset={back} width={size[0]} height={size[2]} />
        : <mesh><planeGeometry args={[size[0], size[2]]} /><meshStandardMaterial color={backColor} /></mesh>}
    </group>}
  </group>
}

export function assetFor(assets: Map<string, Asset>, id?: string): Asset | undefined {
  return id ? assets.get(id) : undefined
}
