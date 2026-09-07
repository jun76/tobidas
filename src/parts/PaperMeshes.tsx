import { useEffect, useMemo } from 'react'
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, Matrix4, FrontSide, BackSide, DoubleSide, SRGBColorSpace } from 'three'
import type { Asset } from '../schema/assets'
import { useImageTexture, useSvgTexture } from '../runtime/assets'
import type { PaperFace } from './geometry'
import { paperMeshData, type BookPaperSurface } from './paperDisplay'

export function PaperMeshes({ faces, assets, onSelect, selected, opacity = 1, paperSurfaces }: {
  faces: PaperFace[]; assets: Map<string, Asset>; onSelect?: (id: string) => void; selected?: string; opacity?: number
  paperSurfaces?: BookPaperSurface[]
}) {
  return <group>{faces.map((face) => <PaperMesh key={face.id} face={face} assets={assets} onSelect={onSelect}
    selected={selected !== undefined && (face.id === selected || face.id.startsWith(selected + '/'))} opacity={opacity} paperSurfaces={paperSurfaces} />)}</group>
}
function PaperMesh({ face, assets, onSelect, selected, opacity, paperSurfaces }: {
  face: PaperFace; assets: Map<string, Asset>; onSelect?: (id: string) => void; selected: boolean; opacity: number
  paperSurfaces?: BookPaperSurface[]
}) {
  const front = face.material.image ? assets.get(face.material.image) : undefined
  const back = face.material.backImage ? assets.get(face.material.backImage) : undefined
  const frontImage = useImageTexture(front?.type === 'image' ? front : undefined), frontSvg = useSvgTexture(front?.type === 'svg' ? front : undefined)
  const backImage = useImageTexture(back?.type === 'image' ? back : undefined), backSvg = useSvgTexture(back?.type === 'svg' ? back : undefined)
  const frontMap = frontImage?.texture ?? frontSvg?.texture, backMap = backImage?.texture ?? backSvg?.texture ?? frontMap
  const outline = JSON.stringify(face.outline ?? [[0, 0], [1, 0], [1, 1], [0, 1]])
  const clippingKey = paperSurfaces ? JSON.stringify([face.origin, face.u, face.v, paperSurfaces]) : ''
  const geometry = useMemo(() => {
    const data = paperMeshData(face, paperSurfaces)
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(data.positions, 3))
    g.setAttribute('uv', new Float32BufferAttribute(data.uvs, 2))
    g.computeVertexNormals()
    return g
  }, [outline, face.width, face.height, clippingKey])
  useEffect(() => () => geometry.dispose(), [geometry])
  const textTexture = useMemo(() => {
    if (!face.material.text) return undefined
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = Math.min(2048, Math.max(128, Math.round(1024 * face.height / face.width)))
    const context = canvas.getContext('2d')!
    const lines = face.material.text.split('\n'), size = Math.min(canvas.height / (lines.length + 1), 120)
    context.fillStyle = face.material.textColor ?? '#322719'
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = `bold ${size}px sans-serif`
    lines.forEach((line, i) => context.fillText(line, canvas.width / 2, canvas.height / 2 + (i - (lines.length - 1) / 2) * size * 1.2, 980))
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace
    return texture
  }, [face.material.text, face.material.textColor, face.width, face.height])
  useEffect(() => () => textTexture?.dispose(), [textTexture])
  const normal = face.u.clone().cross(face.v)
  const matrix = new Matrix4().makeBasis(face.u, face.v, normal).setPosition(face.origin)
  const properties = { color: frontMap ? '#ffffff' : face.material.color ?? '#e3b476', roughness: .9, transparent: true,
    opacity, alphaTest: .1, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -2 }
  return <group matrix={matrix} matrixAutoUpdate={false} onClick={(event) => { if (onSelect) { event.stopPropagation(); onSelect(face.id) } }}>
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial key={`front-${Boolean(frontMap)}`} {...properties} side={FrontSide} shadowSide={FrontSide} map={frontMap} />
    </mesh>
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial key={`back-${Boolean(backMap)}`} {...properties} side={BackSide} shadowSide={BackSide} map={backMap} />
    </mesh>
    {textTexture && <mesh geometry={geometry} renderOrder={2}><meshBasicMaterial map={textTexture} side={DoubleSide}
      transparent opacity={opacity} depthWrite={false} polygonOffset polygonOffsetFactor={0} polygonOffsetUnits={-4} /></mesh>}
    {selected && <mesh geometry={geometry} renderOrder={3}><meshBasicMaterial color="#7998ff" wireframe side={DoubleSide} depthTest={false} /></mesh>}
  </group>
}
