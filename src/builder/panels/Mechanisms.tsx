import { useState, type FormEvent, type ReactNode } from 'react'
import { mechanismSurfaceIds, mechanismBridgeIds, type MechanismSpec } from '../../schema/mechanism'
import type { AssemblyElement, StageElement } from '../../schema/stageElement'
import { compositionKinds } from '../mechanismPresets'
import { elementDescendantIds } from '../hierarchy'
import { useT } from '../i18n'
import { useBuilderStore } from '../store'
import { FormDialog } from '../ui/FormDialog'
import { publishOperationResult } from '../operations/result'
import { attachToSurfaceCommand, createCompositionCommand, createMechanismCommand, mechanismKinds, placeSurfaceAssetCommand,
  setMechanismSurfaceCommand, updateCompositionCommand, updateMechanismCommand } from '../operations/mechanisms'
import type { BuilderCommandResult } from '../operations/types'
import st from '../builder.module.css'

function surfaceOptions(spec: MechanismSpec) {
  return mechanismSurfaceIds(spec).sort((a, b) => Number(/^(mount|base)-/.test(a)) - Number(/^(mount|base)-/.test(b)))
}
function errorText(result: BuilderCommandResult) { return result.ok ? undefined : [result.message, ...Object.values(result.fieldErrors)].join(' ') }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className={st.dialogField}>{label}{children}</label> }
function NumberField({ label, value, onChange, step = .1 }: { label: string; value: number; onChange: (value: number) => void; step?: number }) {
  return <Field label={label}><input type="number" step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></Field>
}
function VectorField({ label, value, onChange }: { label: string; value: [number, number, number]; onChange: (value: [number, number, number]) => void }) {
  return <div className={st.dialogField}><span>{label}</span><div className={st.vec3}>{value.map((n, i) => <input key={i} type="number" step=".1"
    aria-label={`${label} ${['X', 'Y', 'Z'][i]}`} value={n} onChange={(event) => { const next = [...value] as [number, number, number]; next[i] = Number(event.target.value); onChange(next) }} />)}</div></div>
}
function MountField({ value, onChange, spreadId, kind, elementId }: {
  value: MechanismSpec['mount']; onChange: (value: MechanismSpec['mount']) => void; spreadId: string; kind: string; elementId?: string
}) {
  const t = useT()
  const spread = useBuilderStore((state) => state.project.book.spreads.find((item) => item.id === spreadId))
  const excluded = spread && elementId ? elementDescendantIds(spread, elementId) : new Set<string>()
  const parents = spread?.elements.filter((item): item is AssemblyElement => item.type === 'assembly' && item.id !== elementId && !excluded.has(item.id)) ?? []
  const bridges = parents.filter((item) => mechanismBridgeIds(item.mechanism).includes('deck'))
  const selectedParent = value.type === 'bridge' || value.type === 'surface' ? parents.find((item) => item.id === value.elementId) : undefined
  return <>
    <Field label={t.mechanisms.mount}><select value={value.type === 'page' ? value.side : value.type} onChange={(event) => {
      const next = event.target.value
      if (next === 'left' || next === 'right') onChange({ type: 'page', side: next })
      if (next === 'gutter') onChange({ type: 'gutter' })
      if (next === 'bridge' && bridges[0]) onChange({ type: 'bridge', elementId: bridges[0].id, bridgeId: 'deck', v: .5 })
      if (next === 'surface' && parents[0]) onChange({ type: 'surface', elementId: parents[0].id, surfaceId: surfaceOptions(parents[0].mechanism)[0], u: .5, v: .5, offset: 0 })
    }}>
      <option value="gutter">{t.mechanisms.gutter}</option>
      {kind === 'panel' && <><option value="left">{t.operations.leftPage}</option><option value="right">{t.operations.rightPage}</option></>}
      <option value="bridge" disabled={!bridges.length}>{t.mechanisms.bridge}</option>
      {kind === 'panel' && <option value="surface" disabled={!parents.length}>{t.mechanisms.surface}</option>}
    </select></Field>
    {(value.type === 'bridge' || value.type === 'surface') && <Field label={t.operations.parent}><select value={value.elementId} onChange={(event) => {
      const parent = parents.find((item) => item.id === event.target.value)!
      onChange(value.type === 'bridge' ? { ...value, elementId: parent.id } : { ...value, elementId: parent.id, surfaceId: surfaceOptions(parent.mechanism)[0] })
    }}>{(value.type === 'bridge' ? bridges : parents).map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}</select></Field>}
    {value.type === 'bridge' && <NumberField label={t.mechanisms.bridgePosition} value={value.v} onChange={(v) => onChange({ ...value, v })} />}
    {value.type === 'surface' && selectedParent && <>
      <Field label={t.mechanisms.surfaceId}><select value={value.surfaceId} onChange={(event) => onChange({ ...value, surfaceId: event.target.value })}>
        {surfaceOptions(selectedParent.mechanism).map((id) => <option key={id} value={id}>{id}</option>)}</select></Field>
      <NumberField label={t.operations.normalizedU} value={value.u} onChange={(u) => onChange({ ...value, u })} />
      <NumberField label={t.operations.normalizedV} value={value.v} onChange={(v) => onChange({ ...value, v })} />
    </>}
  </>
}

