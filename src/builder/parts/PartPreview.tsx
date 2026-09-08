import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { PartBundle } from '../../parts/schema'
import { evaluatePartReference } from '../../parts/evaluate'
import { pagePorts, type PaperFace } from '../../parts/geometry'
import { PaperMeshes } from '../../parts/PaperMeshes'
import { paperDisplayFaces } from '../../parts/paperDisplay'
import { useT } from '../i18n'
import st from './parts.module.css'

export function PartPreview({ bundle, selected, onSelect }: { bundle: PartBundle; selected?: string; onSelect?: (id: string) => void }) {
  const t = useT().parts, input = bundle.definition.input
  const reference = input.kind === 'fold-pair' ? input.referenceOpenAngleDeg ?? input.maxOpeningAngleDeg : 0
  const [angle, setAngle] = useState(reference), [limit, setLimit] = useState(reference), [playing, setPlaying] = useState(false)
  const [view, setView] = useState(0), clock = useRef(0)
  useEffect(() => { setAngle(reference); setLimit(reference); setPlaying(false) }, [bundle.definition.id, reference])
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = (now: number) => { if (!clock.current) clock.current = now
      setAngle(limit * (.5 + .5 * Math.cos((now - clock.current) / 1800))); frame = requestAnimationFrame(tick) }
    frame = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(frame); clock.current = 0 }
  }, [playing, limit])
  const assets = useMemo(() => new Map(bundle.assets.map((asset) => [asset.id, asset])), [bundle.assets])
  const ports = pagePorts(8, 8, angle * Math.PI / 180, 0)
  const fixture = input.kind === 'fold-pair' ? ports.gutter : ports['right-page']
  const fixtureFaces = fixture.kind === 'fold-pair' ? [fixture.a, fixture.b] : [fixture.face]
  fixtureFaces.forEach((face) => { face.material = { color: '#f0e7d0' } })
  let faces: PaperFace[] = [], error = ''
  try { faces = evaluatePartReference({ custom: '__preview' }, fixture, { ...bundle.definitions, __preview: bundle.definition }, {}, {}, 'preview').faces }
  catch (caught) { error = caught instanceof Error ? caught.message : String(caught) }
  return <section className={st.preview} aria-label={t.preview} data-tobidas-kind="part-preview" data-angle={angle}>
    <div className={st.canvas}>
      <Canvas key={view} shadows camera={{ position: [10, 8, 12], fov: 42, near: .1, far: 100 }} gl={{ preserveDrawingBuffer: true }}>
        <color attach="background" args={['#d8c69e']} />
        <ambientLight intensity={1.4} /><directionalLight position={[5, 10, 8]} intensity={2.5} castShadow shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-16} shadow-camera-right={16} shadow-camera-top={16} shadow-camera-bottom={-16}
          shadow-camera-near={.5} shadow-camera-far={50} shadow-bias={-.0002} shadow-normalBias={.025} />
        <PaperMeshes faces={fixtureFaces} assets={assets} />
        <PaperMeshes faces={paperDisplayFaces(faces)} assets={assets} selected={selected ? `preview/${selected}` : undefined}
          onSelect={onSelect ? (path) => onSelect(path.split('/')[1]) : undefined} />
        <OrbitControls target={[2, 1, 0]} makeDefault />
      </Canvas>
    </div>
    {error && <div className={st.previewError} role="status">{error}</div>}
    <div className={st.previewControls}>
      {input.kind === 'fold-pair' && <>
        <button type="button" onClick={() => setPlaying(!playing)}>{playing ? t.pause : t.play}</button>
        <label>{t.previewAngle}<input type="range" aria-label={t.previewAngle} min={0} max={limit} step={.1} value={angle}
          onChange={(event) => { setPlaying(false); setAngle(Number(event.target.value)) }} /><output>{angle.toFixed(1)}°</output></label>
        <label>{t.previewLimit}<select aria-label={t.previewLimit} value={limit} onChange={(event) => { const value = Number(event.target.value); setLimit(value); setAngle(value) }}>
          {[...new Set([90, 150, 180, reference])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{value}°</option>)}
        </select></label>
      </>}
      <button type="button" onClick={() => setView(view + 1)}>{t.fit}</button>
    </div>
  </section>
}
