import { useMemo, useRef, useState } from 'react'
import { BUILTIN_PARTS } from '../../parts/catalog'
import { evaluateBookParts, spreadPartNodes } from '../../parts/book'
import { pagePorts, openingAngle, type PartPort } from '../../parts/geometry'
import { resolveBinding } from '../../parts/evaluate'
import { validatePartDefinition } from '../../parts/validate'
import type { PartElement } from '../../schema/stageElement'
import type { PartBinding, PartReference } from '../../parts/schema'
import { useT } from '../i18n'
import { useBuilderStore } from '../store'
import { FormDialog } from '../ui/FormDialog'
import { createPartDraftCommand, deletePlacedPartCommand, openPartLibraryCommand, placePartCommand, referenceDefinition, updatePlacedPartCommand } from './commands'
import { usePartEditorStore } from './store'
import { importPartSelection } from './files'
import { MaterialFields, MountField, NumberField, TextField, mountOptions, parameterLabel, portLabel, referenceName, referencePorts } from './fields'
import st from './parts.module.css'
import { PlacementPreview } from './PlacementPreview'
import { usePartPlacementStore } from './placementState'
import { PartEditFields } from './PartEditFields'

export function PartPalette() {
  const t = useT().parts, store = useBuilderStore(), library = usePartEditorStore((state) => state.library)
  const placement = usePartPlacementStore(), [error, setError] = useState('')
  const selected = (reference: PartReference) => JSON.stringify(placement.tool?.reference) === JSON.stringify(reference)
  const input = useRef<HTMLInputElement>(null)
  const valid = useMemo(() => new Map(library.map((entry) => [entry.hash, validatePartDefinition(entry.bundle.definition, entry.bundle.definitions)])), [library])
  return <section className={st.palette} data-tobidas-kind="parts-palette">
    <h3>{t.basic}</h3><div className={st.grid}>{BUILTIN_PARTS.map((part) => <button type="button" key={part.id} data-tobidas-basic-part={part.id}
      aria-pressed={selected({ builtin: part.id, version: part.version })} disabled={store.mode !== 'edit'}
      onClick={() => placement.start({ builtin: part.id, version: part.version })}>{t.names[part.id]}</button>)}</div>
    <h3>{t.custom}</h3>
    {!library.length && <p className={st.hint}>{t.empty}</p>}
    {library.map((entry) => <div className={st.libraryItem} key={entry.hash}>
      <strong>{entry.bundle.definition.name} <small>{t.version} {entry.bundle.definition.revision}</small></strong>
      <div className={st.buttons}><button type="button" disabled={store.mode !== 'edit' || !valid.get(entry.hash)?.ok} title={valid.get(entry.hash)?.errors.join('\n')}
        aria-pressed={selected({ custom: entry.hash })} onClick={() => placement.start({ custom: entry.hash })}>{t.place}</button>
        <button type="button" onClick={() => void openPartLibraryCommand(entry.hash)}>{t.edit}</button>
        <button type="button" onClick={() => void openPartLibraryCommand(entry.hash, true)}>{t.copy}</button></div>
    </div>)}
    <div className={st.buttons}><button type="button" onClick={() => createPartDraftCommand({ name: t.newPart, input: { kind: 'fold-pair', maxOpeningAngleDeg: 180 } })}>{t.create}</button>
      <button type="button" onClick={() => input.current?.click()}>{t.import}</button></div>
    <input ref={input} type="file" accept=".zip" hidden aria-label={t.import} onChange={(event) => {
      const files = Array.from(event.target.files ?? []); event.target.value = ''
      if (files) void importPartSelection(files).catch((caught) => setError(String(caught)))
    }} />
    <h3>{t.effects}</h3><div className={st.buttons}>
      <button type="button" onClick={() => store.addPresetVisual(store.activeSpreadId, 'right', 'light-particles')}>{useT().presets['light-particles']}</button>
      <button type="button" onClick={() => store.setPlacement(store.placement === 'sound-cue' ? null : 'sound-cue')}>{useT().presets.soundCue}</button>
    </div>
    {error && <p className={st.error} role="alert">{error}</p>}
  </section>
}