export function MechanismCreateDialog({ onClose }: { onClose: () => void }) {
  const t = useT(); const store = useBuilderStore()
  const [choice, setChoice] = useState<string>('box'); const [spreadId, setSpreadId] = useState(store.activeSpreadId)
  const [mount, setMount] = useState<MechanismSpec['mount']>({ type: 'gutter' })
  const [width, setWidth] = useState(3); const [height, setHeight] = useState(2); const [depth, setDepth] = useState(2)
  const [count, setCount] = useState(3); const [spacing, setSpacing] = useState(1.2); const [error, setError] = useState<string>()
  const composite = compositionKinds.includes(choice as typeof compositionKinds[number])
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = publishOperationResult(composite
      ? createCompositionCommand({ spreadId, kind: choice as typeof compositionKinds[number], count, spacing, width, depth, mount })
      : createMechanismCommand({ spreadId, kind: choice as typeof mechanismKinds[number], parameters: { width, height, depth }, mount }))
    setError(errorText(result)); if (result.ok) onClose()
  }
  return <FormDialog title={t.mechanisms.create} submitLabel={t.presets.place} kind="mechanism-create-form" error={error} onSubmit={submit} onClose={onClose}>
    <Field label={t.operations.spread}><select value={spreadId} onChange={(event) => { setSpreadId(event.target.value); setMount(choice === 'panel' ? { type: 'page', side: 'right' } : { type: 'gutter' }) }}>{store.project.book.spreads.map((spread) => <option key={spread.id} value={spread.id}>{spread.name}</option>)}</select></Field>
    <Field label={t.mechanisms.kind}><select autoFocus value={choice} onChange={(event) => { setChoice(event.target.value); setMount(event.target.value === 'panel' ? { type: 'page', side: 'right' } : { type: 'gutter' }) }}>
      <optgroup label={t.mechanisms.kind}>{mechanismKinds.map((kind) => <option key={kind} value={kind}>{t.mechanisms.kinds[kind]}</option>)}</optgroup>
      <optgroup label={t.mechanisms.composition}>{compositionKinds.map((kind) => <option key={kind} value={kind}>{t.mechanisms.compositions[kind]}</option>)}</optgroup>
    </select></Field>
    <NumberField label={t.properties.width} value={width} onChange={setWidth} />
    {!composite && <NumberField label={t.properties.height} value={height} onChange={setHeight} />}
    <NumberField label={t.mechanisms.depth} value={depth} onChange={setDepth} />
    {composite && <><NumberField label={t.mechanisms.count} value={count} onChange={setCount} step={1} /><NumberField label={t.mechanisms.spacing} value={spacing} onChange={setSpacing} /></>}
    <MountField value={mount} onChange={setMount} spreadId={spreadId} kind={choice} />
    <p className={st.hintSmall}>{t.mechanisms.constrainedHint}</p>
  </FormDialog>
}

