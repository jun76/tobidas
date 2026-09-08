import { useMemo, useRef, useState } from 'react'
import { Home, Plus, Download, Upload, Save } from 'lucide-react'
import { Icon } from '../../ui/Icon'
import { BUILTIN_PARTS } from '../../parts/catalog'
import { evaluateExpression, type PartBinding, type PartNode, type PartParameter, type PartReference } from '../../parts/schema'
import { validatePartDefinition } from '../../parts/validate'
import { fileToAsset } from '../assets/ingest'
import { useT } from '../i18n'
import { FormDialog } from '../ui/FormDialog'
import { usePartEditorStore, useWorkspaceStore } from './store'
import { addPartNodeCommand, createPartDraftCommand, deletePartNodeCommand, exposePartMaterialCommand, exposePartParameterCommand,
  exposePartPortCommand, referenceDefinition, savePartLibraryCommand, updatePartDefinitionCommand, updatePartNodeCommand } from './commands'
import { MaterialFields, MountField, NumberField, TextField, mountOptions, parameterLabel, portLabel, referenceName, referencePorts } from './fields'
import { PartPreview } from './PartPreview'
import { importPartSelection, savePartFolder, savePartZipFile } from './files'
import st from './parts.module.css'

export function PartEditor() {
  const t = useT().parts, store = usePartEditorStore(), { bundle } = store
  const [adding, setAdding] = useState(false), [error, setError] = useState('')
  const importRef = useRef<HTMLInputElement>(null), folderRef = useRef<HTMLInputElement>(null), assetRef = useRef<HTMLInputElement>(null)
  const validation = useMemo(() => validatePartDefinition(bundle.definition, bundle.definitions), [bundle])
  const node = bundle.definition.nodes.find((item) => item.id === store.selectedId)
  const run = async (operation: () => unknown | Promise<unknown>) => {
    try { setError(''); const result = await operation(); if (result && typeof result === 'object' && 'ok' in result && !result.ok && 'message' in result) setError(String(result.message)) }
    catch (caught) { if ((caught as Error).name !== 'AbortError') setError(String(caught instanceof Error ? caught.message : caught)) }
  }
  return <div className={st.editor} data-tobidas-kind="part-editor" data-document-id={store.documentId}>
    <header className={st.toolbar}>
      <button type="button" onClick={() => useWorkspaceStore.getState().setScreen('home')}><Icon as={Home} />{t.home}</button>
      <strong>{t.partEditor}</strong>
      <button type="button" onClick={() => createPartDraftCommand({ name: t.newPart, input: { kind: 'fold-pair', maxOpeningAngleDeg: 180 } })}><Icon as={Plus} />{t.newPart}</button>
      <button type="button" onClick={() => importRef.current?.click()}><Icon as={Upload} />{t.import}</button>
      <button type="button" onClick={() => folderRef.current?.click()}>{t.importFolder}</button>
      <button type="button" disabled={!validation.ok} onClick={() => void run(savePartLibraryCommand)}><Icon as={Save} />{t.saveLibrary}</button>
      <button type="button" onClick={() => void run(() => savePartZipFile(bundle))}><Icon as={Download} />{t.export}</button>
      <button type="button" onClick={() => void run(() => savePartFolder(bundle))}>{t.saveFolder}</button>
      <button type="button" disabled={!store.undo.length} onClick={store.undoEdit}>{t.undo}</button>
      <button type="button" disabled={!store.redo.length} onClick={store.redoEdit}>{t.redo}</button>
      <input ref={importRef} type="file" accept=".zip" hidden aria-label={t.import} onChange={(event) => { const files = event.target.files; if (files) void run(() => importPartSelection(files, true)); event.target.value = '' }} />
      <input ref={folderRef} type="file" multiple hidden aria-label={t.importFolder} {...{ webkitdirectory: '' }} onChange={(event) => { const files = event.target.files; if (files) void run(() => importPartSelection(files, true)); event.target.value = '' }} />
    </header>
    <div className={st.layout}>
      <aside className={st.sidebar}>
        <h2>{t.properties}</h2>
        <div className={st.fields}>
          <TextField label={t.name} value={bundle.definition.name} onChange={(name) => void run(() => updatePartDefinitionCommand({ name }))} />
          <TextField label={t.description} value={bundle.definition.description} multiline onChange={(description) => void run(() => updatePartDefinitionCommand({ description }))} />
          <label className={st.field}><span>{t.input}</span><select aria-label={t.input} value={bundle.definition.input.kind} onChange={(event) => updatePartDefinitionCommand({
            input: event.target.value === 'surface' ? { kind: 'surface' } : { kind: 'fold-pair', maxOpeningAngleDeg: 180 },
          })}><option value="surface">{t.oneFace}</option><option value="fold-pair">{t.twoFaces}</option></select></label>
          {bundle.definition.input.kind === 'fold-pair' && <>
            <NumberField label={t.maximum} min={1} max={180} value={bundle.definition.input.maxOpeningAngleDeg} onChange={(max) => {
              const input = bundle.definition.input
              if (input.kind === 'fold-pair') void run(() => updatePartDefinitionCommand({ input: { ...input, maxOpeningAngleDeg: max, referenceOpenAngleDeg: Math.min(input.referenceOpenAngleDeg ?? max, max) } }))
            }} />
            <NumberField label={t.reference} min={0} max={bundle.definition.input.maxOpeningAngleDeg}
              value={bundle.definition.input.referenceOpenAngleDeg ?? bundle.definition.input.maxOpeningAngleDeg} onChange={(angle) => {
                const input = bundle.definition.input
                if (input.kind === 'fold-pair') void run(() => updatePartDefinitionCommand({ input: { ...input, referenceOpenAngleDeg: angle } }))
              }} /><p className={st.hint}>{t.referenceHint}</p>
          </>}
        </div>
        <div className={st.section}><h2>{t.structure}</h2><button type="button" onClick={() => setAdding(true)}>{t.add}</button>
          <ul className={st.nodeList}>{bundle.definition.nodes.map((item) => <li key={item.id}><button type="button" aria-pressed={item.id === store.selectedId} onClick={() => store.select(item.id)}>{item.name}</button></li>)}</ul>
        </div>
        <details className={st.section}><summary>{t.author}</summary><div className={st.fields}>
          <TextField label={t.author} value={bundle.definition.author} onChange={(author) => updatePartDefinitionCommand({ author })} />
          <TextField label={t.license} value={bundle.definition.license} onChange={(license) => updatePartDefinitionCommand({ license })} />
        </div></details>
        <details className={st.section}><summary>{t.exposedParameters}</summary><PublicParameters /></details>
        <details className={st.section}><summary>{t.publicPorts}</summary><PublicPorts /></details>
        <div className={st.section}><h2>{t.materials}</h2><button type="button" onClick={() => assetRef.current?.click()}>{t.upload}</button>
          <input ref={assetRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple hidden aria-label={t.upload} onChange={(event) => {
            const files = Array.from(event.target.files ?? []); event.target.value = ''
            void run(async () => { const assets = [...bundle.assets]
              for (const file of files) assets.push(await fileToAsset(file, new Set(assets.map((asset) => asset.id))))
              store.change((target) => { target.assets = assets })
            })
          }} />
          {bundle.assets.map((asset) => <p key={asset.id} className={st.hint}>{asset.name}</p>)}
        </div>
      </aside>
      <PartPreview bundle={bundle} selected={store.selectedId ?? undefined} onSelect={store.select} />
      <aside className={st.inspector}>{node ? <NodeInspector key={node.id} node={node} /> : <p className={st.hint}>{t.noneSelected}</p>}
        <details className={st.section} open={!validation.ok}><summary className={validation.ok ? st.success : undefined}>{validation.ok ? t.valid : t.invalid}</summary>
          <p className={st.hint}>{t.validationModel}</p>{validation.errors.slice(0, 6).map((message) => <p key={message} className={st.error}>{message}</p>)}
        </details>
        {error && <p className={st.error} role="alert">{error}</p>}
      </aside>
    </div>
    <footer className={st.status}><span>{bundle.definition.name}</span><span>{t.version} {bundle.definition.revision}</span>
      <span>{store.status === 'saving' ? t.saving : store.status === 'saved' ? t.saved : store.saveError}</span></footer>
    {adding && <AddNodeDialog onClose={() => setAdding(false)} />}
  </div>
}

function AddNodeDialog({ onClose }: { onClose: () => void }) {
  const t = useT().parts, store = usePartEditorStore(), { bundle } = store
  const definitions = { ...bundle.definitions, ...Object.fromEntries(store.library.map((item) => [item.hash, item.bundle.definition])) }
  const [reference, setReference] = useState<PartReference>({ builtin: 'backdrop', version: BUILTIN_PARTS.find((part) => part.id === 'backdrop')!.version })
  const definition = referenceDefinition(reference, definitions)
  const options = mountOptions(bundle.definition.nodes, definitions, bundle.definition.input)
  const [mount, setMount] = useState<PartBinding>({ type: 'input' }), [error, setError] = useState('')
  return <FormDialog title={t.add} submitLabel={t.add} kind="add-part-node" error={error} onClose={onClose} onSubmit={(event) => {
    event.preventDefault()
    const result = addPartNodeCommand({ name: referenceName(reference, definitions), definition: reference, mount, parameters: {}, materials: {} })
    if (result.ok) onClose(); else setError(result.message)
  }}><div className={st.fields}>
    <label className={st.field}><span>{t.definition}</span><select aria-label={t.definition} value={'builtin' in reference ? `basic:${reference.builtin}` : reference.custom} onChange={(event) => {
      const value = event.target.value, next = value.startsWith('basic:') ? { builtin: value.slice(6), version: BUILTIN_PARTS.find((part) => part.id === value.slice(6))!.version } : { custom: value }
      setReference(next)
      const kind = referenceDefinition(next, definitions).input.kind
      setMount(options.find((option) => option.kind === kind)?.binding ?? { type: 'input' })
    }}><optgroup label={t.basic}>{BUILTIN_PARTS.map((part) => <option value={`basic:${part.id}`} key={part.id}>{t.names[part.id]}</option>)}</optgroup>
      <optgroup label={t.custom}>{store.library.map((item) => <option key={item.hash} value={item.hash}>{item.bundle.definition.name}</option>)}</optgroup>
    </select></label>
    <MountField value={mount} onChange={setMount} options={options} kind={definition.input.kind} />
    {'builtin' in reference && reference.builtin === 'folding-box' && <p className={st.hint}>{t.boxHint}</p>}
  </div></FormDialog>
}

function NodeInspector({ node }: { node: PartNode }) {
  const t = useT().parts, { bundle } = usePartEditorStore(), [error, setError] = useState('')
  const [surface, setSurface] = useState('*'), [exposedName, setExposedName] = useState('artwork'), [parameter, setParameter] = useState('height'), [publicName, setPublicName] = useState('height')
  let definition: ReturnType<typeof referenceDefinition>
  try { definition = referenceDefinition(node.definition, bundle.definitions) } catch (caught) { return <p className={st.error}>{String(caught)}</p> }
  const values = Object.fromEntries(Object.entries(bundle.definition.parameters).map(([key, p]) => [key, p.default]))
  const update = (changes: Parameters<typeof updatePartNodeCommand>[0]['changes']) => {
    const result = updatePartNodeCommand({ nodeId: node.id, changes }); setError(result.ok ? '' : result.message)
  }
  const ownSurfaces = 'builtin' in node.definition ? ['*', ...referencePorts(node.definition, bundle.definitions).filter((port) => port.kind === 'surface').map((port) => port.name)]
    : Object.keys('materialSlots' in definition ? definition.materialSlots : {})
  const active = ownSurfaces.includes(surface) ? surface : ownSurfaces[0]
  const materialValue = node.materials[active] ?? {}, slot = 'slot' in materialValue ? materialValue.slot : undefined
  const material = 'slot' in materialValue ? bundle.definition.materialSlots[materialValue.slot] ?? {} : materialValue
  return <div className={st.fields}>
    <h2>{node.name}</h2><TextField label={t.name} value={node.name} onChange={(name) => update({ name })} />
    <MountField value={node.mount} options={mountOptions(bundle.definition.nodes, bundle.definitions, bundle.definition.input, node.id)} kind={definition.input.kind} onChange={(mount) => update({ mount })} />
    <div className={st.section}><h2>{t.dimensions}</h2><div className={st.fields}>
      {Object.entries(definition.parameters).map(([key, p]) => {
        let value = p.default
        try { value = evaluateExpression(node.parameters[key] ?? p.default, values) } catch { /* 公開項目を直せるよう既定値を表示する。 */ }
        const expression = node.parameters[key]
        return <div key={key}><NumberField label={'custom' in node.definition ? p.label : parameterLabel(p.label)} value={value} min={p.min} max={p.max} step={p.type === 'integer' ? 1 : .05}
          onChange={(number) => update({ parameters: { ...node.parameters, [key]: number } })} />
          {expression && typeof expression !== 'number' && 'parameter' in expression && <p className={st.hint}>{t.exposedParameters}: {expression.parameter}</p>}
        </div>
      })}
    </div></div>
    <details className={st.section}><summary>{t.exposedParameters}</summary><div className={st.fields}>
      <label className={st.field}><span>{t.dimensions}</span><select aria-label={t.exposedParameters} value={parameter} onChange={(event) => { setParameter(event.target.value); setPublicName(event.target.value) }}>
        {Object.entries(definition.parameters).map(([key, p]) => <option key={key} value={key}>{'custom' in node.definition ? p.label : parameterLabel(p.label)}</option>)}
      </select></label>
      <TextField label={t.parameterId} value={publicName} onChange={setPublicName} />
      <button type="button" onClick={() => {
        const p = definition.parameters[parameter]
        if (!p) return
        const result = exposePartParameterCommand({ name: publicName, nodeId: node.id, parameter, specification: { ...p, label: 'custom' in node.definition ? p.label : parameterLabel(p.label), default: evaluateExpression(node.parameters[parameter] ?? p.default, values) } })
        setError(result.ok ? '' : result.message)
      }}>{t.expose}</button>
    </div></details>
    {active && <div className={st.section}><h2>{t.materials}</h2><label className={st.field}><span>{t.material}</span><select aria-label={t.material} value={active} onChange={(event) => setSurface(event.target.value)}>
      {ownSurfaces.map((name) => <option value={name} key={name}>{name === '*' ? t.title : portLabel(name)}</option>)}
    </select></label>
      <MaterialFields value={material} assets={bundle.assets} onChange={(value) => slot
        ? exposePartMaterialCommand({ name: slot, nodeId: node.id, surface: active, material: value }) : update({ materials: { ...node.materials, [active]: value } })} />
      <details className={st.section}><summary>{t.exposeMaterial}</summary><TextField label={t.exposedMaterial} value={exposedName} onChange={setExposedName} />
        <button type="button" onClick={() => exposePartMaterialCommand({ name: exposedName, nodeId: node.id, surface: active, material })}>{t.expose}</button>
      </details>
    </div>}
    <details className={st.section}><summary>{t.outline}</summary><p className={st.hint}>{t.outlineHint}</p>
      <TextField label={t.outline} multiline value={(node.outline ?? []).map((point) => point.join(' ')).join('\n')} onChange={(text) => {
        if (!text.trim()) { update({ outline: undefined }); return }
        const outline = text.trim().split('\n').map((line) => line.trim().split(/[\s,]+/).map(Number))
        if (outline.some((point) => point.length !== 2 || point.some((n) => !Number.isFinite(n)))) { setError(t.outlineHint); return }
        update({ outline: outline as [number, number][] })
      }} />
    </details>
    <button type="button" onClick={() => deletePartNodeCommand(node.id)}>{t.remove}</button>
    {error && <p className={st.error} role="alert">{error}</p>}
  </div>
}
function PublicParameters() {
  const t = useT().parts, { bundle } = usePartEditorStore(), [error, setError] = useState('')
  const update = (id: string, changes: Partial<PartParameter>) => {
    const result = updatePartDefinitionCommand({ parameters: { ...bundle.definition.parameters, [id]: { ...bundle.definition.parameters[id], ...changes } } })
    setError(result.ok ? '' : result.message)
  }
  return <div className={st.fields}>
    {Object.entries(bundle.definition.parameters).map(([id, parameter]) => <fieldset key={id} className={`${st.fields} ${st.parameterSpec}`}><legend>{id}</legend>
      <TextField label={t.parameterLabel} value={parameter.label} onChange={(label) => update(id, { label })} />
      <NumberField label={t.parameterDefault} value={parameter.default} step={parameter.type === 'integer' ? 1 : .05} onChange={(value) => update(id, { default: value })} />
      <NumberField label={t.parameterMin} value={parameter.min} onChange={(min) => update(id, { min })} />
      <NumberField label={t.parameterMax} value={parameter.max} onChange={(max) => update(id, { max })} />
    </fieldset>)}
    <p className={st.hint}>{t.parameterHint}</p>
    {error && <p className={st.error} role="alert">{error}</p>}
  </div>
}
function PublicPorts() {
  const t = useT().parts, { bundle } = usePartEditorStore()
  const [name, setName] = useState('mount'), [binding, setBinding] = useState<PartBinding>({ type: 'input' })
  return <div className={st.fields}>
    {Object.entries(bundle.definition.outputs).map(([id]) => <div key={id} className={st.buttons}><span>{id}</span><button type="button" onClick={() => exposePartPortCommand({ name: id, binding: null })}>{t.remove}</button></div>)}
    <TextField label={t.portName} value={name} onChange={setName} />
    <MountField value={binding} options={mountOptions(bundle.definition.nodes, bundle.definitions, bundle.definition.input)} onChange={setBinding} />
    <button type="button" onClick={() => exposePartPortCommand({ name, binding })}>{t.expose}</button>
  </div>
}
