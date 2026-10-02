import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Home, Images, MousePointerClick, Plus, Redo2, Share2, ShieldAlert, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Undo2, UserRound } from 'lucide-react'
import { Icon, ICON } from '../../ui/Icon'
import { BUILTIN_PARTS } from '../../parts/catalog'
import { evaluateExpression, type PartBinding, type PartNode, type PartParameter, type PartReference } from '../../parts/schema'
import { validatePartDefinition } from '../../parts/validate'
import { fileToAsset } from '../assets/ingest'
import { useT } from '../i18n'
import { FormDialog } from '../ui/FormDialog'
import { usePartEditorStore, useWorkspaceStore } from './store'
import { addPartNodeCommand, createPartDraftCommand, deletePartNodeCommand, exposePartMaterialCommand, exposePartParameterCommand,
  exposePartPortCommand, exposePartEditHandleCommand, editPartNodeCommand, referenceDefinition, savePartLibraryCommand, updatePartDefinitionCommand, updatePartNodeCommand } from './commands'
import { MaterialFields, MountField, NumberField, TextField, mountOptions, parameterLabel, portLabel, referenceName, referencePorts } from './fields'
import { PartContentEditor, ShapeFields } from './ContentFields'
import { deletePartContentCommand, setPartShapeCommand } from './contentCommands'
import { dependentPartIds } from '../../parts/evaluate'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { PartPreview } from './PartPreview'
import { importPartSelection, savePartFolder, savePartZipFile } from './files'
import { Dropdown, Splitter } from '../ui/Menu'
import { IconTabs, storedTab, storeTab, type IconTab } from '../ui/IconTabs'
import { SplitStack } from '../ui/SplitStack'
import { clampPanelWidth, loadPanelWidth, savePanelWidth } from '../layout/panelSizing'
import st from './parts.module.css'
import bst from '../builder.module.css'

const TAB_KEY = 'tobidas.partSidebarTab'
const TAB_IDS = ['settings', 'node', 'contents', 'materials', 'public', 'author', 'validation'] as const
type PartTab = (typeof TAB_IDS)[number]