export function MechanismFields({ spreadId, element }: { spreadId: string; element: AssemblyElement }) {
  const t = useT()
  const [editOpen, setEditOpen] = useState(false)
  const [surfaceId, setSurfaceId] = useState(surfaceOptions(element.mechanism)[0] ?? '')
  const [error, setError] = useState<string>()
  const surfaces = surfaceOptions(element.mechanism)
  const selected = surfaces.includes(surfaceId) ? surfaceId : surfaces[0]
  const slot = element.mechanism.surfaces[selected]
  const assets = useBuilderStore((state) => state.project.assets).filter((asset) => ['image', 'svg'].includes(asset.type))
  const changeSurface = (changes: Parameters<typeof setMechanismSurfaceCommand>[0]) => setError(errorText(publishOperationResult(setMechanismSurfaceCommand(changes))))
  const base = { spreadId, elementId: element.id, surfaceId: selected }
  return <div data-tobidas-kind="mechanism-inspector" data-tobidas-id={element.id}>
    <p>{t.mechanisms.kinds[element.mechanism.kind]}</p>
    <button type="button" data-tobidas-action="edit-mechanism" onClick={() => setEditOpen(true)}>{t.mechanisms.edit}</button>
    {editOpen && <MechanismEditDialog spreadId={spreadId} element={element} onClose={() => setEditOpen(false)} />}
    {element.composition && <CompositionFields spreadId={spreadId} element={element} />}
    <Field label={t.mechanisms.surfaceId}><select value={selected} onChange={(event) => setSurfaceId(event.target.value)}>{surfaces.map((id) => <option key={id} value={id}>{id}</option>)}</select></Field>
    <Field label={t.mechanisms.surfaceColor}><input type="color" value={slot?.color ?? '#f3c980'} onChange={(event) => changeSurface({ ...base, color: event.target.value })} /></Field>
    {(['image', 'backImage'] as const).map((side) => <Field key={side} label={side === 'image' ? t.mechanisms.surfaceImage : t.mechanisms.surfaceBackImage}>
      <select value={slot?.[side] ?? ''} onChange={(event) => changeSurface({ ...base, [side]: event.target.value || null })}>
        <option value="">{t.properties.unset}</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
      </select></Field>)}
    <Field label={t.mechanisms.surfaceText}><input key={`${element.id}/${selected}/text`} defaultValue={slot?.text ?? ''} onBlur={(event) => {
      if (event.target.value !== (slot?.text ?? '')) changeSurface({ ...base, text: event.target.value })
    }} /></Field>
    <label><input type="checkbox" checked={slot?.visible !== false} onChange={(event) => changeSurface({ ...base, visible: event.target.checked })} />{t.mechanisms.surfaceVisible}</label>
    {error && <p role="alert">{error}</p>}
    <SurfaceAssetFields key={`${element.id}/${selected}`} spreadId={spreadId} parentId={element.id} surfaceId={selected} />
  </div>
}

function CompositionFields({ spreadId, element }: { spreadId: string; element: AssemblyElement }) {
  const t = useT(); const settings = element.composition!
  const [count, setCount] = useState(settings.count); const [spacing, setSpacing] = useState(settings.spacing)
  const [error, setError] = useState<string>()
  const [open, setOpen] = useState(false)
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary>{t.mechanisms.compositions[settings.kind]}</summary>{open && <>
    <NumberField label={t.mechanisms.count} value={count} onChange={setCount} step={1} /><NumberField label={t.mechanisms.spacing} value={spacing} onChange={setSpacing} />
    <button type="button" onClick={() => setError(errorText(publishOperationResult(updateCompositionCommand({ spreadId, elementId: element.id, count, spacing }))))}>{t.mechanisms.apply}</button>
    {error && <p role="alert">{error}</p>}
  </>}</details>
}

