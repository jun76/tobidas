import { useState, type FormEvent, type ReactNode } from 'react'
import { mechanismSurfaceIds, type MechanismSpec } from '../../schema/mechanism'
import type { AssemblyElement, StageElement } from '../../schema/stageElement'
import { compositionKinds } from '../mechanismPresets'
import { useT } from '../i18n'
import { useBuilderStore } from '../store'
import { FormDialog } from '../ui/FormDialog'
import { publishOperationResult } from '../operations/result'
import { attachToSurfaceCommand, createCompositionCommand, createMechanismCommand, mechanismKinds, placeSurfaceAssetCommand,
  setMechanismSurfaceCommand, updateCompositionCommand, updateMechanismCommand } from '../operations/mechanisms'
import type { BuilderCommandResult } from '../operations/types'
import st from '../builder.module.css'

function errorText(result: BuilderCommandResult) { return result.ok ? undefined : [result.message, ...Object.values(result.fieldErrors)].join(' ') }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className={st.dialogField}>{label}{children}</label> }
function NumberField({ label, value, onChange, step = .1 }: { label: string; value: number; onChange: (value: number) => void; step?: number }) {
  return <Field label={label}><input type="number" step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></Field>
}
function VectorField({ label, value, onChange }: { label: string; value: [number, number, number]; onChange: (value: [number, number, number]) => void }) {
  return <div className={st.dialogField}><span>{label}</span><div className={st.vec3}>{value.map((n, i) => <input key={i} type="number" step=".1"
    aria-label={`${label} ${['X', 'Y', 'Z'][i]}`} value={n} onChange={(event) => { const next = [...value] as [number, number, number]; next[i] = Number(event.target.value); onChange(next) }} />)}</div></div>
}
function MountField({ value, onChange }: { value: MechanismSpec['mount']; onChange: (value: MechanismSpec['mount']) => void }) {
  const t = useT()
  return <Field label={t.mechanisms.mount}><select value={value.type === 'page' ? value.side : value.type} onChange={(event) => {
    const next = event.target.value
    if (next === 'left' || next === 'right') onChange({ type: 'page', side: next })
    if (next === 'gutter' || next === 'space') onChange({ type: next })
  }}><option value="left">{t.operations.leftPage}</option><option value="right">{t.operations.rightPage}</option>
    <option value="gutter">{t.mechanisms.gutter}</option><option value="space">{t.mechanisms.space}</option>
    {value.type === 'surface' && <option value="surface">{t.mechanisms.surface}: {value.surfaceId}</option>}
  </select></Field>
}

export function MechanismCreateDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const store = useBuilderStore()
  const [choice, setChoice] = useState<string>('box')
  const [spreadId, setSpreadId] = useState(store.activeSpreadId)
  const [mode, setMode] = useState<'virtual' | 'page-constrained'>('virtual')
  const [mount, setMount] = useState<MechanismSpec['mount']>({ type: 'space' })
  const [width, setWidth] = useState(3); const [height, setHeight] = useState(2); const [depth, setDepth] = useState(2)
  const [count, setCount] = useState(3); const [spacing, setSpacing] = useState(1.2)
  const [error, setError] = useState<string>()
  const composite = compositionKinds.includes(choice as typeof compositionKinds[number])
  const physicalAvailable = ['panel', 'v-fold', 'platform', 'box'].includes(choice)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = publishOperationResult(composite
      ? createCompositionCommand({ spreadId, kind: choice as typeof compositionKinds[number], count, spacing, width, depth })
      : createMechanismCommand({ spreadId, kind: choice as typeof mechanismKinds[number], parameters: { width, height, depth }, mount,
        deployment: { mode }, staging: { closedScale: mode === 'page-constrained' ? 1 : .2 } }))
    setError(errorText(result)); if (result.ok) onClose()
  }
  return <FormDialog title={t.mechanisms.create} submitLabel={t.presets.place} kind="mechanism-create-form" error={error} onSubmit={submit} onClose={onClose}>
    <Field label={t.operations.spread}><select value={spreadId} onChange={(event) => setSpreadId(event.target.value)}>{store.project.book.spreads.map((spread) => <option key={spread.id} value={spread.id}>{spread.name}</option>)}</select></Field>
    <Field label={t.mechanisms.kind}><select autoFocus value={choice} onChange={(event) => { setChoice(event.target.value); setMode('virtual') }}>
      <optgroup label={t.mechanisms.kind}>{mechanismKinds.map((kind) => <option key={kind} value={kind}>{t.mechanisms.kinds[kind]}</option>)}</optgroup>
      <optgroup label={t.mechanisms.composition}>{compositionKinds.map((kind) => <option key={kind} value={kind}>{t.mechanisms.compositions[kind]}</option>)}</optgroup>
    </select></Field>
    <NumberField label={t.properties.width} value={width} onChange={setWidth} />
    {!composite && <NumberField label={t.properties.height} value={height} onChange={setHeight} />}
    <NumberField label={t.mechanisms.depth} value={depth} onChange={setDepth} />
    {composite ? <><NumberField label={t.mechanisms.count} value={count} onChange={setCount} step={1} /><NumberField label={t.mechanisms.spacing} value={spacing} onChange={setSpacing} /></>
      : <><MountField value={mount} onChange={setMount} />
        <Field label={t.mechanisms.mode}><select value={mode} onChange={(event) => {
          const next = event.target.value as typeof mode; setMode(next)
          if (next === 'page-constrained') setMount(choice === 'panel' ? { type: 'page', side: 'right' } : { type: 'gutter' })
        }}><option value="virtual">{t.mechanisms.virtual}</option>{physicalAvailable && <option value="page-constrained">{t.mechanisms.constrained}</option>}</select></Field>
        <p className={st.hintSmall}>{mode === 'virtual' ? t.mechanisms.virtualHint : t.mechanisms.constrainedHint}</p>
      </>}
  </FormDialog>
}