/** カスタム部品の編集画面。絵本の編集画面と同じく、ヘッダーのプルダウンと左のタブ付きサイドバーで構成する */
export function PartEditor() {
  const app = useT(), t = app.parts, store = usePartEditorStore(), { bundle } = store
  const [adding, setAdding] = useState(false), [error, setError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; parts: number; contents: number } | null>(null)
  const importRef = useRef<HTMLInputElement>(null), folderRef = useRef<HTMLInputElement>(null), assetRef = useRef<HTMLInputElement>(null)
  const [width, setWidth] = useState(() => loadPanelWidth('part-sidebar', 380))
  useEffect(() => { savePanelWidth('part-sidebar', width) }, [width])
  const [tab, setTab] = useState<PartTab>(() => storedTab(TAB_KEY, TAB_IDS, 'settings'))
  const choose = (next: PartTab) => { setTab(next); storeTab(TAB_KEY, next) }
  // 内部の部品を選んだらその設定、装飾を選んだら装飾と演出のタブを見せる
  const previous = useRef(store.selectedId)
  useEffect(() => {
    if (previous.current === store.selectedId) return
    previous.current = store.selectedId
    if (store.selectedId) setTab(store.selectedId.startsWith('content:') ? 'contents' : 'node')
  }, [store.selectedId])
  const validation = useMemo(() => validatePartDefinition(bundle.definition, bundle.definitions), [bundle])
  const node = bundle.definition.nodes.find((item) => item.id === store.selectedId)
  // 乗っている部品や付けた装飾まで消える場合だけ確かめる。単独の部品はそのまま消し、元に戻すで戻せる
  const requestNodeDelete = (id: string) => {
    const { definition } = usePartEditorStore.getState().bundle
    const target = definition.nodes.find((item) => item.id === id)
    if (!target) return
    const ids = dependentPartIds(definition.nodes, id), removed = new Set<string>()
    let more = true
    while (more) { more = false; for (const { element } of definition.contents ?? []) {
      const attachment = element.attachment
      if (!removed.has(element.id) && (attachment.type === 'surface' ? ids.has(attachment.surface.nodeId) : removed.has(attachment.elementId))) { removed.add(element.id); more = true }
    } }
    if (ids.size > 1 || removed.size) setPendingDelete({ id, name: target.name, parts: ids.size - 1, contents: removed.size })
    else { deletePartNodeCommand(id); store.select(null) }
  }
  // Deleteキーで選択中の内部の部品か装飾を消す。入力欄の編集中は文字の削除に使う
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete') return
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return
      const selected = usePartEditorStore.getState().selectedId
      if (!selected) return
      event.preventDefault()
      if (selected.startsWith('content:')) { deletePartContentCommand(selected.slice(8)); usePartEditorStore.getState().select(null) }
      else requestNodeDelete(selected)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const run = async (operation: () => unknown | Promise<unknown>) => {
    try { setError(''); const result = await operation(); if (result && typeof result === 'object' && 'ok' in result && !result.ok && 'message' in result) setError(String(result.message)) }
    catch (caught) { if ((caught as Error).name !== 'AbortError') setError(String(caught instanceof Error ? caught.message : caught)) }
  }
  const tabs: IconTab<PartTab>[] = [
    { id: 'settings', icon: SlidersHorizontal, label: t.properties, node: <section className={bst.panel} aria-label={t.properties}>
      <div className={bst.panelTitle}>{t.properties}</div>
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
    </section> },
    { id: 'node', icon: MousePointerClick, label: t.selectedNode, node: <section className={bst.panel} aria-label={t.selectedNode}>
      <div className={bst.panelTitle}>{t.selectedNode}</div>
      {node ? <NodeInspector key={node.id} node={node} /> : <p className={st.hint}>{t.noneSelected}</p>}
    </section> },
    { id: 'contents', icon: Sparkles, label: t.content.contents, node: <section className={bst.panel} aria-label={t.content.contents}><PartContentEditor open /></section> },
    { id: 'materials', icon: Images, label: t.materials, node: <section className={bst.panel} aria-label={t.materials}>
      <div className={bst.panelTitle}>{t.materials}<button type="button" onClick={() => assetRef.current?.click()}>{t.upload}</button></div>
      <input ref={assetRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,video/mp4,video/webm" multiple hidden aria-label={t.upload} onChange={(event) => {
        const files = Array.from(event.target.files ?? []); event.target.value = ''
        void run(async () => { const assets = [...bundle.assets]
          for (const file of files) assets.push(await fileToAsset(file, new Set(assets.map((asset) => asset.id))))
          store.change((target) => { target.assets = assets })
        })
      }} />
      {bundle.assets.map((asset) => <p key={asset.id} className={st.hint}>{asset.name}</p>)}
    </section> },
    { id: 'public', icon: Share2, label: t.publicItems, node: <section className={bst.panel} aria-label={t.publicItems}>
      <div className={bst.panelTitle}>{t.publicItems}</div>
      <details className={st.section} open><summary>{t.exposedParameters}</summary><PublicParameters /></details>
      <details className={st.section} open><summary>{t.publicPorts}</summary><PublicPorts /></details>
    </section> },
    { id: 'author', icon: UserRound, label: t.author, node: <section className={bst.panel} aria-label={t.author}>
      <div className={bst.panelTitle}>{t.author}</div>
      <div className={st.fields}>
        <TextField label={t.author} value={bundle.definition.author} onChange={(author) => updatePartDefinitionCommand({ author })} />
        <TextField label={t.license} value={bundle.definition.license} onChange={(license) => updatePartDefinitionCommand({ license })} />
      </div>
    </section> },
    { id: 'validation', icon: validation.ok ? ShieldCheck : ShieldAlert, label: t.validation, node: <section className={bst.panel} aria-label={t.validation}>
      <div className={bst.panelTitle}>{t.validation}</div>
      <p className={validation.ok ? st.success : st.error}>{validation.ok ? t.valid : t.invalid}</p>
      <p className={st.hint}>{t.validationModel}</p>{validation.errors.slice(0, 6).map((message) => <p key={message} className={st.error}>{message}</p>)}
    </section> },
  ]
  return <div className={bst.app} data-tobidas-kind="part-editor" data-document-id={store.documentId}>
    <header className={bst.toolbar}>
      <button type="button" onClick={() => useWorkspaceStore.getState().setScreen('home')}><Icon as={Home} />{t.home}</button>
      <button type="button" onClick={() => createPartDraftCommand({ name: t.newPart, input: { kind: 'fold-pair', maxOpeningAngleDeg: 180 } })}>{t.newPart}</button>
      <Dropdown label={app.toolbar.open}>{(close) => <>
        <button type="button" onClick={() => { close(); importRef.current?.click() }}>{t.openZip}</button>
        <button type="button" onClick={() => { close(); folderRef.current?.click() }}>{t.openFolder}</button>
      </>}</Dropdown>
      <Dropdown label={app.toolbar.save}>{(close) => <>
        <button type="button" disabled={!validation.ok} onClick={() => { close(); void run(savePartLibraryCommand) }}>{t.saveLibrary}</button>
        <button type="button" onClick={() => { close(); void run(() => savePartZipFile(bundle)) }}>{t.export}</button>
        <button type="button" onClick={() => { close(); void run(() => savePartFolder(bundle)) }}>{t.saveFolder}</button>
      </>}</Dropdown>
      <button type="button" aria-label={t.undo} title={t.undo} disabled={!store.undo.length} onClick={store.undoEdit}><Icon as={Undo2} size={ICON.bar} /></button>
      <button type="button" aria-label={t.redo} title={t.redo} disabled={!store.redo.length} onClick={store.redoEdit}><Icon as={Redo2} size={ICON.bar} /></button>
      <span className={bst.spacer} />
      <strong className={bst.toolbarTitle}>{t.partEditor}</strong>
      <input ref={importRef} type="file" accept=".zip" hidden aria-label={t.import} onChange={(event) => { const files = event.target.files; if (files) void run(() => importPartSelection(files, true)); event.target.value = '' }} />
      <input ref={folderRef} type="file" multiple hidden aria-label={t.importFolder} {...{ webkitdirectory: '' }} onChange={(event) => { const files = event.target.files; if (files) void run(() => importPartSelection(files, true)); event.target.value = '' }} />
    </header>
    <div className={`${bst.main} ${bst.mainEdit}`}>
      <aside className={bst.left} style={{ '--panel-width': `${width}px` } as CSSProperties}>
        <SplitStack storageKey="part-sidebar" initial={[220]} mobileAccordion panes={[
          { key: 'structure', label: t.structure, node: <section className={`${bst.panel} ${bst.navigatorPanel}`} aria-label={t.structure}>
            <div className={bst.panelTitle}>{t.structure}<button type="button" onClick={() => setAdding(true)}><Icon as={Plus} />{t.add}</button></div>
            <ul className={st.nodeList}>{bundle.definition.nodes.map((item) => <li key={item.id} className={st.nodeRow}>
              <button type="button" aria-pressed={item.id === store.selectedId} onClick={() => store.select(item.id)}>{item.name}</button>
              <button type="button" className={st.nodeDelete} aria-label={t.deleteNode(item.name)} title={t.deleteNode(item.name)}
                onClick={() => requestNodeDelete(item.id)}><Icon as={Trash2} size={ICON.row} /></button>
            </li>)}</ul>
            {!bundle.definition.nodes.length && <p className={st.hint}>{t.noneSelected}</p>}
          </section> },
          { key: 'tabs', label: app.app.panelSidebar, node: <IconTabs tabs={tabs} active={tab} onChange={choose} label={app.app.panelSidebar} idPrefix="part-sidebar" kind="part-sidebar" /> },
        ]} />
      </aside>
      <Splitter onDelta={(delta) => setWidth((value) => clampPanelWidth(value + delta))} />
      <div className={bst.viewport}><PartPreview bundle={bundle} selected={store.selectedId ?? undefined} onSelect={store.select} editable /></div>
    </div>
    {error && <p className={`${st.error} ${st.floatingError}`} role="alert">{error}</p>}
    <footer className={bst.status}><span>{bundle.definition.name}</span><span>{t.version} {bundle.definition.revision}</span>
      <span>{store.status === 'saving' ? t.saving : store.status === 'saved' ? t.saved : store.saveError}</span>
      <span className={bst.spacer} />
      <span className={validation.ok ? bst.ok : bst.err}>{validation.ok ? t.valid : t.invalid}</span></footer>
    {adding && <AddNodeDialog onClose={() => setAdding(false)} />}
    {pendingDelete && <ConfirmDialog title={t.deleteNodeTitle}
      body={t.deleteNodeBody(pendingDelete.name, pendingDelete.parts, pendingDelete.contents)} okLabel={app.app.deleteOk}
      onOk={() => { deletePartNodeCommand(pendingDelete.id); store.select(null) }} onClose={() => setPendingDelete(null)} />}
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
  const parameterKey = definition.parameters[parameter] ? parameter : Object.keys(definition.parameters)[0]
  const angleOperation = 'builtin' in node.definition ? ['splayAngle', 'tiltAngle', 'yawAngle'].find((id) => id === parameterKey)
    : 'editHandles' in definition ? definition.editHandles?.find((handle) => handle.parameter === parameterKey)?.id : undefined
  return <div className={st.fields}>
    <ShapeFields faceIds={referencePorts(node.definition, bundle.definitions).filter((port) => port.kind === 'surface' && !['support', 'ground', 'ground-b'].includes(port.name)).map((port) => port.name)} shapes={node.shapes} onChange={(faceId, shape) => { const result = setPartShapeCommand({ nodeId: node.id, faceId, shape }); setError(result.ok ? '' : result.message) }} />
    <h2>{node.name}</h2><TextField label={t.name} value={node.name} onChange={(name) => update({ name })} />
    <MountField value={node.mount} options={mountOptions(bundle.definition.nodes, bundle.definitions, bundle.definition.input, node.id)} kind={definition.input.kind} onChange={(mount) => update({ mount })} />
    <div className={st.section}><h2>{t.dimensions}</h2><div className={st.fields}>
      <NumberField label={t.editing.scale} min={.01} max={100} value={node.uniformScale ?? 1} onChange={(value) => {
        const result = editPartNodeCommand({ nodeId: node.id, intent: { type: 'scale', value } }); setError(result.ok ? '' : result.message)
      }} />
      {Object.entries(definition.parameters).map(([key, p]) => {
        let value = p.default
        try { value = evaluateExpression(node.parameters[key] ?? p.default, values) } catch { /* 公開項目を直せるよう既定値を表示する。 */ }
        const expression = node.parameters[key]
        return <div key={key}><NumberField label={'custom' in node.definition ? p.label : parameterLabel(p.label)} value={value} min={p.min} max={p.max} step={p.type === 'integer' ? 1 : .05}
          onChange={(number) => {
            const result = editPartNodeCommand({ nodeId: node.id, intent: { type: 'parameters', values: { [key]: number } } })
            setError(result.ok ? '' : result.message)
          }} />
          {expression && typeof expression !== 'number' && 'parameter' in expression && <p className={st.hint}>{t.exposedParameters}: {expression.parameter}</p>}
        </div>
      })}
    </div></div>
    <details className={st.section}><summary>{t.exposedParameters}</summary><div className={st.fields}>
      <label className={st.field}><span>{t.dimensions}</span><select aria-label={t.exposedParameters} value={parameterKey} onChange={(event) => { setParameter(event.target.value); setPublicName(event.target.value) }}>
        {Object.entries(definition.parameters).map(([key, p]) => <option key={key} value={key}>{'custom' in node.definition ? p.label : parameterLabel(p.label)}</option>)}
      </select></label>
      <TextField label={t.parameterId} value={publicName} onChange={setPublicName} />
      <button type="button" onClick={() => {
        const p = definition.parameters[parameterKey]
        if (!p) return
        const result = exposePartParameterCommand({ name: publicName, nodeId: node.id, parameter: parameterKey, specification: { ...p, label: 'custom' in node.definition ? p.label : parameterLabel(p.label), default: evaluateExpression(node.parameters[parameterKey] ?? p.default, values) } })
        setError(result.ok ? '' : result.message)
      }}>{t.expose}</button>
      {angleOperation && <button type="button" onClick={() => {
        const result = exposePartEditHandleCommand({ name: publicName, label: 'custom' in node.definition ? definition.parameters[parameterKey].label : parameterLabel(parameterKey), nodeId: node.id, operation: angleOperation })
        setError(result.ok ? '' : result.message)
      }}>{t.editing.expose}</button>}
    </div></details>
    {active && <div className={st.section}><h2>{t.materials}</h2><label className={st.field}><span>{t.material}</span><select aria-label={t.material} value={active} onChange={(event) => setSurface(event.target.value)}>
      {ownSurfaces.map((name) => <option value={name} key={name}>{name === '*' ? t.title : portLabel(name)}</option>)}
    </select></label>
      <MaterialFields paper value={material} assets={bundle.assets} onChange={(value) => slot
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
    {(bundle.definition.editHandles ?? []).map((handle) => <div className={st.buttons} key={handle.id}><span>{t.editing.handles}: {handle.label}</span>
      <button type="button" onClick={() => updatePartDefinitionCommand({ editHandles: bundle.definition.editHandles?.filter((h) => h.id !== handle.id) })}>{t.remove}</button></div>)}
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