export function PartPlacementDialog({ reference, element, spreadId, onClose }: { reference: PartReference; element?: PartElement; spreadId?: string; onClose: () => void }) {
  const t = useT().parts, store = useBuilderStore(), library = usePartEditorStore((state) => state.library)
  const spread = store.project.book.spreads.find((item) => item.id === (spreadId ?? store.activeSpreadId))!
  const definitions = { ...store.project.partDefinitions, ...Object.fromEntries(library.flatMap((entry) => [[entry.hash, entry.bundle.definition], ...Object.entries(entry.bundle.definitions)])) }
  const definition = referenceDefinition(reference, definitions)
  const options = mountOptions(spreadPartNodes(spread), definitions, undefined, element?.id)
  const ports = pagePorts(store.project.book.format.pageWidth, store.project.book.format.pageWidth / store.project.book.format.pageAspect, Math.PI, 0)
  let evaluated: ReturnType<typeof evaluateBookParts> | undefined
  try { evaluated = evaluateBookParts(store.project, spread, Math.PI, 0) } catch { /* 不適合な既存配置も接続を編集できる。 */ }
  const compatible = options.filter((option) => {
    if (option.kind !== definition.input.kind) return false
    try {
      const port = resolveBinding(option.binding, undefined, (nodeId, portId) => {
        const value = nodeId === '$book' ? ports[portId] : evaluated?.nodes[nodeId]?.ports[portId]
        if (!value) throw new Error('Unresolved mount')
        return value
      })
      return definition.input.kind !== 'fold-pair' || port.kind !== 'fold-pair' || openingAngle(port) <= definition.input.maxOpeningAngleDeg + 1e-6
    } catch { return true }
  })
  const [mount, setMount] = useState<PartBinding>(element?.part.mount ?? compatible.find((option) => option.binding.type === 'output' && option.binding.portId === 'ground-backdrop')?.binding
    ?? compatible[0]?.binding ?? { type: 'output', nodeId: '$book', portId: 'gutter' })
  const [parameters, setParameters] = useState<Record<string, number>>(element?.part.parameters ?? {})
  const [name, setName] = useState(element?.name ?? referenceName(reference, definitions)), [error, setError] = useState('')
  const previewProject = { ...store.project, partDefinitions: definitions,
    assets: [...new Map([...store.project.assets, ...library.flatMap((entry) => entry.bundle.assets)].map((asset) => [asset.id, asset])).values()] }
  return <FormDialog title={element ? t.properties : t.place} submitLabel={element ? t.apply : t.place} kind="place-part" error={error} onClose={onClose} onSubmit={(event) => {
    event.preventDefault()
    const result = element ? updatePlacedPartCommand({ spreadId: spread.id, elementId: element.id, name, changes: { mount, parameters } })
      : placePartCommand({ spreadId: spread.id, name, definition: reference, mount, parameters, materials: {} })
    if (result.ok) onClose(); else setError(result.message)
  }}><div className={st.fields}>
    <PlacementPreview project={previewProject} spreadId={spread.id} elementId={element?.id} instance={{ definition: reference, mount, parameters, materials: element?.part.materials ?? {}, uniformScale: element?.part.uniformScale }} />
    <TextField label={t.name} value={name} onChange={setName} />
    <p>{referenceName(reference, definitions)}</p>
    <MountField value={mount} options={definition.input.kind === 'fold-pair' ? [...compatible, ...options.filter((option) => option.kind === 'surface')] : compatible} kind={definition.input.kind} onChange={setMount} />
    {!compatible.length && <p className={st.hint}>{t.noCompatible}</p>}
    {definition.input.kind === 'fold-pair' && <p className={st.hint}>{t.maximum}: {definition.input.maxOpeningAngleDeg}</p>}
    {Object.entries(definition.parameters).map(([key, p]) => <NumberField key={key} label={'custom' in reference ? p.label : parameterLabel(p.label)} value={parameters[key] ?? p.default} min={p.min} max={p.max}
      step={p.type === 'integer' ? 1 : .05} onChange={(value) => setParameters({ ...parameters, [key]: value })} />)}
    {'builtin' in reference && reference.builtin === 'folding-box' && <p className={st.hint}>{t.boxHint}</p>}
  </div></FormDialog>
}

export function PlacedPartInspector({ element, spreadId }: { element: PartElement; spreadId: string }) {
  const t = useT().parts, store = useBuilderStore(), library = usePartEditorStore((state) => state.library)
  const [editing, setEditing] = useState(false), [surface, setSurface] = useState('*'), [error, setError] = useState('')
  const definition = referenceDefinition(element.part.definition, store.project.partDefinitions ?? {})
  const materialSlots = 'builtin' in element.part.definition ? ['*', ...referencePorts(element.part.definition, {}).filter((port) => port.kind === 'surface').map((port) => port.name)]
    : Object.keys('materialSlots' in definition ? definition.materialSlots : {})
  const active = materialSlots.includes(surface) ? surface : materialSlots[0]
  const material = active ? element.part.materials[active] ?? ('materialSlots' in definition ? definition.materialSlots[active] : {}) ?? {} : {}
  const update = (changes: Parameters<typeof updatePlacedPartCommand>[0]['changes']) => {
    const result = updatePlacedPartCommand({ spreadId, elementId: element.id, changes }); setError(result.ok ? '' : result.message)
  }
  return <section className={st.inspector} data-tobidas-kind="placed-part-inspector"><h2>{element.name}</h2><div className={st.fields}>
    <PartEditFields spreadId={spreadId} elementId={element.id} />
    <button type="button" onClick={() => setEditing(true)}>{t.dimensions} / {t.mount}</button>
    {materialSlots.length > 0 && <>
      <label className={st.field}><span>{t.material}</span><select aria-label={t.material} value={active} onChange={(event) => setSurface(event.target.value)}>
        {materialSlots.map((name) => <option key={name} value={name}>{name === '*' ? t.title : portLabel(name)}</option>)}
      </select></label><MaterialFields assets={store.project.assets} value={material} onChange={(value) => update({ materials: { ...element.part.materials, [active]: value } })} />
    </>}
    {'custom' in element.part.definition && <button type="button" onClick={() => {
      if (!('revision' in definition)) return
      const next = library.filter((item) => item.bundle.definition.id === definition.id && item.bundle.definition.revision > definition.revision)
        .sort((a, b) => b.bundle.definition.revision - a.bundle.definition.revision)[0]
      if (next) update({ definition: { custom: next.hash } }); else setError(t.noUpdate)
    }}>{t.updateDefinition}</button>}
    <button type="button" onClick={() => deletePlacedPartCommand(spreadId, element.id)}>{t.remove}</button>
    {error && <p className={st.error} role="alert">{error}</p>}
    {editing && <PartPlacementDialog reference={element.part.definition} element={element} spreadId={spreadId} onClose={() => setEditing(false)} />}
  </div></section>
}
