import { useEffect, useMemo } from 'react'
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, Matrix4, FrontSide, BackSide, DoubleSide, SRGBColorSpace } from 'three'
import type { Asset } from '../schema/assets'
import { useImageTexture, useSvgTexture } from '../runtime/assets'
import { paperMeshData, type BookPaperSurface, type DisplayPaperFace } from './paperDisplay'

export function PaperMeshes({ faces, assets, onSelect, selected, opacity = 1, paperSurfaces, surfaceTarget, hideSupports = false }: {
  faces: DisplayPaperFace[]; assets: Map<string, Asset>; onSelect?: (id: string) => void; selected?: string; opacity?: number
  paperSurfaces?: BookPaperSurface[]
  surfaceTarget?: { spreadId: string; nodeId: string }
  /** 支持紙を透明にする (作品の表示設定)。評価や接着はそのままで、描画と影だけを外す */
  hideSupports?: boolean
}) {
  // 論理ページを延長した支持紙は見えない紙面の一部なので描かない
  return <group>{faces.filter((face) => !face.hidden && !(hideSupports && face.support)).map((face) => <PaperMesh key={face.id} face={face} assets={assets} onSelect={onSelect}
    selected={selected !== undefined && (face.id === selected || face.id.startsWith(selected + '/'))} opacity={opacity} paperSurfaces={paperSurfaces} surfaceTarget={surfaceTarget} />)}</group>
}
function PaperMesh({ face, assets, onSelect, selected, opacity, paperSurfaces, surfaceTarget }: {
  face: DisplayPaperFace; assets: Map<string, Asset>; onSelect?: (id: string) => void; selected: boolean; opacity: number
  paperSurfaces?: BookPaperSurface[]
  surfaceTarget?: { spreadId: string; nodeId: string }
}) {
  const front = face.material.image ? assets.get(face.material.image) : undefined
  const back = face.material.backImage ? assets.get(face.material.backImage) : undefined
  const frontImage = useImageTexture(front?.type === 'image' ? front : undefined), frontSvg = useSvgTexture(front?.type === 'svg' ? front : undefined)
  const backImage = useImageTexture(back?.type === 'image' ? back : undefined), backSvg = useSvgTexture(back?.type === 'svg' ? back : undefined)
  const frontMap = frontImage?.texture ?? frontSvg?.texture, backMap = backImage?.texture ?? backSvg?.texture ?? frontMap
  const outline = JSON.stringify(face.shape ?? face.outline ?? [[0, 0], [1, 0], [1, 1], [0, 1]])
  const [artworkStart, artworkEnd] = face.artworkSpan ?? [0, 1]
  const clippingKey = paperSurfaces ? JSON.stringify([face.origin, face.u, face.v, paperSurfaces]) : ''
  const geometry = useMemo(() => {
    const data = paperMeshData(face, paperSurfaces)
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(data.positions, 3))
    g.setAttribute('uv', new Float32BufferAttribute(data.uvs, 2))
    g.computeVertexNormals()
    return g
  }, [outline, face.width, face.height, clippingKey, artworkStart, artworkEnd])
  useEffect(() => () => geometry.dispose(), [geometry])
  const textTexture = useMemo(() => {
    if (!face.material.text) return undefined
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = Math.min(2048, Math.max(128, Math.round(1024 * face.height / face.width * (artworkEnd - artworkStart))))
    const context = canvas.getContext('2d')!
    const lines = face.material.text.split('\n'), size = Math.min(canvas.height / (lines.length + 1), 120)
    context.fillStyle = face.material.textColor ?? '#322719'
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = `bold ${size}px sans-serif`
    lines.forEach((line, i) => context.fillText(line, canvas.width / 2, canvas.height / 2 + (i - (lines.length - 1) / 2) * size * 1.2, 980))
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace
    return texture
  }, [face.material.text, face.material.textColor, face.width, face.height, artworkStart, artworkEnd])
  useEffect(() => () => textTexture?.dispose(), [textTexture])
  const normal = face.u.clone().cross(face.v)
  const renderOrder = face.renderOrder ?? 100
  // 透明な紙: 画像も文字もなければ描かず影も落とさない。選択・面クリックのためにメッシュ自体は残す
  const invisible = Boolean(face.material.transparent) && !frontMap && !backMap && !textTexture
  const matrix = new Matrix4().makeBasis(face.u, face.v, normal).setPosition(face.origin)
  // 絵柄に映画用の色調圧縮を重ねず、拡散照明と実際の影で紙の明暗を付ける。
  const properties = { color: frontMap ? '#ffffff' : face.material.color ?? '#e3b476', roughness: .9, transparent: true, toneMapped: false,
    opacity: invisible ? 0 : opacity, colorWrite: !invisible, depthWrite: !invisible, alphaTest: .1, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 }
  // 絵を貼った紙は絵の透明部分を紙色で埋めない。見える紙は印刷の不透明部分だけにする。
  return <group matrix={matrix} matrixAutoUpdate={false} onClick={(event) => { if (onSelect) { event.stopPropagation(); onSelect(face.id) } }}>
    <mesh geometry={geometry} renderOrder={renderOrder} castShadow={!invisible} receiveShadow={!invisible} userData={surfaceTarget ? { partSurfaceTarget: { ...surfaceTarget, faceId: face.id } } : {}}>
      <meshStandardMaterial key={`front-${Boolean(frontMap)}-${invisible}`} {...properties} side={FrontSide} shadowSide={FrontSide} map={frontMap} />
    </mesh>
    <mesh geometry={geometry} renderOrder={renderOrder} castShadow={!invisible} receiveShadow={!invisible} userData={surfaceTarget ? { partSurfaceTarget: { ...surfaceTarget, faceId: face.id } } : {}}>
      <meshStandardMaterial key={`back-${Boolean(backMap)}-${invisible}`} {...properties} side={BackSide} shadowSide={BackSide} map={backMap} />
    </mesh>
    {textTexture && <mesh geometry={geometry} renderOrder={renderOrder + 1}><meshBasicMaterial map={textTexture} side={DoubleSide}
      transparent opacity={opacity} toneMapped={false} depthWrite={false} polygonOffset polygonOffsetFactor={0} polygonOffsetUnits={-4} /></mesh>}
    {selected && <mesh geometry={geometry} renderOrder={10000}><meshBasicMaterial color="#7998ff" wireframe side={DoubleSide} depthTest={false} /></mesh>}
  </group>
}
