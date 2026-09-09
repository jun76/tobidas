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
import { describePartEdit, planPartEdit, type PartEditIntent } from '../../parts/edit'
import { ConnectedPartGizmo } from '../viewport/PartGizmo'
import { draftEditScene, editPartNodeCommand } from './commands'
import { didGizmoPress, useGizmoPressReset } from '../viewport/gizmoInteraction'

export function PartPreview({ bundle, selected, onSelect, editable = false }: { bundle: PartBundle; selected?: string; onSelect?: (id: string) => void; editable?: boolean }) {
  const t = useT().parts, input = bundle.definition.input
  const reference = input.kind === 'fold-pair' ? input.referenceOpenAngleDeg ?? input.maxOpeningAngleDeg : 0
  const [angle, setAngle] = useState(reference), [limit, setLimit] = useState(reference), [playing, setPlaying] = useState(false)
  const [view, setView] = useState(0), clock = useRef(0)
  const [mode, setMode] = useState<'translate' | 'rotate' | 'scale'>('translate'), [angleId, setAngleId] = useState('')
  const [previewNodes, setPreviewNodes] = useState<PartBundle['definition']['nodes'] | null>(null), [editError, setEditError] = useState('')
  const editing = useRef<{ source: PartBundle; intent?: PartEditIntent; last?: PartEditIntent } | null>(null)
  useGizmoPressReset()
  const scene = useMemo(() => draftEditScene(bundle), [bundle])
  const description = useMemo(() => { try { return selected ? describePartEdit(scene, selected) : null } catch { return null } }, [scene, selected])
  const cancel = () => { editing.current = null; setPreviewNodes(null) }
  useEffect(() => { cancel(); setEditError('') }, [bundle, selected, angle, mode, playing])
  useEffect(() => {
    if (!editable) return
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable=true]')) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const mode = ({ w: 'translate', e: 'rotate', r: 'scale' } as const)[event.key.toLowerCase() as 'w' | 'e' | 'r']
      if (mode) { event.preventDefault(); setMode(mode) }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [editable])
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
  try { faces = evaluatePartReference({ custom: '__preview' }, fixture, { ...bundle.definitions, __preview: previewNodes ? { ...bundle.definition, nodes: previewNodes } : bundle.definition }, {}, {}, 'preview').faces }
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
          onSelect={onSelect ? (path) => { if (!didGizmoPress()) onSelect(path.split('/')[1]) } : undefined} />
        {editable && selected && description && !playing && Math.abs(angle - scene.maxAngle) < .001 && <ConnectedPartGizmo
          description={description} mode={mode} angleId={angleId} active={!!editing.current} invalid={!!editError}
          begin={() => { editing.current = { source: bundle }; setPreviewNodes(bundle.definition.nodes); setEditError('') }}
          preview={(intent) => {
            const current = editing.current
            if (!current || current.source !== bundle) return
            current.intent = intent
            const plan = planPartEdit(scene, selected, intent, false)
            if (plan.ok) { current.last = intent; setPreviewNodes(plan.nodes); setEditError('') } else setEditError(plan.detail)
          }} finish={() => {
            const current = editing.current; cancel()
            if (!current || current.source !== bundle || !current.intent) return
            const check = planPartEdit(scene, selected, current.intent)
            const intent = check.ok ? current.intent : current.last
            if (intent) { const result = editPartNodeCommand({ nodeId: selected, intent }); setEditError(result.ok ? '' : result.message) }
          }} cancel={cancel} />}
        <OrbitControls target={[2, 1, 0]} makeDefault />
      </Canvas>
    </div>
    {(error || editError) && <div className={st.previewError} role="status">{error || editError}</div>}
    <div className={st.previewControls}>
      {editable && selected && <>
        {(['translate', 'rotate', 'scale'] as const).map((m) => <button type="button" key={m} aria-pressed={m === mode}
          onClick={() => setMode(m)}>{m === 'translate' ? t.editing.move : m === 'rotate' ? t.editing.rotate : t.editing.scale}</button>)}
        {description && mode === 'rotate' && <select aria-label={t.editing.rotate} value={description.angles.some((a) => a.id === angleId) ? angleId : description.angles[0]?.id ?? ''}
          onChange={(event) => { cancel(); setAngleId(event.target.value) }}>{description.angles.map((a) => <option key={a.id} value={a.id}>{t.editing.labels[a.label as keyof typeof t.editing.labels] ?? a.label}</option>)}</select>}
        {description && mode === 'rotate' && <output>{description.angles.length
          ? `${(description.angles.find((a) => a.id === angleId) ?? description.angles[0]).value.toFixed(1)}°` : t.editing.noRotation}</output>}
      </>}
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
