import { useMemo, useState } from 'react'
import type { Asset } from '../../schema/assets'
import type { ContentAttachment, ConnectedContent, PartContent } from '../../schema/content'
import type { PartSurfaceRef } from '../../parts/schema'
import type { PaperShape } from '../../parts/shape'
import { rectangleShape } from '../../parts/shape'
import { placementSurfaces } from '../../parts/placement'
import { useT } from '../i18n'
import { useBuilderStore } from '../store'
import { usePartEditorStore } from './store'
import { newConnectedContent, upsertPartContentCommand, deletePartContentCommand, editConnectedContentCommand } from './contentCommands'
import { TextField, NumberField, MaterialFields, referencePorts } from './fields'
import { DISCRETE_PROPERTIES, NUMBER_PROPERTIES, type TimelineProperty } from '../../schema/timeline'
import st from './parts.module.css'
import { usePartContentPlacementStore } from './contentPlacementState'

type SurfaceOption = { reference: PartSurfaceRef; label: string }
export function AttachmentFields({ value, options, onChange }: { value: ContentAttachment; options: SurfaceOption[]; onChange: (value: ContentAttachment) => void }) {
  const t = useT().parts.content
  if (value.type === 'visual') return <TextField label={t.surface} value={value.elementId} onChange={(elementId) => onChange({ type: 'visual', elementId })} />
  return <div className={st.fields}>
    <label className={st.field}><span>{t.surface}</span><select aria-label={t.surface} value={JSON.stringify(value.surface)} onChange={(event) => onChange({ ...value, surface: JSON.parse(event.target.value) })}>
      {options.map(({ reference, label }) => <option key={JSON.stringify(reference)} value={JSON.stringify(reference)}>{label}</option>)}
    </select></label>
    <label className={st.field}><span>{t.side}</span><select aria-label={t.side} value={value.side} onChange={(event) => onChange({ ...value, side: event.target.value as 'front' | 'back' })}>
      <option value="front">{t.front}</option><option value="back">{t.back}</option>
    </select></label>
    {([0, 1] as const).map((axis) => <NumberField key={axis} label={`${t.anchor} ${axis === 0 ? 'X' : 'Y'}`} value={value.point[axis]} onChange={(number) => { const point: [number, number] = [...value.point]; point[axis] = number; onChange({ ...value, point }) }} />)}
  </div>
}
export function ContentAttachmentFields({ spreadId, elementId }: { spreadId: string; elementId: string }) {
  const store = useBuilderStore(), t = useT().parts.content, [error, setError] = useState('')
  const spread = store.project.book.spreads.find((item) => item.id === spreadId)!, element = spread.elements.find((item) => item.id === elementId)!
  const options = useMemo(() => placementSurfaces(store.project, spread).map(({ reference }) => ({ reference,
    label: `${reference.nodeId === '$book' ? '' : spread.elements.find((item) => item.id === reference.nodeId)?.name ?? reference.nodeId} / ${reference.portId}` })), [store.project, spread])
  if (!element.attachment) return null
  return <section className={st.section} data-tobidas-kind="content-attachment"><h3>{t.title}</h3>
    <AttachmentFields value={element.attachment} options={options} onChange={(value) => { const result = editConnectedContentCommand({ spreadId, elementId, intent: { type: 'attachment', value } }); setError(result.ok ? '' : result.message) }} />
    <p className={st.hint}>{t.hint}</p>{error && <p role="status" className={st.error}>{error}</p>}
  </section>
}
export function ShapeFields({ faceIds, shapes, onChange }: { faceIds: string[]; shapes?: Record<string, PaperShape>; onChange: (face: string, shape: PaperShape | null) => void }) {
  const t = useT().parts, [selected, setSelected] = useState(faceIds[0] ?? ''), [error, setError] = useState('')
  const face = faceIds.includes(selected) ? selected : faceIds[0], shape = shapes?.[face] ?? rectangleShape()
  const format = (points: [number, number][]) => points.map((point) => point.join(', ')).join('\n')
  const parse = (value: string): [number, number][] => value.trim().split(/\n+/).map((row) => {
    const values = row.split(/[,\s]+/).map(Number)
    if (values.length !== 2 || values.some((n) => !Number.isFinite(n))) throw new Error(t.outlineHint)
    return values as [number, number]
  })
  return <details className={st.section}><summary>{t.content.shape}</summary><p className={st.hint}>{t.content.shapeHint}</p>
    <select aria-label={t.material} value={face} onChange={(event) => setSelected(event.target.value)}>{faceIds.map((id) => <option key={id}>{id}</option>)}</select>
    <TextField label={t.outline} multiline value={format(shape.outer)} onChange={(value) => { try { onChange(face, { ...shape, outer: parse(value) }); setError('') } catch (e) { setError(String(e)) } }} />
    <TextField label={t.content.holes} multiline value={shape.holes.map(format).join('\n\n')} onChange={(value) => { try { onChange(face, { ...shape, holes: value.trim() ? value.trim().split(/\n\s*\n/).map(parse) : [] }); setError('') } catch (e) { setError(String(e)) } }} />
    <button type="button" onClick={() => onChange(face, null)}>{t.remove}</button>{error && <p role="status">{error}</p>}
  </details>
}
export function PartContentEditor({ open = false }: { open?: boolean } = {}) {
  const store = usePartEditorStore(), { bundle } = store, t = useT().parts
  const selected = store.selectedId?.startsWith('content:') ? store.selectedId.slice(8) : ''
  const setSelected = (id: string) => store.select(id ? 'content:' + id : null)
  const [error, setError] = useState('')
  const options: SurfaceOption[] = [
    ...(bundle.definition.input.kind === 'surface' ? ['surface'] : ['a', 'b']).map((portId) => ({ reference: { nodeId: '$input', portId }, label: `${t.input} / ${portId}` })),
    ...bundle.definition.nodes.flatMap((node) => referencePorts(node.definition, bundle.definitions).filter((port) => port.kind === 'surface').map((port) => ({ reference: { nodeId: node.id, portId: port.name }, label: `${node.name} / ${port.name}` }))),
  ]
  const current = bundle.definition.contents?.find((item) => item.element.id === selected)
  const update = (content: PartContent) => { const result = upsertPartContentCommand({ content }); setError(result.ok ? '' : result.message) }
  return <details className={st.section} data-tobidas-kind="part-contents" open={open || !!current || undefined}><summary>{t.content.contents}</summary>
    <div className={`${st.fields} ${st.contentPicker}`}>
      <div className={st.field}><span>{t.content.add}</span>
        <div className={st.buttons}>{(['decal', 'fiction', 'particle'] as const).map((kind) => <button key={kind} type="button" onClick={() => {
          usePartContentPlacementStore.getState().start(kind)
        }}>{t.content[kind]}</button>)}</div>
      </div>
      <label className={st.field}><span>{t.content.editTarget}</span>
        <select aria-label={t.content.contents} value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">{t.choose}</option>
          {bundle.definition.contents?.map(({ element }) => <option key={element.id} value={element.id}>{element.name}</option>)}
        </select>
      </label>
    </div>
    {current && <>
      <ContentValueFields value={current.element} options={options} assets={bundle.assets} onChange={(element) => update({ ...current, element })} />
      <ContentTrackFields content={current} onChange={update} />
      <button type="button" onClick={() => { deletePartContentCommand(current.element.id); setSelected('') }}>{t.remove}</button>
    </>}{error && <p role="status" className={st.error}>{error}</p>}
  </details>
}
function ContentValueFields({ value, options, assets, onChange }: { value: ConnectedContent; options: SurfaceOption[]; assets: Asset[]; onChange: (value: ConnectedContent) => void }) {
  const t = useT().parts, change = (fn: (element: ConnectedContent) => void) => { const next = structuredClone(value); fn(next); onChange(next) }
  const spin = value.motion.find((motion) => motion.type === 'spin')
  return <div className={st.fields}>
    <TextField label={t.name} value={value.name} onChange={(name) => change((element) => { element.name = name })} />
    <AttachmentFields value={value.attachment} options={options} onChange={(attachment) => change((element) => { element.attachment = attachment })} />
    {(['position', 'rotation', 'scale'] as const).map((kind) => <div key={kind}>{([0, 1, 2] as const).map((axis) => <NumberField key={axis}
      label={`${t.content[kind]} ${'XYZ'[axis]}`} value={value.baseTransform[kind][axis]} onChange={(number) => change((element) => { element.baseTransform[kind][axis] = number })} />)}</div>)}
    {value.type !== 'group' && <><NumberField label={t.parameters.width} value={value.width} onChange={(number) => change((element) => { if (element.type !== 'group') element.width = number })} />
      <NumberField label={t.parameters.height} value={value.height} onChange={(number) => change((element) => { if (element.type !== 'group') element.height = number })} /></>}
    {value.type === 'visual' && <MaterialFields allowVideo assets={assets} value={{ image: value.image, backImage: value.backImage, text: value.text, textColor: value.foregroundColor, color: value.backgroundColor }} onChange={(material) => change((element) => {
      if (element.type !== 'visual') return
      element.image = material.image; element.backImage = material.backImage; element.text = material.text ?? ''; element.foregroundColor = material.textColor ?? '#322719'; element.backgroundColor = material.color ?? '#00000000'
    })} />}
    {value.presentation.kind === 'fiction' && <><NumberField label={t.content.spin} value={spin?.speed ?? 0} onChange={(speed) => change((element) => { element.motion = [...element.motion.filter((motion) => motion.type !== 'spin'), ...speed ? [{ type: 'spin' as const, axis: spin?.axis ?? 'z', speed }] : []] })} />
      <select aria-label={t.content.axis} value={spin?.axis ?? 'z'} onChange={(event) => change((element) => { element.motion = [...element.motion.filter((motion) => motion.type !== 'spin'), { type: 'spin', axis: event.target.value as 'x' | 'y' | 'z', speed: spin?.speed ?? .9 }] })}>{['x', 'y', 'z'].map((axis) => <option key={axis}>{axis}</option>)}</select></>}
  </div>
}
function ContentTrackFields({ content, onChange }: { content: PartContent; onChange: (value: PartContent) => void }) {
  const t = useT().parts, [time, setTime] = useState(0), [property, setProperty] = useState<TimelineProperty>('opacity'), [value, setValue] = useState('1')
  const properties: TimelineProperty[] = ['opacity', 'visible', 'visual.image', ...(content.element.presentation.kind === 'fiction' ? ['position.x', 'position.y', 'position.z', 'rotation.z', 'scale'] as TimelineProperty[] : [])]
  return <div className={st.section}><NumberField label={t.content.time} value={time} min={0} onChange={setTime} />
    <select aria-label={t.content.property} value={property} onChange={(event) => setProperty(event.target.value as TimelineProperty)}>{properties.map((item) => <option key={item}>{item}</option>)}</select>
    <TextField label={t.content.value} value={value} onChange={setValue} />
    <button type="button" onClick={() => { const next = structuredClone(content); let track = next.tracks.find((item) => item.property === property)
      if (!track) { track = { id: crypto.randomUUID(), property, target: { type: 'element', elementId: content.element.id }, keys: [] }; next.tracks.push(track) }
      track.keys = [...track.keys.filter((key) => key.time !== time), { id: crypto.randomUUID(), time, value: NUMBER_PROPERTIES.has(property) ? Number(value) : property === 'visible' ? value === 'true' : value, ease: DISCRETE_PROPERTIES.has(property) ? 'hold' : 'linear' }]; onChange(next)
    }}>{t.content.key}</button>
    {content.tracks.flatMap((track) => track.keys.map((key) => <div key={key.id}>{track.property} · {key.time}s · {String(key.value)} <button type="button" aria-label={t.content.removeKey} onClick={() => onChange({ ...content, tracks: content.tracks.map((item) => item.id === track.id ? { ...item, keys: item.keys.filter((k) => k.id !== key.id) } : item) })}>{t.remove}</button></div>))}
  </div>
}
