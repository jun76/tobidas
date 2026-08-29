import { useEffect, useRef, useState, type FormEvent } from 'react'
import { assetAccept } from '../../package/model'
import { fileToAsset } from '../assets/ingest'
import { requestElementDelete, requestSpreadDelete } from '../elementDelete'
import { useT } from '../i18n'
import { BookProperties, SelectionDetails } from '../panels/Properties'
import type { VisualPresetId } from '../presets'
import { useBuilderStore } from '../store'
import { useDialogs } from '../ui/DialogProvider'
import st from '../builder.module.css'
import type { ContentMotion, TextFont, VisualElement } from '../../schema/stageElement'
import type { TimelineProperty, TimelineValue } from '../../schema/timeline'
import { TEXT_FONT_IDS } from '../../runtime/textStyle'
import { evaluateBookSignals } from '../../runtime/signals'
import {
  createAiVisual,
  addAiSpread,
  addAiTimelineKey,
  assignAiBgm,
  clearAiBgm,
  duplicateAiSpread,
  moveAiElement,
  moveAiSpread,
  parentValue,
  parseFinite,
  parseParent,
  placeAiAsset,
  updateAiElement,
  timelinePropertiesForTarget as commandTimelinePropertiesForTarget,
  redoAi,
  undoAi,
  visualElement,
} from './commands'
import { buildAiStateSummary } from './stateSummary'
import type { AiCommandResult } from './types'
import { DEFAULT_EMBEDDED_VIDEO_AUDIO, type EmbeddedVideoAudio } from '../../schema/audio'

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
  const imageAssets = summary.assets.filter((asset) => ['image', 'svg', 'video'].includes(asset.type))

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
      if (typeof asset.data === 'string') audio.src = asset.data
      else done(null)
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
  const selectedVideoFront = selectedElement?.type === 'visual'
    && store.project.assets.some((asset) => asset.id === selectedElement.image && asset.type === 'video')
  const selectedVideoBack = selectedElement?.type === 'visual'
    && store.project.assets.some((asset) => asset.id === selectedElement.backImage && asset.type === 'video')

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
    const videoAudio = (prefix: string): EmbeddedVideoAudio => ({
      enabled: data.get(`${prefix}-enabled`) === 'on',
      volume: number(`${prefix}-volume`),
      referenceDistance: number(`${prefix}-reference-distance`),
      rolloffFactor: number(`${prefix}-rolloff`),
    })
    const motionType = String(data.get('motion') ?? '')
    setResult(updateAiElement(elementSelection.spreadId, selectedElement.id, {
      name: String(data.get('name') ?? ''),
      position: [number('position-x'), number('position-y'), number('position-z')],
      rotation: [number('rotation-x'), number('rotation-y'), number('rotation-z')],
      scale: [number('scale-x'), number('scale-y'), number('scale-z')],
      pivot: [number('pivot-x'), number('pivot-y')],
      layer: number('layer'),
      visible: data.get('visible') === 'on',
      opacity: number('opacity'),
      motion: createMotion(motionType),
      ...(visualElement(selectedElement) ? {
        width: number('width'),
        height: number('height'),
        image: String(data.get('image') ?? '') || null,
        backImage: String(data.get('back-image') ?? '') || null,
        billboard: data.get('billboard') === 'on',
        backgroundColor: String(data.get('background-color') ?? ''),
        foregroundColor: String(data.get('foreground-color') ?? ''),
        text: String(data.get('text') ?? ''),
        fontSize: number('font-size'),
        font: String(data.get('font') ?? '') as VisualElement['font'],
        align: String(data.get('align') ?? '') as VisualElement['align'],
        bold: data.get('bold') === 'on',
        italic: data.get('italic') === 'on',
        underline: data.get('underline') === 'on',
        ...(selectedVideoFront ? { videoAudio: videoAudio('video-audio') } : {}),
        ...(selectedVideoBack ? { backVideoAudio: videoAudio('back-video-audio') } : {}),
      } : selectedElement.type === 'particle' ? {
        width: number('width'),
        height: number('height'),
        billboard: data.get('billboard') === 'on',
        particles: {
          color: String(data.get('particles-color') ?? ''),
          count: Math.round(number('particles-count')),
          size: number('particles-size'),
          drift: number('particles-drift'),
          period: number('particles-period'),
        },
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

  const requireEdit = (action: string) => {
    if (!readOnly) return true
    setResult({ ok: false, action, message: t.ai.readOnly, fieldErrors: {} })
    return false
  }

  const addSpread = () => {
    if (!requireEdit('add-spread')) return
    setResult(addAiSpread())
  }

  const duplicateSpread = () => {
    if (!requireEdit('duplicate-spread') || !activeSpreadId) return
    setResult(duplicateAiSpread(activeSpreadId))
  }

  const moveSpread = (direction: -1 | 1) => {
    if (!requireEdit(direction < 0 ? 'move-spread-earlier' : 'move-spread-later') || !activeSpreadId) return
    setResult(moveAiSpread(activeSpreadId, direction))
  }

  return <section className={`${st.panel} ${st.aiPanel}`} data-tobidas-ai-mode="true" data-tobidas-mode="ai" aria-label={t.ai.panelTitle}>
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
        <button type="button" data-tobidas-action="undo" disabled={!summary.canUndo || readOnly} onClick={() => setResult(undoAi())}>{t.toolbar.undo}</button>
        <button type="button" data-tobidas-action="redo" disabled={!summary.canRedo || readOnly} onClick={() => setResult(redoAi())}>{t.toolbar.redo}</button>
        <button type="button" data-tobidas-action={readOnly ? 'enter-edit-mode' : 'enter-play-mode'} onClick={() => store.setMode(readOnly ? 'edit' : 'play')}>
          {readOnly ? t.toolbar.edit : t.toolbar.play}
        </button>
      </div>
      <details>
        <summary>{t.ai.stateSnapshot}</summary>
        <pre className={st.aiCode} data-tobidas-kind="ai-state" data-tobidas-state-version="2"
          aria-label={t.ai.stateSnapshot}>{JSON.stringify(summary, null, 2)}</pre>
      </details>
    </details>

    <details open>
      <summary>{t.ai.lastResult}</summary>
      <div className={result?.ok === false ? st.err : result?.ok ? st.ok : st.hintSmall}
        data-tobidas-kind="ai-operation-result" aria-live="polite" aria-atomic="true">
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
      <summary>{t.ai.spreadActions}</summary>
      <div className={st.aiButtonRow} data-tobidas-kind="spread-actions">
        <button type="button" data-tobidas-action="add-spread" disabled={readOnly} onClick={addSpread}>{t.ai.addSpread}</button>
        <button type="button" data-tobidas-action="duplicate-spread" disabled={readOnly || !activeSpreadId}
          onClick={duplicateSpread}>{t.ai.duplicateSpread}</button>
        <button type="button" data-tobidas-action="move-spread-earlier" disabled={readOnly || !activeSpreadId || (summary.activeSpread?.index ?? 0) === 0}
          onClick={() => moveSpread(-1)}>{t.ai.moveSpreadEarlier}</button>
        <button type="button" data-tobidas-action="move-spread-later" disabled={readOnly || !activeSpreadId || (summary.activeSpread?.index ?? 0) === summary.spreads.length - 1}
          onClick={() => moveSpread(1)}>{t.ai.moveSpreadLater}</button>
        <button type="button" className={st.ghostDanger} data-tobidas-action="delete-spread"
          disabled={readOnly || summary.spreads.length < 2} title={summary.spreads.length < 2 ? t.ai.lastSpread : t.ai.deleteSpreadHint}
          onClick={() => activeSpreadId && requestSpreadDelete(activeSpreadId)}>{t.ai.deleteSpread}</button>
      </div>
    </details>

    <details open>
      <summary>{t.ai.timeline}</summary>
      <AiTimelineEditor
        key={`timeline:${activeSpreadId}`}
        spreadId={activeSpreadId}
        defaultTarget={store.selection.type === 'element' ? `element:${store.selection.elementId}` : 'environment'}
        readOnly={readOnly}
        onResult={setResult}
      />
    </details>

    {store.selection.type !== 'element' && <details open>
      <summary>{t.ai.standardProperties}</summary>
      {store.selection.type === 'book' ? <BookProperties /> : <SelectionDetails />}
    </details>}

    <details open>
      <summary>{t.ai.targets}</summary>
      <div className={st.aiTargetList} role="tree" aria-label={t.ai.targets} data-tobidas-kind="target-tree">
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
          accept={assetAccept('svg', 'image', 'audio', 'video')}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            void addFiles(files)
          }} />
        <form onSubmit={place} data-tobidas-kind="place-asset-form" {...{
          toolname: 'tobidas-place-asset-form',
          tooldescription: 'Place an already imported tobidas image, SVG, or video after reviewing the form values.',
        }}>
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
          <button type="submit" data-tobidas-action="place-asset" disabled={!imageAssets.length}>{t.ai.place}</button>
        </form>
        <div className={st.aiButtonRow}>
          <button type="button" data-tobidas-action="create-text" onClick={() => setResult(createAiVisual({ spreadId: activeSpreadId, side: 'right', presetId: 'page-text' }))}>{t.ai.createText}</button>
          <button type="button" data-tobidas-action="create-particles" onClick={() => setResult(createAiVisual({ spreadId: activeSpreadId, side: 'right', presetId: 'light-particles' }))}>{t.ai.createParticles}</button>
        </div>
        <AiBgmEditor readOnly={readOnly} onResult={setResult} />
      </fieldset>
    </details>

    <details open>
      <summary>{t.ai.selectedPart}</summary>
      {!selectedElement || !elementSelection ? <div className={st.hintSmall}>{t.ai.noElement}</div> : <>
        <div className={st.aiCode}>{t.ai.elementId}: {selectedElement.id}</div>
        <fieldset disabled={readOnly}>
          <form key={`${selectedElement.id}:${store.project.updatedAt}`} onSubmit={update} data-tobidas-kind="element-update-form">
            <fieldset className={st.aiFieldGroup}>
              <legend>{t.ai.basic}</legend>
              <AiText name="name" label={t.ai.name} value={selectedElement.name} />
              <AiNumber name="pivot-x" label={t.properties.pivotX} value={selectedElement.pivot[0]} step="any" />
              <AiNumber name="pivot-y" label={t.properties.pivotY} value={selectedElement.pivot[1]} step="any" />
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
            <fieldset className={st.aiFieldGroup}>
              <legend>{t.properties.motion}</legend>
              <AiSelect name="motion" label={t.properties.motion} defaultValue={selectedElement.motion[0]?.type ?? ''}
                options={[
                  ['', t.properties.motionNone], ['bob', t.properties.motionBob], ['sway', t.properties.motionSway],
                  ['drift', t.properties.motionDrift], ['spin', t.properties.motionSpin], ['pulse', t.properties.motionPulse],
                ]} />
            </fieldset>
            {visualElement(selectedElement) && <>
              <fieldset className={st.aiFieldGroup}>
                <legend>{t.ai.content}</legend>
                <AiSelect name="image" label={t.properties.image} defaultValue={selectedElement.image ?? ''}
                  options={[['', t.properties.unset], ...imageAssets.map((asset) => [asset.id, `${asset.name} (${asset.id})`] as [string, string])]} />
                <AiSelect name="back-image" label={t.properties.backImage} defaultValue={selectedElement.backImage ?? ''}
                  options={[['', t.properties.unset], ...imageAssets.map((asset) => [asset.id, `${asset.name} (${asset.id})`] as [string, string])]} />
                <AiNumber name="width" label={t.ai.width} value={selectedElement.width} min={0.01} step="any" />
                <AiNumber name="height" label={t.ai.height} value={selectedElement.height} min={0.01} step="any" />
                <div className={st.row}><label htmlFor="ai-billboard" className={st.rowLabel}>{t.properties.billboard}</label>
                  <input id="ai-billboard" name="billboard" type="checkbox" defaultChecked={selectedElement.billboard} /></div>
                <AiText name="background-color" label={t.properties.backgroundColor} value={selectedElement.backgroundColor} />
                <AiText name="foreground-color" label={t.properties.textColor} value={selectedElement.foregroundColor} />
              </fieldset>
              <fieldset className={st.aiFieldGroup}>
                <legend>{t.properties.text}</legend>
                <AiText name="text" label={t.ai.text} value={selectedElement.text} />
                <AiSelect name="font" label={t.properties.font} defaultValue={selectedElement.font}
                  options={TEXT_FONT_IDS.map((id) => [id, t.properties[fontLabel(id)]] as [string, string])} />
                <AiNumber name="font-size" label={t.properties.fontSize} value={selectedElement.fontSize} min={0.02} step="any" />
                <AiSelect name="align" label={t.properties.align} defaultValue={selectedElement.align}
                  options={[
                    ['left', t.properties.alignLeft], ['center', t.properties.alignCenter], ['right', t.properties.alignRight],
                  ]} />
                {(['bold', 'italic', 'underline'] as const).map((key) => <div className={st.row} key={key}>
                  <label className={st.rowLabel} htmlFor={`ai-${key}`}>{t.properties[key]}</label>
                  <input id={`ai-${key}`} name={key} type="checkbox" defaultChecked={selectedElement[key]} />
                </div>)}
              </fieldset>
            </>}
            {selectedElement.type === 'particle' && <fieldset className={st.aiFieldGroup}>
              <legend>{t.presets['light-particles']}</legend>
              <AiNumber name="width" label={t.ai.width} value={selectedElement.width} min={0.01} step="any" />
              <AiNumber name="height" label={t.ai.height} value={selectedElement.height} min={0.01} step="any" />
              <div className={st.row}><label htmlFor="ai-billboard" className={st.rowLabel}>{t.properties.billboard}</label>
                <input id="ai-billboard" name="billboard" type="checkbox" defaultChecked={selectedElement.billboard} /></div>
              <AiText name="particles-color" label={t.properties.effectColor} value={selectedElement.particles.color} />
              <AiNumber name="particles-count" label={t.properties.particleCount} value={selectedElement.particles.count} min={1} max={200} step={1} />
              <AiNumber name="particles-size" label={t.properties.effectSize} value={selectedElement.particles.size} min={0.01} step="any" />
              <AiNumber name="particles-drift" label={t.properties.particleDrift} value={selectedElement.particles.drift} min={0} step="any" />
              <AiNumber name="particles-period" label={t.properties.particlePeriod} value={selectedElement.particles.period} min={0.01} step="any" />
            </fieldset>}
            {selectedElement.type === 'visual' && selectedVideoFront
              && <AiVideoAudio prefix="video-audio" settings={selectedElement.videoAudio} label={t.properties.image} />}
            {selectedElement.type === 'visual' && selectedVideoBack
              && <AiVideoAudio prefix="back-video-audio" settings={selectedElement.backVideoAudio} label={t.properties.backImage} />}
            <button type="submit" data-tobidas-action="update-element">{t.ai.apply}</button>
          </form>
          <form key={`parent:${selectedElement.id}:${store.project.updatedAt}`} onSubmit={move}>
            <AiSelect name="parent" label={t.ai.parent} defaultValue={parentValue(selectedElement.parent)} options={[
              ['left-page', t.ai.leftPage],
              ['right-page', t.ai.rightPage],
              ...store.project.book.spreads.find((spread) => spread.id === elementSelection.spreadId)!.elements
                .filter((element) => element.id !== selectedElement.id)
                .map((element) => [`element:${element.id}`, `${element.name} (${element.id})`] as [string, string]),
            ]} />
            <button type="submit" data-tobidas-action="move-element">{t.ai.move}</button>
          </form>
          <button type="button" className={st.ghostDanger} data-tobidas-action="delete-element"
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

function AiTimelineEditor({ spreadId, defaultTarget, readOnly, onResult }: {
  spreadId: string
  defaultTarget: string
  readOnly: boolean
  onResult: (result: AiCommandResult) => void
}) {
  const t = useT()
  const store = useBuilderStore()
  const spread = store.project.book.spreads.find((item) => item.id === spreadId)
  const [target, setTarget] = useState(defaultTarget)
  const [property, setProperty] = useState<TimelineProperty>(() => timelinePropertiesForTarget(defaultTarget)[0])
  const [time, setTime] = useState(() => {
    const index = store.project.book.spreads.findIndex((item) => item.id === spreadId)
    return evaluateBookSignals(store.project.book, store.previewProgress).spreadTimes[index] ?? 0
  })

  if (!spread) return <div className={st.hintSmall}>{t.ai.notFound}</div>
  const properties = timelinePropertiesForTarget(target)
  const targets = [
    ['environment', t.timeline.laneEnvironment] as const,
    ['camera', t.timeline.laneCamera] as const,
    ...spread.elements.map((element) => [`element:${element.id}`, `${element.name} (${element.id})`] as const),
    ...store.project.assets.filter((asset) => asset.type === 'audio')
      .map((asset) => [`sound:${asset.id}`, `${asset.name} (${asset.id})`] as const),
  ]
  const kind = timelineValueKind(property)
  const defaultValue = timelineDefaultValue(store, spreadId, target, property)

  const changeTarget = (value: string) => {
    setTarget(value)
    const next = timelinePropertiesForTarget(value)[0]
    setProperty(next)
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (readOnly) {
      onResult({ ok: false, action: 'add-timeline-key', message: t.ai.readOnly, fieldErrors: {} })
      return
    }
    const data = new FormData(event.currentTarget)
    const nextTime = Number(data.get('time'))
    const nextValue = parseTimelineValue(property, data.get('value'))
    const fieldErrors: Record<string, string> = {}
    if (!Number.isFinite(nextTime) || nextTime < 0 || nextTime > spread.sequence.holdSeconds) fieldErrors.time = t.ai.timelineTimeRange
    if (nextValue === undefined) fieldErrors.value = t.ai.invalidInput
    if (Object.keys(fieldErrors).length || nextValue === undefined) {
      onResult({ ok: false, action: 'add-timeline-key', message: t.ai.invalidInput, fieldErrors })
      return
    }
    const parsedTarget = parseTimelineTarget(target)
    if (!parsedTarget) {
      onResult({ ok: false, action: 'add-timeline-key', message: t.ai.notFound, fieldErrors: { target: t.ai.notFound } })
      return
    }
    if (!timelinePropertiesForTarget(target).includes(property)) {
      onResult({ ok: false, action: 'add-timeline-key', message: t.ai.invalidInput, fieldErrors: { property: t.ai.invalidInput } })
      return
    }
    if (parsedTarget.type === 'element' && !spread.elements.some((element) => element.id === parsedTarget.elementId)) {
      onResult({ ok: false, action: 'add-timeline-key', message: t.ai.notFound, fieldErrors: { target: t.ai.notFound } })
      return
    }
    if (parsedTarget.type === 'sound' && !store.project.assets.some((asset) => asset.id === parsedTarget.assetId && asset.type === 'audio')) {
      onResult({ ok: false, action: 'add-timeline-key', message: t.ai.notFound, fieldErrors: { target: t.ai.notFound } })
      return
    }
    if (property === 'visual.image' && (typeof nextValue !== 'string'
      || !store.project.assets.some((asset) => asset.id === nextValue && ['image', 'svg', 'video'].includes(asset.type)))) {
      onResult({ ok: false, action: 'add-timeline-key', message: t.ai.invalidInput, fieldErrors: { value: t.ai.notFound } })
      return
    }
    const result = addAiTimelineKey({ spreadId, target: parsedTarget, property, time: nextTime, value: nextValue })
    onResult(result)
    if (result.ok) setTime(nextTime)
  }

  return <form className={st.aiTimelineForm} data-tobidas-kind="ai-timeline-form" onSubmit={submit}>
    <div className={st.row}><label className={st.rowLabel} htmlFor="ai-timeline-target">{t.ai.timelineTarget}</label>
      <select id="ai-timeline-target" data-tobidas-kind="timeline-target" value={target} disabled={readOnly} onChange={(event) => changeTarget(event.target.value)}>
        {targets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
    <div className={st.row}><label className={st.rowLabel} htmlFor="ai-timeline-property">{t.ai.timelineProperty}</label>
      <select id="ai-timeline-property" data-tobidas-kind="timeline-property" value={property} disabled={readOnly}
        onChange={(event) => setProperty(event.target.value as TimelineProperty)}>
        {properties.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    </div>
    <AiNumber name="time" label={t.ai.timelineTime} value={time} min={0} max={spread.sequence.holdSeconds} step="any" />
    {kind === 'vec3'
      ? <AiText key={`timeline-value:${target}:${property}`} name="value" label={t.ai.timelineValue} value={Array.isArray(defaultValue) ? defaultValue.join(', ') : ''} />
      : kind === 'boolean'
        ? <AiSelect key={`timeline-value:${target}:${property}`} name="value" label={t.ai.timelineValue} defaultValue={defaultValue === true ? 'true' : 'false'} options={[["true", t.ai.yes], ["false", t.ai.no]]} />
        : <AiText key={`timeline-value:${target}:${property}`} name="value" label={t.ai.timelineValue} value={String(defaultValue ?? '')} />}
    <button type="submit" data-tobidas-action="add-timeline-key" disabled={readOnly}>{t.ai.addTimelineKey}</button>
    <div className={st.hintSmall}>{t.ai.timelineHint}</div>
  </form>
}

function AiBgmEditor({ readOnly, onResult }: {
  readOnly: boolean
  onResult: (result: AiCommandResult) => void
}) {
  const t = useT()
  const store = useBuilderStore()
  const audioAssets = store.project.assets.filter((asset) => asset.type === 'audio')
  const [assetId, setAssetId] = useState(store.project.audio?.bgmAsset ?? audioAssets[0]?.id ?? '')
  useEffect(() => {
    if (!audioAssets.some((asset) => asset.id === assetId)) setAssetId(store.project.audio?.bgmAsset ?? audioAssets[0]?.id ?? '')
  }, [assetId, audioAssets, store.project.audio?.bgmAsset])
  const assign = () => {
    const asset = audioAssets.find((item) => item.id === assetId)
    if (!asset) {
      onResult({ ok: false, action: 'assign-bgm', message: t.ai.notFound, fieldErrors: { asset: t.ai.notFound } })
      return
    }
    onResult(assignAiBgm(asset.id))
  }
  return <fieldset className={st.aiFieldGroup} data-tobidas-kind="bgm-editor">
    <legend>{t.properties.bgm}</legend>
    <div className={st.row}><label className={st.rowLabel} htmlFor="ai-bgm-asset">{t.properties.bgmAsset}</label>
      <select id="ai-bgm-asset" data-tobidas-kind="bgm-asset" value={assetId} disabled={readOnly || !audioAssets.length} onChange={(event) => setAssetId(event.target.value)}>
        {!audioAssets.length && <option value="">{t.ai.noAssets}</option>}
        {audioAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} ({asset.id})</option>)}
      </select>
    </div>
    <div className={st.aiButtonRow}>
      <button type="button" data-tobidas-action="assign-bgm" disabled={readOnly || !audioAssets.length} onClick={assign}>{t.ai.assignBgm}</button>
      <button type="button" data-tobidas-action="clear-bgm" disabled={readOnly || !store.project.audio}
        onClick={() => onResult(clearAiBgm())}>{t.properties.clearBgm}</button>
    </div>
  </fieldset>
}

function timelinePropertiesForTarget(target: string): readonly TimelineProperty[] {
  const parsed = parseTimelineTarget(target)
  return parsed ? commandTimelinePropertiesForTarget(parsed) : []
}

function timelineValueKind(property: TimelineProperty): 'number' | 'string' | 'boolean' | 'vec3' {
  if (property === 'visible' || property === 'cue') return 'boolean'
  if (property === 'position' || property === 'target') return 'vec3'
  if (property === 'visual.image' || property.includes('color') || property === 'background') return 'string'
  return 'number'
}

function timelineDefaultValue(store: ReturnType<typeof useBuilderStore.getState>, spreadId: string, target: string, property: TimelineProperty): TimelineValue {
  const spread = store.project.book.spreads.find((item) => item.id === spreadId)
  const existing = spread?.timeline.tracks.find((track) => {
    const targetKey = track.target.type === 'element' ? `element:${track.target.elementId}`
      : track.target.type === 'sound' ? `sound:${track.target.assetId}` : track.target.type
    return targetKey === target && track.property === property
  })?.keys.at(-1)?.value
  if (existing !== undefined) return existing
  if (property === 'visible' || property === 'cue') return true
  if (property === 'position' || property === 'target') return [0, 0, 0]
  if (property.includes('color') || property === 'background' || property === 'visual.image') return property === 'visual.image' ? '' : '#ffffff'
  if (target.startsWith('element:')) {
    const element = spread?.elements.find((item) => item.id === target.slice('element:'.length))
    if (element) {
      if (property === 'opacity') return element.opacity
      if (property === 'visual.width' && (element.type === 'visual' || element.type === 'particle')) return element.width
      if (property === 'visual.height' && (element.type === 'visual' || element.type === 'particle')) return element.height
      if (property.startsWith('position.')) return element.baseTransform.position['xyz'.indexOf(property.at(-1)!)]
      if (property.startsWith('rotation.')) return element.baseTransform.rotation['xyz'.indexOf(property.at(-1)!)]
      if (property.startsWith('scale.')) return element.baseTransform.scale['xyz'.indexOf(property.at(-1)!)]
    }
  }
  return 0
}

function parseTimelineTarget(value: string): { type: 'element'; elementId: string } | { type: 'environment' } | { type: 'camera' } | { type: 'sound'; assetId: string } | null {
  if (value === 'environment') return { type: 'environment' }
  if (value === 'camera') return { type: 'camera' }
  if (value.startsWith('element:')) return { type: 'element', elementId: value.slice('element:'.length) }
  if (value.startsWith('sound:')) return { type: 'sound', assetId: value.slice('sound:'.length) }
  return null
}

function parseTimelineValue(property: TimelineProperty, value: FormDataEntryValue | null): TimelineValue | undefined {
  if (typeof value !== 'string') return undefined
  if (timelineValueKind(property) === 'boolean') return value === 'true' || value === 'on'
  if (timelineValueKind(property) === 'vec3') {
    const parts = value.split(',').map((part) => Number(part.trim()))
    return parts.length === 3 && parts.every(Number.isFinite) ? parts as [number, number, number] : undefined
  }
  if (timelineValueKind(property) === 'number') {
    const number = Number(value)
    return Number.isFinite(number) ? number : undefined
  }
  return value
}

function createMotion(type: string): ContentMotion[] {
  if (type === 'drift') return [{ type: 'drift', amplitude: [.25, .2, .25], period: 3, phase: 0 }]
  if (type === 'spin') return [{ type: 'spin', axis: 'y', speed: .8 }]
  if (type === 'sway') return [{ type: 'sway', amplitude: 5, period: 2.5, phase: 0 }]
  if (type === 'pulse') return [{ type: 'pulse', amplitude: .06, period: 2, phase: 0 }]
  if (type === 'bob') return [{ type: 'bob', amplitude: .18, period: 2.5, phase: 0 }]
  return []
}

function fontLabel(font: TextFont): 'fontRounded' | 'fontSans' | 'fontSerif' | 'fontMono' {
  return ({ rounded: 'fontRounded', sans: 'fontSans', serif: 'fontSerif', mono: 'fontMono' } as const)[font]
}

function AiVideoAudio({ prefix, settings, label }: {
  prefix: string
  settings?: EmbeddedVideoAudio
  label: string
}) {
  const t = useT()
  const value = settings ?? DEFAULT_EMBEDDED_VIDEO_AUDIO
  return <fieldset className={st.aiFieldGroup}>
    <legend>{t.properties.videoAudio} · {label}</legend>
    <div className={st.row}>
      <label className={st.rowLabel} htmlFor={`ai-${prefix}-enabled`}>{t.properties.videoAudioEnabled}</label>
      <input id={`ai-${prefix}-enabled`} name={`${prefix}-enabled`} type="checkbox"
        defaultChecked={settings?.enabled ?? DEFAULT_EMBEDDED_VIDEO_AUDIO.enabled} />
    </div>
    <AiNumber name={`${prefix}-volume`} label={t.properties.videoAudioVolume}
      value={value.volume} min={0} max={2} step={.05} />
    <AiNumber name={`${prefix}-reference-distance`} label={t.properties.videoAudioReferenceDistance}
      value={value.referenceDistance} min={.05} max={8} step={.05} />
    <AiNumber name={`${prefix}-rolloff`} label={t.properties.videoAudioRolloff}
      value={value.rolloffFactor} min={0} max={4} step={.05} />
  </fieldset>
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