function MechanismEditDialog({ spreadId, element, onClose }: { spreadId: string; element: AssemblyElement; onClose: () => void }) {
  const t = useT()
  const [spec, setSpec] = useState(structuredClone(element.mechanism)); const [error, setError] = useState<string>()
  const parameters = (key: keyof MechanismSpec['parameters'], value: number) => setSpec({ ...spec, parameters: { ...spec.parameters, [key]: value } })
  const staging = (changes: Partial<MechanismSpec['staging']>) => setSpec({ ...spec, staging: { ...spec.staging, ...changes } })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = publishOperationResult(updateMechanismCommand({ spreadId, elementId: element.id, parameters: spec.parameters, mount: spec.mount, deployment: spec.deployment, staging: spec.staging }))
    setError(errorText(result)); if (result.ok) onClose()
  }
  return <FormDialog title={t.mechanisms.edit} submitLabel={t.mechanisms.apply} kind="mechanism-edit-form" error={error} onSubmit={submit} onClose={onClose}>
    {(['width', 'height', 'depth', 'segments', 'angleDeg'] as const).map((key) => <NumberField key={key}
      label={key === 'width' || key === 'height' ? t.properties[key] : key === 'depth' ? t.mechanisms.depth : key === 'segments' ? t.mechanisms.segments : t.mechanisms.angle}
      value={spec.parameters[key]} onChange={(value) => parameters(key, value)} step={key === 'segments' ? 1 : .1} />)}
    <MountField value={spec.mount} onChange={(mount) => setSpec({ ...spec, mount })} spreadId={spreadId} kind={spec.kind} elementId={element.id} />
    <p className={st.hintSmall}>{t.mechanisms.constrainedHint}</p>
    <label><input type="checkbox" checked={spec.deployment.mode === 'virtual'} onChange={(event) => setSpec({ ...spec,
      deployment: { mode: event.target.checked ? 'virtual' : 'page-constrained' },
      staging: event.target.checked ? spec.staging : { ...spec.staging, openScale: 1, closedScale: 1, openPosition: [0, 0, 0], closedPosition: [0, 0, 0], floatAmplitude: [0, 0, 0] },
    })} />{t.mechanisms.fiction}</label>
    {spec.deployment.mode === 'virtual' && <>
      <p className={st.hintSmall}>{t.mechanisms.virtualHint}</p>
      <NumberField label={t.mechanisms.openScale} value={spec.staging.openScale} onChange={(openScale) => staging({ openScale })} />
      <NumberField label={t.mechanisms.closedScale} value={spec.staging.closedScale} onChange={(closedScale) => staging({ closedScale })} />
      <VectorField label={t.mechanisms.openPosition} value={spec.staging.openPosition} onChange={(openPosition) => staging({ openPosition })} />
      <VectorField label={t.mechanisms.closedPosition} value={spec.staging.closedPosition} onChange={(closedPosition) => staging({ closedPosition })} />
      <VectorField label={t.mechanisms.floatAmplitude} value={spec.staging.floatAmplitude} onChange={(floatAmplitude) => staging({ floatAmplitude })} />
      <NumberField label={t.mechanisms.floatPeriod} value={spec.staging.floatPeriod} onChange={(floatPeriod) => staging({ floatPeriod })} />
    </>}

  </FormDialog>
}

