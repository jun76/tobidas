import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { PartBundle } from '../../parts/schema'
import { evaluatePartReference, type EvaluatedPartGraph } from '../../parts/evaluate'
import { pagePorts, type PaperFace } from '../../parts/geometry'
import { ContentMeshes } from '../../parts/ContentMeshes'
import { ClockStore } from '../../runtime/clock'
import type { BoundPaperContent } from '../../parts/geometry'
import { PaperMeshes } from '../../parts/PaperMeshes'
import { paperDisplayFaces } from '../../parts/paperDisplay'
import { useT } from '../i18n'
import st from './parts.module.css'
import { describePartEdit, planPartEdit, type PartEditIntent } from '../../parts/edit'
import { ConnectedPartGizmo } from '../viewport/PartGizmo'
import { draftEditScene, editPartNodeCommand } from './commands'
import { didGizmoPress, useGizmoPressReset } from '../viewport/gizmoInteraction'
import { usePartContentPlacementStore } from './contentPlacementState'
import { ContentSurfacePicker } from './ContentSurfacePicker'
import type { PlacementSurface } from '../../parts/placement'
import { ContentTransformGizmo } from '../viewport/ContentGizmo'
import { evaluateContents } from '../../parts/contents'
import { editContentValue } from '../../parts/contentEdit'
import { upsertPartContentCommand } from './contentCommands'
import type { PartContent } from '../../schema/content'

