import { useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { BookProject } from '../../schema/bookPackage'
import type { PartInstance } from '../../parts/schema'
import type { PartElement } from '../../schema/stageElement'
import { createStageElement } from '../../schema/bookDefaults'
import { evaluateBookParts, deployBookParts, validateBookParts } from '../../parts/book'
import { PaperMeshes } from '../../parts/PaperMeshes'
import { paperDisplayFaces } from '../../parts/paperDisplay'
import { pagePorts, type PaperFace } from '../../parts/geometry'
import { useT } from '../i18n'
import st from './parts.module.css'

/** 確定前も、作品の実接続先を使って開閉を評価する。下書きは履歴へ入れない。 */
export function PlacementPreview({ project, spreadId, instance, elementId }: { project: BookProject; spreadId: string; instance: PartInstance; elementId?: string }) {
  const t = useT().parts, [angle, setAngle] = useState(180)
  const candidate = useMemo(() => {
    const next = { ...project, book: { ...project.book, spreads: project.book.spreads.map((spread) => spread.id !== spreadId ? spread : { ...spread,
      elements: [...spread.elements.filter((element) => element.id !== elementId), { ...createStageElement('part'), id: elementId ?? 'placement-preview', part: instance } as PartElement] }) } }
    return next
  }, [project, spreadId, instance, elementId])
  const errors = useMemo(() => validateBookParts(candidate), [candidate])
  const spread = candidate.book.spreads.find((item) => item.id === spreadId)!, width = project.book.format.pageWidth
  const ports = pagePorts(width, width / project.book.format.pageAspect, Math.PI, Math.PI - angle * Math.PI / 180)
  const paper = ports.gutter.kind === 'fold-pair' ? [ports.gutter.a, ports.gutter.b] : []
  for (const face of paper) face.material = { color: '#e8dec9' }
  let faces: PaperFace[] = []
  try {
    const right = Math.PI - angle * Math.PI / 180
    faces = deployBookParts(candidate, spread, evaluateBookParts(candidate, spread, Math.PI, right), Math.PI, right).faces
  } catch { /* 検査結果をプレビューの下に表示する。 */ }
  const assets = useMemo(() => new Map(project.assets.map((asset) => [asset.id, asset])), [project.assets])
  return <section aria-label={t.preview} className={st.placementPreview}>
    <div style={{ height: 240 }}><Canvas camera={{ position: [width * .7, width, width * 1.5], fov: 44 }}>
      <color attach="background" args={['#cbbd9f']} /><ambientLight intensity={2.6} /><directionalLight position={[4, 10, 8]} intensity={1.8} />
      <PaperMeshes faces={paper} assets={assets} /><PaperMeshes faces={paperDisplayFaces(faces)} assets={assets} />
      <OrbitControls target={[0, .5, 0]} />
    </Canvas></div>
    <label>{t.previewAngle}<input aria-label={t.previewAngle} type="range" min={0} max={180} step={1} value={angle} onChange={(event) => setAngle(Number(event.target.value))} />{angle}°</label>
    {errors.length > 0 && <p className={st.error} role="status">{errors[0]}</p>}
  </section>
}