function SurfaceAssetFields({ spreadId, parentId, surfaceId }: { spreadId: string; parentId: string; surfaceId: string }) {
  const t = useT(); const assets = useBuilderStore((state) => state.project.assets).filter((asset) => ['image', 'svg', 'video'].includes(asset.type))
  const [open, setOpen] = useState(false); const [assetId, setAssetId] = useState(assets[0]?.id ?? '')
  const [u, setU] = useState(.5); const [v, setV] = useState(.5); const [width, setWidth] = useState(1); const [height, setHeight] = useState(1.5)
  const [upright, setUpright] = useState(true); const [error, setError] = useState<string>()
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary>{t.mechanisms.placeAsset}</summary>{open && <>
    <Field label={t.operations.asset}><select value={assetId} onChange={(event) => setAssetId(event.target.value)}>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></Field>
    <NumberField label={t.operations.normalizedU} value={u} onChange={setU} /><NumberField label={t.operations.normalizedV} value={v} onChange={setV} />
    <NumberField label={t.properties.width} value={width} onChange={setWidth} /><NumberField label={t.properties.height} value={height} onChange={setHeight} />
    <label><input type="checkbox" checked={upright} onChange={(event) => setUpright(event.target.checked)} />{t.mechanisms.upright}</label>
    <button type="button" onClick={() => setError(errorText(publishOperationResult(placeSurfaceAssetCommand({ spreadId, parentId, surfaceId, assetId, u, v, width, height, upright }))))}>{t.presets.place}</button>
    {error && <p role="alert">{error}</p>}
  </>}</details>
}

export function SurfaceAttachmentDialog({ spreadId, element, onClose }: { spreadId: string; element: StageElement; onClose: () => void }) {
  return element.type === 'assembly' ? <AssemblyAttachmentDialog spreadId={spreadId} element={element} onClose={onClose} />
    : <VisualAttachmentDialog spreadId={spreadId} element={element} onClose={onClose} />
}

function AssemblyAttachmentDialog({ spreadId, element, onClose }: { spreadId: string; element: AssemblyElement; onClose: () => void }) {
  const t = useT(); const [mount, setMount] = useState(element.mechanism.mount); const [error, setError] = useState<string>()
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault()
    const result = publishOperationResult(updateMechanismCommand({ spreadId, elementId: element.id, mount }))
    setError(errorText(result)); if (result.ok) onClose()
  }
  return <FormDialog title={t.mechanisms.attach} submitLabel={t.mechanisms.apply} kind="surface-attachment-form" error={error} onSubmit={submit} onClose={onClose}>
    <MountField value={mount} onChange={setMount} spreadId={spreadId} kind={element.mechanism.kind} elementId={element.id} />
    <p className={st.hintSmall}>{t.mechanisms.constrainedHint}</p>
  </FormDialog>
}

function VisualAttachmentDialog({ spreadId, element, onClose }: { spreadId: string; element: StageElement; onClose: () => void }) {
  const t = useT(); const spread = useBuilderStore((state) => state.project.book.spreads.find((item) => item.id === spreadId))
  const parents = spread?.elements.filter((item): item is AssemblyElement => item.type === 'assembly' && item.id !== element.id) ?? []
  const [parentId, setParentId] = useState(parents[0]?.id ?? '')
  const parent = parents.find((item) => item.id === parentId)
  const surfaces = parent ? surfaceOptions(parent.mechanism) : []
  const [surfaceId, setSurfaceId] = useState(surfaces[0] ?? ''); const selected = surfaces.includes(surfaceId) ? surfaceId : surfaces[0] ?? ''
  const [u, setU] = useState(.5); const [v, setV] = useState(.5); const [offset, setOffset] = useState(0); const [error, setError] = useState<string>()
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault()
    const result = publishOperationResult(attachToSurfaceCommand({ spreadId, elementId: element.id, parentId, surfaceId: selected, u, v, offset }))
    setError(errorText(result)); if (result.ok) onClose()
  }
  return <FormDialog title={t.mechanisms.attach} submitLabel={t.mechanisms.apply} kind="surface-attachment-form" error={error} onSubmit={submit} onClose={onClose}>
    <Field label={t.operations.parent}><select value={parentId} onChange={(event) => setParentId(event.target.value)}>{parents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
    <Field label={t.mechanisms.surfaceId}><select value={selected} onChange={(event) => setSurfaceId(event.target.value)}>{surfaces.map((id) => <option key={id} value={id}>{id}</option>)}</select></Field>
    <NumberField label={t.operations.normalizedU} value={u} onChange={setU} /><NumberField label={t.operations.normalizedV} value={v} onChange={setV} />
    <NumberField label={t.mechanisms.offset} value={offset} onChange={setOffset} />
  </FormDialog>
}
