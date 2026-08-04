import { useEffect, useRef, useState, type FormEvent } from 'react'
import { assetAccept } from '../../package/model'
import { fileToAsset } from '../assets/ingest'
import { requestElementDelete } from '../elementDelete'
import { useT } from '../i18n'
import type { VisualPresetId } from '../presets'
import { useBuilderStore } from '../store'
import { useDialogs } from '../ui/DialogProvider'
import st from '../builder.module.css'
import {
  createAiVisual,
  moveAiElement,
  parentValue,
  parseFinite,
  parseParent,
  placeAiAsset,
  updateAiElement,
  visualElement,
} from './commands'
import { buildAiStateSummary } from './stateSummary'
import type { AiCommandResult } from './types'

const ASSET_PRESETS = ['paper-stack', 'bottom-upright', 'depth-layer'] as const

export function AiModePanel() {
  const t = useT()
  const store = useBuilderStore()
  const dialogs = useDialogs()
  const summary = buildAiStateSummary(store)
  const [result, setResult] = useState<AiCommandResult | null>(null)
  const [measuredDurations, setMeasuredDurations] = useState<Map<string, number | null>>(() => new Map())
  const assetInputRef = useRef<HTMLInputElement>(null)
  const readOnly = store.mode !== 'edit'
  const activeSpreadId = summary.activeSpread?.id ?? ''
  const imageAssets = summary.assets.filter((asset) => asset.type === 'image' || asset.type === 'svg')

  useEffect(() => {
    const missing = store.project.assets.filter((asset) => asset.type === 'audio' && asset.duration === undefined)
    setMeasuredDurations(new Map())
    if (!missing.length) return
    let alive = true
    const audioElements: HTMLAudioElement[] = []
    void Promise.all(missing.map((asset) => new Promise<readonly [string, number | null]>((resolve) => {
      const audio = new Audio()
      audioElements.push(audio)
      const done = (duration: number | null) => resolve([asset.id, duration] as const)
      audio.preload = 'metadata'
      audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : null)
      audio.onerror = () => done(null)
      audio.src = asset.data
    }))).then((entries) => {
      if (alive) setMeasuredDurations(new Map(entries))
    })
    return () => {
      alive = false
      for (const audio of audioElements) {
        audio.onloadedmetadata = null
        audio.onerror = null
        audio.removeAttribute('src')
        audio.load()
      }
    }
  }, [store.project.assets])

  const addFiles = async (files: readonly File[]) => {
    const existing = new Set(useBuilderStore.getState().project.assets.map((asset) => asset.id))
    for (const file of files) {
      try {
        const asset = await fileToAsset(file, existing)
        existing.add(asset.id)
        useBuilderStore.getState().addAsset(asset)
      } catch (error) {
        dialogs.showMessage(t.dialog.errorTitle, String(error))
      }
    }
  }

  const elementSelection = store.selection.type === 'element' ? store.selection : null
  const selectedElement = elementSelection
    ? store.project.book.spreads.find((spread) => spread.id === elementSelection.spreadId)
      ?.elements.find((element) => element.id === elementSelection.elementId)
    : undefined

  const announceSelection = (label: string, select: () => void) => {
    select()
    setResult({
      ok: true,
      action: 'select',
      message: t.ai.selected(label),
      corrections: [],
      validation: { errors: store.issues.errors.length, warnings: store.issues.warnings.length },
    })
  }

  const place = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const side = data.get('side') === 'left' ? 'left' : 'right'
    setResult(placeAiAsset({
      spreadId: String(data.get('spreadId') ?? ''),
      side,
      assetId: String(data.get('assetId') ?? ''),
      presetId: String(data.get('presetId') ?? '') as typeof ASSET_PRESETS[number],
      u: parseFinite(data.get('u')),
      v: parseFinite(data.get('v')),
    }))
  }

  const update = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!elementSelection || !selectedElement) return
    const data = new FormData(event.currentTarget)
    const number = (name: string) => parseFinite(data.get(name))
    setResult(updateAiElement(elementSelection.spreadId, selectedElement.id, {
      name: String(data.get('name') ?? ''),
      position: [number('position-x'), number('position-y'), number('position-z')],
      rotation: [number('rotation-x'), number('rotation-y'), number('rotation-z')],
      scale: [number('scale-x'), number('scale-y'), number('scale-z')],
      layer: number('layer'),
      visible: data.get('visible') === 'on',
      opacity: number('opacity'),
      ...(visualElement(selectedElement) ? {
        width: number('width'),
        height: number('height'),
        text: String(data.get('text') ?? ''),
      } : {}),
    }))
  }

  const move = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!elementSelection || !selectedElement) return
    const parent = parseParent(String(new FormData(event.currentTarget).get('parent') ?? ''))
    setResult(parent
      ? moveAiElement(elementSelection.spreadId, selectedElement.id, parent)
      : { ok: false, action: 'move-element', message: t.ai.invalidInput, fieldErrors: { parent: t.ai.notFound } })
  }

  return <section className={`${st.panel} ${st.aiPanel}`} data-tobidas-ai-mode="true" aria-label={t.ai.panelTitle}>
    <div className={st.panelTitle}>{t.ai.panelTitle}</div>

    <details open>
      <summary>{t.ai.currentState}</summary>
      <dl className={st.aiSummary}>
        <Summary label={t.ai.project} value={summary.project.name} />
        <Summary label={t.ai.projectId} value={summary.project.id} />
        <Summary label={t.ai.source} value={summary.project.source} />
        <Summary label={t.ai.mode} value={readOnly ? t.ai.playMode : t.ai.editMode} />
        <Summary label={t.ai.activeSpread} value={summary.activeSpread?.name ?? ''} />
        <Summary label={t.ai.activeSpreadId} value={summary.activeSpread?.id ?? ''} />
        <Summary label={t.ai.selection} value={`${summary.selection.kind}: ${summary.selection.label}`} />
        <Summary label={t.ai.selectionId} value={summary.selection.id ?? ''} />
        <Summary label={t.ai.progress} value={summary.previewProgress.toFixed(4)} />
        <Summary label={t.ai.spreadTime} value={summary.spreadTime.toFixed(3)} />
        <Summary label={t.ai.undo} value={summary.canUndo ? t.ai.yes : t.ai.no} />
        <Summary label={t.ai.redo} value={summary.canRedo ? t.ai.yes : t.ai.no} />
      </dl>
      <div className={st.row}>
        <label htmlFor="ai-progress" className={st.rowLabel}>{t.ai.progress}</label>
        <input id="ai-progress" type="number" min="0" max="1" step="0.001" value={store.previewProgress}
          onChange={(event) => store.setPreviewProgress(Number(event.target.value))} />
      </div>
      <div className={st.aiButtonRow}>
        <button type="button" disabled={!summary.canUndo || readOnly} onClick={() => store.undo()}>{t.toolbar.undo}</button>
        <button type="button" disabled={!summary.canRedo || readOnly} onClick={() => store.redo()}>{t.toolbar.redo}</button>
        <button type="button" onClick={() => store.setMode(readOnly ? 'edit' : 'play')}>
          {readOnly ? t.toolbar.edit : t.toolbar.play}
        </button>
      </div>
    </details>

    <details open>
      <summary>{t.ai.lastResult}</summary>
      <div className={result?.ok === false ? st.err : result?.ok ? st.ok : st.hintSmall} aria-live="polite" aria-atomic="true">
        {result ? result.message : t.ai.noResult}
      </div>
      {result?.ok && <>
        {result.target && <div className={st.aiCode}>{result.target.kind}: {result.target.id}</div>}
        {result.corrections.map((correction) => <div key={correction} className={st.warn}>{correction}</div>)}
        <div>{t.ai.validationCounts(result.validation.errors, result.validation.warnings)}</div>
      </>}
      {result?.ok === false && Object.entries(result.fieldErrors).map(([field, message]) =>
        <div key={field} className={st.err}>{field}: {message}</div>)}
    </details>

    <details open>
      <summary>{t.ai.targets}</summary>
      <div className={st.aiTargetList} role="tree" aria-label={t.ai.targets}>
        <button type="button" role="treeitem" aria-selected={store.selection.type === 'book'}
          data-tobidas-kind="book" data-tobidas-id={store.project.id}
          onClick={() => announceSelection(store.project.name, () => store.select({ type: 'book' }))}>{t.ai.selectBook}</button>
        <button type="button" role="treeitem" aria-selected={store.selection.type === 'light'}
          data-tobidas-kind="light"
          onClick={() => announceSelection(t.properties.directionalLight, () => store.select({ type: 'light' }))}>{t.ai.selectLight}</button>
        {(['front', 'back'] as const).map((side) => <button type="button" role="treeitem" key={side}
          aria-selected={store.selection.type === 'cover' && store.selection.side === side}
          data-tobidas-kind="cover" data-tobidas-id={side}
          onClick={() => announceSelection(side, () => store.select({ type: 'cover', side }))}>{t.ai.selectCover(side)}</button>)}
        {store.project.book.spreads.map((spread) => <div key={spread.id} role="group">
          <button type="button" role="treeitem"
            aria-selected={store.selection.type === 'spread' && store.selection.spreadId === spread.id}
            data-tobidas-kind="spread" data-tobidas-id={spread.id}
            onClick={() => announceSelection(spread.name, () => store.select({ type: 'spread', spreadId: spread.id }))}>
            {t.ai.selectSpread(spread.name, spread.id)}
          </button>
          {(['left', 'right'] as const).map((side) => <button type="button" role="treeitem" key={side}
            aria-selected={store.selection.type === 'page' && store.selection.spreadId === spread.id && store.selection.side === side}
            data-tobidas-kind="page" data-tobidas-id={`${spread.id}:${side}`}
            onClick={() => announceSelection(`${spread.name} ${side}`, () => store.select({ type: 'page', spreadId: spread.id, side }))}>
            {t.ai.selectPage(side === 'left' ? t.ai.leftPage : t.ai.rightPage, spread.name)}
          </button>)}
          {spread.elements.map((element) => <button type="button" role="treeitem" key={element.id}
            aria-selected={store.selection.type === 'element' && store.selection.elementId === element.id}
            data-tobidas-kind="element" data-tobidas-id={element.id}
            onClick={() => announceSelection(element.name, () => store.select({ type: 'element', spreadId: spread.id, elementId: element.id }))}>
            {t.ai.selectElement(element.name, element.id)}
          </button>)}
        </div>)}
      </div>
    </details>

    <details open>
      <summary>{t.ai.placement}</summary>
      <fieldset disabled={readOnly}>
        <div className={st.aiAssetLoad}>
          <button type="button" onClick={() => assetInputRef.current?.click()}>{t.assets.load}</button>
          <span>{t.assets.formats}</span>
        </div>
        <input ref={assetInputRef} hidden multiple type="file" aria-label={t.assets.load}
          accept={assetAccept('svg', 'image', 'audio')}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            void addFiles(files)
          }} />
        <form onSubmit={place}>
          <AiSelect name="spreadId" label={t.ai.spread} defaultValue={activeSpreadId}
            options={store.project.book.spreads.map((spread) => [spread.id, `${spread.name} (${spread.id})`])} />
          <AiSelect name="side" label={t.ai.side} defaultValue="right"
            options={[["left", t.ai.leftPage], ["right", t.ai.rightPage]]} />
          <AiSelect name="presetId" label={t.ai.preset} defaultValue="bottom-upright"
            options={ASSET_PRESETS.map((id) => [id, t.presets[id]])} />
          <AiSelect name="assetId" label={t.ai.asset} defaultValue={imageAssets[0]?.id ?? ''}
            options={imageAssets.map((asset) => [asset.id, `${asset.name} (${asset.id})`])} />
          <AiNumber name="u" label={t.ai.normalizedU} value={0.5} min={0} max={1} step={0.01} />
          <AiNumber name="v" label={t.ai.normalizedV} value={0.5} min={0} max={1} step={0.01} />
          <button type="submit" disabled={!imageAssets.length}>{t.ai.place}</button>
        </form>
        <div className={st.aiButtonRow}>
          <button type="button" onClick={() => setResult(createAiVisual({ spreadId: activeSpreadId, side: 'right', presetId: 'page-text' }))}>{t.ai.createText}</button>
          <button type="button" onClick={() => setResult(createAiVisual({ spreadId: activeSpreadId, side: 'right', presetId: 'light-particles' }))}>{t.ai.createParticles}</button>
        </div>
      </fieldset>
    </details>

    <details open>
      <summary>{t.ai.selectedPart}</summary>
      {!selectedElement || !elementSelection ? <div className={st.hintSmall}>{t.ai.noElement}</div> : <>
        <div className={st.aiCode}>{t.ai.elementId}: {selectedElement.id}</div>
        <fieldset disabled={readOnly}>
          <form key={`${selectedElement.id}:${store.project.updatedAt}`} onSubmit={update}>
            <fieldset className={st.aiFieldGroup}>
              <legend>{t.ai.basic}</legend>
              <AiText name="name" label={t.ai.name} value={selectedElement.name} />
              <AiNumber name="layer" label={t.ai.layer} value={selectedElement.layer} step={1} />
              <div className={st.row}><label htmlFor="ai-visible" className={st.rowLabel}>{t.ai.visible}</label>
                <input id="ai-visible" name="visible" type="checkbox" defaultChecked={selectedElement.visible} /></div>
              <AiNumber name="opacity" label={t.ai.opacity} value={selectedElement.opacity} min={0} max={1} step={0.05} />
            </fieldset>
            {(['position', 'rotation', 'scale'] as const).map((group) => <fieldset className={st.aiFieldGroup} key={group}>
              <legend>{group === 'position' ? t.ai.position : group === 'rotation' ? t.ai.rotation : t.ai.scale}</legend>
              <div className={st.aiVectorGrid}>{selectedElement.baseTransform[group].map((value, index) => {
                const axis = ['X', 'Y', 'Z'][index]
                const label = group === 'position' ? t.ai.positionAxis(axis) : group === 'rotation' ? t.ai.rotationAxis(axis) : t.ai.scaleAxis(axis)
                return <AiNumber key={`${group}-${axis}`} name={`${group}-${axis.toLowerCase()}`} label={label} value={value} step={group === 'rotation' ? 1 : 0.1} />
              })}</div>
            </fieldset>)}
            {visualElement(selectedElement) && <fieldset className={st.aiFieldGroup}>
              <legend>{t.ai.content}</legend>
              <AiNumber name="width" label={t.ai.width} value={selectedElement.width} min={0.01} step="any" />
              <AiNumber name="height" label={t.ai.height} value={selectedElement.height} min={0.01} step="any" />
              <AiText name="text" label={t.ai.text} value={selectedElement.text} />
            </fieldset>}
            <button type="submit">{t.ai.apply}</button>
          </form>
          <form key={`parent:${selectedElement.id}:${store.project.updatedAt}`} onSubmit={move}>
            <AiSelect name="parent" label={t.ai.parent} defaultValue={parentValue(selectedElement.parent)} options={[
              ['left-page', t.ai.leftPage],
              ['right-page', t.ai.rightPage],
              ...store.project.book.spreads.find((spread) => spread.id === elementSelection.spreadId)!.elements
                .filter((element) => element.id !== selectedElement.id)
                .map((element) => [`element:${element.id}`, `${element.name} (${element.id})`] as [string, string]),
            ]} />
            <button type="submit">{t.ai.move}</button>
          </form>
          <button type="button" className={st.ghostDanger}
            onClick={() => requestElementDelete({ spreadId: elementSelection.spreadId, elementId: selectedElement.id })}>{t.ai.delete}</button>
        </fieldset>
      </>}
    </details>

    <details>
      <summary>{t.ai.assets}</summary>
      {!summary.assets.length ? <div className={st.hintSmall}>{t.ai.noAssets}</div> : <div className={st.aiTableWrap}>
        <table className={st.aiTable}>
          <thead><tr><th>{t.ai.asset}</th><th>{t.ai.type}</th><th>{t.ai.dimensions}</th><th>{t.ai.bytes}</th><th>{t.ai.references}</th></tr></thead>
          <tbody>{summary.assets.map((asset) => <tr key={asset.id} data-tobidas-kind="asset" data-tobidas-id={asset.id}>
            <td>{asset.name}<div className={st.aiCode}>{asset.id}</div><div>{asset.mime}</div></td>
            <td>{asset.type}</td>
            <td>{formatAssetExtent(asset, measuredDurations, t.ai.durationLoading, t.ai.durationUnavailable)}</td>
            <td>{asset.bytes ?? ''}</td>
            <td>{asset.references}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </details>

    <details open>
      <summary>{t.ai.validation}</summary>
      {!summary.validation.errors.length && !summary.validation.warnings.length && <div className={st.ok}>{t.ai.noIssues}</div>}
      {summary.validation.errors.map((issue, index) => <div className={st.err} key={`error-${index}`}>{issue}</div>)}
      {summary.validation.warnings.map((issue, index) => <div className={st.warn} key={`warning-${index}`}>{issue}</div>)}
    </details>
  </section>
}

function formatAssetExtent(
  asset: ReturnType<typeof buildAiStateSummary>['assets'][number],
  measuredDurations: ReadonlyMap<string, number | null>,
  loading: string,
  unavailable: string,
) {
  if (asset.width && asset.height) return `${asset.width}×${asset.height}`
  const duration = asset.duration ?? measuredDurations.get(asset.id)
  if (duration !== undefined && duration !== null) return `${duration.toFixed(2)}s`
  if (asset.type !== 'audio') return unavailable
  return measuredDurations.has(asset.id) ? unavailable : loading
}

function Summary({ label, value }: { label: string; value: string }) {
  return <><dt>{label}</dt><dd>{value}</dd></>
}

function AiText({ name, label, value }: { name: string; label: string; value: string }) {
  const id = `ai-${name}`
  return <div className={st.row}><label className={st.rowLabel} htmlFor={id}>{label}</label>
    <input id={id} name={name} defaultValue={value} /></div>
}

function AiNumber({ name, label, value, min, max, step }: {
  name: string
  label: string
  value: number
  min?: number
  max?: number
  step: number | 'any'
}) {
  const id = `ai-${name}`
  return <div className={st.row}><label className={st.rowLabel} htmlFor={id}>{label}</label>
    <input id={id} name={name} type="number" defaultValue={value} min={min} max={max} step={step} /></div>
}

function AiSelect({ name, label, defaultValue, options }: {
  name: string
  label: string
  defaultValue: string
  options: Array<readonly [string, string]>
}) {
  const id = `ai-${name}`
  return <div className={st.row}><label className={st.rowLabel} htmlFor={id}>{label}</label>
    <select id={id} name={name} defaultValue={defaultValue}>{options.map(([value, text]) =>
      <option key={value} value={value}>{text}</option>)}</select></div>
}