export function MechanismFields({ spreadId, element }: { spreadId: string; element: AssemblyElement }) {
  const t = useT()
  const [editOpen, setEditOpen] = useState(false)
  const [surfaceId, setSurfaceId] = useState(mechanismSurfaceIds(element.mechanism)[0] ?? '')
  const [error, setError] = useState<string>()
  const surfaces = mechanismSurfaceIds(element.mechanism)
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
    <MountField value={spec.mount} onChange={(mount) => setSpec({ ...spec, mount })} />
    <Field label={t.mechanisms.mode}><select value={spec.deployment.mode} onChange={(event) => {
      const mode = event.target.value as 'virtual' | 'page-constrained'
      setSpec({ ...spec, deployment: { ...spec.deployment, mode },
        mount: mode === 'page-constrained' ? spec.kind === 'panel' ? { type: 'page', side: 'right' } : { type: 'gutter' } : spec.mount,
        staging: mode === 'page-constrained' ? { ...spec.staging, closedScale: 1, closedPosition: [0, 0, 0], floatAmplitude: [0, 0, 0] } : spec.staging })
    }}><option value="virtual">{t.mechanisms.virtual}</option>{['panel', 'v-fold', 'box', 'platform'].includes(spec.kind) && <option value="page-constrained">{t.mechanisms.constrained}</option>}</select></Field>
    {spec.deployment.mode === 'virtual' && <>
      <NumberField label={t.mechanisms.closedScale} value={spec.staging.closedScale} onChange={(closedScale) => staging({ closedScale })} />
      <VectorField label={t.mechanisms.closedPosition} value={spec.staging.closedPosition} onChange={(closedPosition) => staging({ closedPosition })} />
      <VectorField label={t.mechanisms.floatAmplitude} value={spec.staging.floatAmplitude} onChange={(floatAmplitude) => staging({ floatAmplitude })} />
      <NumberField label={t.mechanisms.floatPeriod} value={spec.staging.floatPeriod} onChange={(floatPeriod) => staging({ floatPeriod })} />
      <NumberField label={t.mechanisms.start} value={spec.deployment.start} onChange={(start) => setSpec({ ...spec, deployment: { ...spec.deployment, start } })} />
      <NumberField label={t.mechanisms.end} value={spec.deployment.end} onChange={(end) => setSpec({ ...spec, deployment: { ...spec.deployment, end } })} />
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
  const t = useT(); const spread = useBuilderStore((state) => state.project.book.spreads.find((item) => item.id === spreadId))
  const parents = spread?.elements.filter((item): item is AssemblyElement => item.type === 'assembly' && item.id !== element.id) ?? []
  const [parentId, setParentId] = useState(parents[0]?.id ?? '')
  const parent = parents.find((item) => item.id === parentId)
  const surfaces = parent ? mechanismSurfaceIds(parent.mechanism) : []
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