export function PartPreview({ bundle, selected, onSelect, editable = false }: { bundle: PartBundle; selected?: string; onSelect?: (id: string) => void; editable?: boolean }) {
  const t = useT().parts, input = bundle.definition.input
  const placement = usePartContentPlacementStore()
  useEffect(() => () => usePartContentPlacementStore.getState().cancel(), [])
  const reference = input.kind === 'fold-pair' ? input.referenceOpenAngleDeg ?? input.maxOpeningAngleDeg : 0
  const [angle, setAngle] = useState(reference), [limit, setLimit] = useState(reference), [playing, setPlaying] = useState(false)
  useEffect(() => { if (placement.kind) setPlaying(false) }, [placement.kind])
  const [view, setView] = useState(0), clock = useRef(0)
  const [holdTime, setHoldTime] = useState(0)
  const holdLimit = Math.max(10, ...bundle.definition.contents?.flatMap((content) => content.tracks.flatMap((track) => track.keys.map((key) => key.time))) ?? [])
  const [mode, setMode] = useState<'translate' | 'rotate' | 'scale'>('translate'), [angleId, setAngleId] = useState('')
  const [previewNodes, setPreviewNodes] = useState<PartBundle['definition']['nodes'] | null>(null), [editError, setEditError] = useState('')
  const [previewContents, setPreviewContents] = useState<PartContent[] | null>(null)
  const editingContent = useRef<PartContent | null>(null)
  const editing = useRef<{ source: PartBundle; intent?: PartEditIntent; last?: PartEditIntent } | null>(null)
  useGizmoPressReset()
  const scene = useMemo(() => draftEditScene(bundle), [bundle])
  const description = useMemo(() => { try { return selected ? describePartEdit(scene, selected) : null } catch { return null } }, [scene, selected])
  const cancel = () => { editing.current = null; setPreviewNodes(null); setPreviewContents(null); editingContent.current = null }
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
  const contentClocks = useMemo(() => new ClockStore(), [bundle.definition.id])
  const assets = useMemo(() => new Map(bundle.assets.map((asset) => [asset.id, asset])), [bundle.assets])
  const ports = pagePorts(8, 8, angle * Math.PI / 180, 0)
  const fixture = input.kind === 'fold-pair' ? ports.gutter : ports['right-page']
  const fixtureFaces = fixture.kind === 'fold-pair' ? [fixture.a, fixture.b] : [fixture.face]
  fixtureFaces.forEach((face) => { face.material = { color: '#f0e7d0' } })
  let faces: PaperFace[] = [], contents: BoundPaperContent[] = [], error = ''
  const surfaces: PlacementSurface[] = fixtureFaces.map((face, i) => ({ face, reference: { nodeId: '$input', portId: input.kind === 'surface' ? 'surface' : i === 0 ? 'a' : 'b' } }))
  try { const evaluated = evaluatePartReference({ custom: '__preview' }, fixture, { ...bundle.definitions, __preview: { ...bundle.definition, nodes: previewNodes ?? bundle.definition.nodes, contents: previewContents ?? bundle.definition.contents } }, {}, {}, 'preview') as EvaluatedPartGraph; faces = evaluated.faces; contents = evaluated.contents ?? []
    for (const [nodeId, node] of Object.entries(evaluated.nodes)) for (const face of node.faces) {
      const port = Object.entries(node.ports).find(([, port]) => port.kind === 'surface' && port.face.id === face.id)
      surfaces.push({ face, reference: { nodeId, portId: port?.[0] ?? 'face:' + face.id.slice(('preview/' + nodeId + '/').length) } })
    }
  }
  catch (caught) { error = caught instanceof Error ? caught.message : String(caught) }
  const contentSource = useMemo(() => {
    if (!selected?.startsWith('content:')) return undefined
    try { const result = evaluatePartReference({ custom: '__preview' }, fixture, { ...bundle.definitions, __preview: bundle.definition }, {}, {}, 'preview')
      return evaluateContents(result.contents ?? [], { openingAngleDeg: 180, maxOpeningAngleDeg: 180, holdTime: 0, clock: () => 0 }).find((item) => item.id === 'preview/content/' + selected.slice(8))
    } catch { return undefined }
  }, [bundle, selected, angle])
  return <section className={st.preview} aria-label={t.preview} data-tobidas-kind="part-preview" data-angle={angle}>
    <div className={st.canvas}>
      {placement.kind && <div className={st.placementBadge} role="status">{t.content[placement.kind]} · {t.pickFace(1, 1)} <button type="button" onClick={placement.cancel}>{t.pickCancel}</button>{placement.error && <p>{placement.error}</p>}</div>}
      <Canvas key={view} shadows camera={{ position: [10, 8, 12], fov: 42, near: .1, far: 100 }} gl={{ preserveDrawingBuffer: true }}>
        <color attach="background" args={['#d8c69e']} />
        <PreviewClock clocks={contentClocks} />
        {editable && placement.kind && <ContentSurfacePicker surfaces={surfaces} />}
        <ambientLight intensity={2.6} /><directionalLight position={[5, 10, 8]} intensity={1.8} castShadow shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-16} shadow-camera-right={16} shadow-camera-top={16} shadow-camera-bottom={-16}
          shadow-camera-near={.5} shadow-camera-far={50} shadow-bias={-.0002} shadow-normalBias={.025} />
        <PaperMeshes faces={fixtureFaces} assets={assets} />
        <PaperMeshes faces={paperDisplayFaces(faces)} assets={assets} selected={selected ? `preview/${selected}` : undefined}
          onSelect={onSelect ? (path) => { if (!didGizmoPress()) onSelect(path.split('/')[1]) } : undefined} />
        <ContentMeshes bindings={contents} assets={assets} clocks={contentClocks} clockPrefix={bundle.definition.id} context={{
          openingAngleDeg: input.kind === 'surface' ? 180 : angle, maxOpeningAngleDeg: input.kind === 'surface' ? 180 : limit, holdTime }}
          onSelect={onSelect ? (_, id) => { if (!didGizmoPress()) onSelect(id.startsWith('preview/content/') ? 'content:' + id.slice(16) : id.split('/')[1]) } : undefined} />
        {editable && contentSource && !playing && !placement.kind && <ContentTransformGizmo source={contentSource} mode={mode} error={editError}
          begin={() => { editingContent.current = null; setEditError('') }} preview={(intent) => {
            const content = structuredClone(bundle.definition.contents!.find((item) => item.element.id === selected!.slice(8))!)
            try { editContentValue(content.element, intent)
              const next = bundle.definition.contents!.map((item) => item.element.id === content.element.id ? content : item)
              const evaluated = evaluatePartReference({ custom: '__preview' }, fixture, { ...bundle.definitions, __preview: { ...bundle.definition, contents: next } }, {}, {}, 'preview')
              evaluateContents(evaluated.contents ?? [], { openingAngleDeg: 180, maxOpeningAngleDeg: 180, holdTime: 0, clock: () => 0 })
              editingContent.current = content; setPreviewContents(next); setEditError('') }
            catch (error) { setEditError(String(error)) }
          }} finish={() => { const content = editingContent.current; cancel(); if (!content) return false
            const result = upsertPartContentCommand({ content }); setEditError(result.ok ? '' : result.message); return result.ok }} cancel={cancel} />}
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
            if (!current || current.source !== bundle || !current.intent) return false
            const check = planPartEdit(scene, selected, current.intent)
            const intent = check.ok ? current.intent : current.last
            if (!intent) return false
            const result = editPartNodeCommand({ nodeId: selected, intent }); setEditError(result.ok ? '' : result.message); return result.ok
          }} cancel={cancel} />}
        <OrbitControls target={[2, 1, 0]} makeDefault />
      </Canvas>
    </div>
    {(error || editError) && <div className={st.previewError} role="status">{error || editError}</div>}
    <div className={st.previewControls}>
      {!!contents.length && <label>{t.content.time}<input type="range" aria-label={t.content.time} min={0} max={holdLimit} step={.05} value={holdTime} onChange={(event) => setHoldTime(Number(event.target.value))} /><output>{holdTime.toFixed(2)}s</output></label>}
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

function PreviewClock({ clocks }: { clocks: ClockStore }) {
  useFrame((_, delta) => clocks.advanceStory(delta), -2)
  return null
}
