import { Diamond, Eye, EyeOff, Link } from 'lucide-react'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Icon } from '../../ui/Icon'
import type { ParticleElement, StageElement, TextFont, VisualElement } from '../../schema/stageElement'
import { DEFAULT_EMBEDDED_VIDEO_AUDIO, type EmbeddedVideoAudio } from '../../schema/audio'
import type { TimelineProperty, TimelineValue } from '../../schema/timeline'
import { evaluateBookSignals } from '../../runtime/signals'
import { useT } from '../i18n'
import { TEXT_FONT_IDS } from '../../runtime/textStyle'
import { hiddenKey, useBuilderStore } from '../store'
import { selectActiveSpread, selectSelectedElement, selectSpreadById } from '../state/selectors'
import { elementDescendantIds } from '../hierarchy'
import { moveElementCommand, parentValue } from '../operations/commands'
import { publishOperationResult } from '../operations/result'
import { FormDialog } from '../ui/FormDialog'
import st from '../builder.module.css'

/** 書体の名前も表示言語に従う。runtime 側は書体の対応表だけを持つ */
const FONT_LABEL_KEY: Record<TextFont, 'fontRounded' | 'fontSans' | 'fontSerif' | 'fontMono'> = {
  rounded: 'fontRounded',
  sans: 'fontSans',
  serif: 'fontSerif',
  mono: 'fontMono',
}

export function Inspector() {
  const t = useT()
  const store = useBuilderStore()
  const selection = store.selection
  const selectionLabel = selection.type === 'light'
    ? t.properties.directionalLight
    : selection.type === 'cover'
      ? (selection.side === 'front' ? t.properties.frontCover : t.properties.backCover)
      : selection.type === 'spread'
        ? (selectSpreadById(store, selection.spreadId)?.name ?? t.properties.spread)
        : selection.type === 'page'
          ? (selection.side === 'left' ? t.properties.leftPage : t.properties.rightPage)
          : selection.type === 'element'
            ? (selectSelectedElement(store)?.name ?? t.properties.element(''))
            : ''
  return <Panel title={t.app.panelInspector}>
    <div className={st.inspectorScopeTitle}>{t.app.inspectorProject}</div>
    <BookProperties embedded />
    {selection.type !== 'book' && <>
      <div className={st.inspectorScopeTitle}>{t.app.inspectorSelection(selectionLabel)}</div>
      <SelectionDetails embedded />
    </>}
  </Panel>
}

export function SelectionDetails({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useT()
  const store = useBuilderStore()
  const selection = store.selection
  const empty = <Panel title={t.app.panelDetail}>
    <div className={st.hintSmall}>{t.properties.empty}</div>
  </Panel>
  if (selection.type === 'book') return embedded ? null : empty
  if (selection.type === 'light') return <Light embedded={embedded} />
  if (selection.type === 'cover') return <Cover side={selection.side} embedded={embedded} />
  const spread = selectSpreadById(store, selection.spreadId)
  if (!spread) return embedded ? null : empty
  if (selection.type === 'spread') return <SpreadProperties embedded={embedded} />
  if (selection.type === 'page') return <Page side={selection.side} embedded={embedded} />
  const element = selectSelectedElement(store)
  return element ? <Element element={element} embedded={embedded} /> : embedded ? null : empty
}

export function BookProperties({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useT()
  const store = useBuilderStore()
  const book = store.project.book
  const spreadId = store.activeSpreadId
  const time = activeSpreadTime()
  const environmentKey = (property: TimelineProperty, value: TimelineValue) =>
    store.upsertTimelineKey(spreadId, { type: 'environment' }, property, time, value)
  return <PropertySection title="BOOK" embedded={embedded}>
    <InspectorGroup title={t.app.inspectorBasic}>
      <Text label={t.properties.bookName} value={store.project.name} onChange={(value) => store.commit((project) => { project.name = value })} />
      <Num label={t.properties.pageWidth} value={book.format.pageWidth} onChange={(value) => store.commit((project) => { project.book.format.pageWidth = value })} />
      <Num label={t.properties.pageAspect} value={book.format.pageAspect} onChange={(value) => store.commit((project) => { project.book.format.pageAspect = value })} />
      <Num label={t.properties.coverOpenSeconds} value={book.sequence.coverOpenSeconds} onChange={(value) => store.commit((project) => { project.book.sequence.coverOpenSeconds = Math.max(.1, value) })} />
    </InspectorGroup>
    <InspectorGroup title={t.app.inspectorStage}>
      <Color label={t.properties.background} value={book.appearance.background}
        onChange={(value) => store.commit((project) => { project.book.appearance.background = value })}
        onKey={() => environmentKey('background', book.appearance.background)} />
      <Asset label={t.properties.backgroundImage} value={book.appearance.backgroundAsset}
        onChange={(value) => store.commit((project) => {
          project.book.appearance.backgroundAsset = value || undefined
        })} />
      <VideoAudioFields assetId={book.appearance.backgroundAsset} settings={book.appearance.backgroundVideoAudio}
        positional={false} onChange={(settings) => store.commit((project) => {
          project.book.appearance.backgroundVideoAudio = settings
        })} />
      <Color label={t.properties.coverColor} value={book.appearance.coverColor ?? '#4f392c'}
        onChange={(value) => store.commit((project) => { project.book.appearance.coverColor = value })} />
      <Color label={t.properties.coverEdgeColor} value={book.appearance.coverEdgeColor ?? '#2d2019'}
        onChange={(value) => store.commit((project) => { project.book.appearance.coverEdgeColor = value })} />
    </InspectorGroup>
    <InspectorGroup title={t.app.inspectorSound}><BookAudio showTitle={false} /></InspectorGroup>
    <InspectorGroup title={t.app.inspectorCamera}>
      <div className={st.inspectorGroupTitle}><span>{t.properties.camera}</span><OverlayEye hiddenId={hiddenKey.camera} label={t.properties.cameraFrustum} /></div>
      <Vec3 label={t.properties.position} value={book.camera.position} onChange={(value) => store.commit((project) => { project.book.camera.position = value })} />
      <Vec3 label={t.properties.target} value={book.camera.target} onChange={(value) => store.commit((project) => { project.book.camera.target = value })} />
      <Num label={t.properties.fov} value={book.camera.fov} onChange={(value) => store.commit((project) => { project.book.camera.fov = Math.min(179, Math.max(1, value)) })} />
      <div className={st.cameraViewStatus}>{t.properties.cameraKeyHint}</div>
    </InspectorGroup>
    <InspectorGroup title={t.app.inspectorLighting}>
      <div className={st.inspectorGroupTitle}><span>{t.properties.lights}</span><OverlayEye hiddenId={hiddenKey.light} label={t.properties.lightMarker} /></div>
      <Color label={t.properties.ambientColor} value={book.lights.ambient.color}
        onChange={(value) => store.commit((project) => { project.book.lights.ambient.color = value })}
        onKey={() => environmentKey('ambient.color', book.lights.ambient.color)} />
      <Num label={t.properties.ambientIntensity} value={book.lights.ambient.intensity}
        onChange={(value) => store.commit((project) => { project.book.lights.ambient.intensity = Math.max(0, value) })}
        onKey={() => environmentKey('ambient.intensity', book.lights.ambient.intensity)} />
      <Color label={t.properties.directionalColor} value={book.lights.directional.color}
        onChange={(value) => store.commit((project) => { project.book.lights.directional.color = value })}
        onKey={() => environmentKey('directional.color', book.lights.directional.color)} />
      <Num label={t.properties.directionalIntensity} value={book.lights.directional.intensity}
        onChange={(value) => store.commit((project) => { project.book.lights.directional.intensity = Math.max(0, value) })}
        onKey={() => environmentKey('directional.intensity', book.lights.directional.intensity)} />
      <Vec3 label={t.properties.directionalPosition} value={book.lights.directional.position}
        onChange={(value) => store.commit((project) => { project.book.lights.directional.position = value })} />
    </InspectorGroup>
  </PropertySection>
}

function PropertySection({ title, embedded, children }: { title: string; embedded: boolean; children: ReactNode }) {
  return embedded ? <>{children}</> : <Panel title={title}>{children}</Panel>
}

function InspectorGroup({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <details className={st.inspectorGroup} open>
    <summary><span>{title}</span>{action}</summary>
    {children}
  </details>
}

/**
 * BGMは背景素材と同じく、登録済みアセットから直接選ぶ。
 * 未設定を選ぶとBGMだけを解除し、アセット自体は残す。
 */
function BookAudio({ showTitle = true }: { showTitle?: boolean } = {}) {
  const t = useT()
  const store = useBuilderStore()
  const audio = store.project.audio
  const audioAssets = store.project.assets.filter((asset) => asset.type === 'audio')
  const selected = audioAssets.some((asset) => asset.id === audio?.bgmAsset) ? audio?.bgmAsset ?? '' : ''
  return <>
    {showTitle && <div className={st.subsectionTitle}>{t.properties.bgm}</div>}
    <Select label={t.properties.bgmAsset} value={selected}
      options={[
        ['', t.properties.unset],
        ...audioAssets.map((asset) => [asset.id, audioAssetLabel(asset)] as [string, string]),
      ]}
      onChange={(assetId) => {
        if (!assetId) { store.clearBgm(); return }
        const asset = audioAssets.find((item) => item.id === assetId)
        if (asset) store.assignBgm(asset)
      }} />
    {audio && <>
      <Num label={t.properties.bgmVolume} value={audio.volume}
        onChange={(value) => store.commit((project) => {
          if (project.audio) project.audio.volume = Math.min(1, Math.max(0, value))
        })} />
    </>}
  </>
}

function Light({ embedded = false }: { embedded?: boolean }) {
  const t = useT()
  const store = useBuilderStore()
  const light = store.project.book.lights.directional
  return <PropertySection title={t.properties.directionalLight} embedded={embedded}>
    <InspectorGroup title={t.app.inspectorLighting}>
      <Color label={t.properties.color} value={light.color} onChange={(value) => store.commit((project) => { project.book.lights.directional.color = value })} />
      <Num label={t.properties.intensity} value={light.intensity} onChange={(value) => store.commit((project) => { project.book.lights.directional.intensity = Math.max(0, value) })} />
      <Vec3 label={t.properties.position} value={light.position} onChange={(value) => store.commit((project) => { project.book.lights.directional.position = value })} />
    </InspectorGroup>
  </PropertySection>
}

function Cover({ side, embedded = false }: { side: 'front' | 'back'; embedded?: boolean }) {
  const t = useT()
  const store = useBuilderStore()
  const cover = side === 'front' ? store.project.book.frontCover : store.project.book.backCover
  return <PropertySection title={side === 'front' ? t.properties.frontCover : t.properties.backCover} embedded={embedded}>
    <InspectorGroup title={t.app.inspectorSurface}>
      <Asset label={t.properties.coverFront} value={cover.frontAsset} onChange={(value) => store.commit((project) => {
        const target = side === 'front' ? project.book.frontCover : project.book.backCover
        target.frontAsset = value || undefined
      })} />
      <VideoAudioFields assetId={cover.frontAsset} settings={cover.frontVideoAudio}
        onChange={(settings) => store.commit((project) => {
          (side === 'front' ? project.book.frontCover : project.book.backCover).frontVideoAudio = settings
        })} />
      <Asset label={t.properties.coverBack} value={cover.backAsset} onChange={(value) => store.commit((project) => {
        const target = side === 'front' ? project.book.frontCover : project.book.backCover
        target.backAsset = value || undefined
      })} />
      <VideoAudioFields assetId={cover.backAsset} settings={cover.backVideoAudio}
        onChange={(settings) => store.commit((project) => {
          (side === 'front' ? project.book.frontCover : project.book.backCover).backVideoAudio = settings
        })} />
    </InspectorGroup>
  </PropertySection>
}

function SpreadProperties({ embedded = false }: { embedded?: boolean }) {
  const t = useT()
  const store = useBuilderStore()
  const id = store.activeSpreadId
  const spread = selectActiveSpread(store)!
  return <PropertySection title={t.properties.spread} embedded={embedded}>
    <InspectorGroup title={t.app.inspectorBasic}>
      <Text label={t.properties.name} value={spread.name} onChange={(value) => store.commit((project) => {
        project.book.spreads.find((item) => item.id === id)!.name = value
      })} />
      <Num label={t.properties.holdSeconds} value={spread.sequence.holdSeconds} onChange={(value) => store.commit((project) => {
        project.book.spreads.find((item) => item.id === id)!.sequence.holdSeconds = Math.max(.1, value)
      })} />
      <Num label={t.properties.turnSeconds} value={spread.sequence.turnSeconds} onChange={(value) => store.commit((project) => {
        project.book.spreads.find((item) => item.id === id)!.sequence.turnSeconds = Math.max(.1, value)
      })} />
      <div className={st.cameraViewStatus}>{t.properties.trackCount(spread.timeline.tracks.length)}</div>
    </InspectorGroup>
  </PropertySection>
}

function Page({ side, embedded = false }: { side: 'left' | 'right'; embedded?: boolean }) {
  const t = useT()
  const store = useBuilderStore()
  const id = store.activeSpreadId
  const page = selectActiveSpread(store)![side === 'left' ? 'leftPage' : 'rightPage']
  return <PropertySection title={side === 'left' ? t.properties.leftPage : t.properties.rightPage} embedded={embedded}>
    <InspectorGroup title={t.app.inspectorStage}>
      <Asset label={t.properties.pageBackground} value={page.backgroundAsset} onChange={(value) => store.commit((project) => {
        const target = project.book.spreads.find((item) => item.id === id)![side === 'left' ? 'leftPage' : 'rightPage']
        target.backgroundAsset = value || undefined
      })} />
      <VideoAudioFields assetId={page.backgroundAsset} settings={page.backgroundVideoAudio}
        onChange={(settings) => store.commit((project) => {
          project.book.spreads.find((item) => item.id === id)![side === 'left' ? 'leftPage' : 'rightPage']
            .backgroundVideoAudio = settings
        })} />
    </InspectorGroup>
  </PropertySection>
}

function Element({ element, embedded = false }: { element: StageElement; embedded?: boolean }) {
  const t = useT()
  const store = useBuilderStore()
  const selection = store.selection
  if (selection.type !== 'element') return null
  const update = (change: (item: StageElement) => void) => store.updateElement(selection.spreadId, element.id, change)
  const time = activeSpreadTime()
  const [parentDialogOpen, setParentDialogOpen] = useState(false)
  const key = (property: TimelineProperty, value: TimelineValue) =>
    store.upsertTimelineKey(selection.spreadId, { type: 'element', elementId: element.id }, property, time, value)

  return <PropertySection title={t.properties.element(element.type === 'particle' ? t.presets['light-particles'] : element.type)} embedded={embedded}>
    <InspectorGroup title={t.app.inspectorBasic} action={<button type="button" className={st.ghostBtn}
      data-tobidas-action="change-element-parent" aria-label={t.properties.changeParent}
      title={t.properties.changeParentHint} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setParentDialogOpen(true) }}>
      <Icon as={Link} />
    </button>}>
      <Text label={t.properties.name} value={element.name} onChange={(value) => update((item) => { item.name = value })} />
      <Num label={t.properties.layer} value={element.layer} onChange={(value) => update((item) => { item.layer = Math.round(value) })} />
      <div className={st.row}><span className={st.rowLabel}>{t.properties.visible}</span><label>
        <input type="checkbox" aria-label={t.properties.visible} checked={element.visible} onChange={(event) => update((item) => { item.visible = event.target.checked })} />
        {element.visible ? t.properties.visibleOn : t.properties.visibleOff}
      </label><KeyButton label={t.properties.visible} onKey={() => key('visible', element.visible)} /></div>
      <Num label={t.properties.opacity} value={element.opacity} onChange={(value) => update((item) => {
        item.opacity = Math.min(1, Math.max(0, value))
      })} onKey={() => key('opacity', element.opacity)} />
    </InspectorGroup>
    <InspectorGroup title={t.app.inspectorTransform}>
      <Transform value={element} update={update} onKey={key} />
      <Num label={t.properties.pivotX} value={element.pivot[0]} onChange={(value) => update((item) => { item.pivot = [value, item.pivot[1]] })} />
      <Num label={t.properties.pivotY} value={element.pivot[1]} onChange={(value) => update((item) => { item.pivot = [item.pivot[0], value] })} />
    </InspectorGroup>
    {element.type !== 'group' && <InspectorGroup title={t.app.inspectorContent}>
      {element.type === 'visual' && <VisualFields element={element} update={update} onKey={key} />}
      {element.type === 'particle' && <ParticleFields element={element} update={update} onKey={key} />}
    </InspectorGroup>}
    <InspectorGroup title={t.app.inspectorMotion}>
      <Select label={t.properties.motion} value={element.motion[0]?.type ?? ''} options={[
        ['', t.properties.motionNone], ['bob', t.properties.motionBob], ['sway', t.properties.motionSway],
        ['drift', t.properties.motionDrift], ['spin', t.properties.motionSpin], ['pulse', t.properties.motionPulse],
      ]} onChange={(value) => update((item) => {
        item.motion = value
          ? [value === 'drift' ? { type: 'drift', amplitude: [.25, .2, .25], period: 3, phase: 0 }
            : value === 'spin' ? { type: 'spin', axis: 'y', speed: .8 }
              : value === 'sway' ? { type: 'sway', amplitude: 5, period: 2.5, phase: 0 }
                : value === 'pulse' ? { type: 'pulse', amplitude: .06, period: 2, phase: 0 }
                  : { type: 'bob', amplitude: .18, period: 2.5, phase: 0 }]
          : []
      })} />
    </InspectorGroup>
    {parentDialogOpen && <ParentChangeDialog spreadId={selection.spreadId} element={element}
      onClose={() => setParentDialogOpen(false)} />}
  </PropertySection>
}

function ParentChangeDialog({ spreadId, element, onClose }: { spreadId: string; element: StageElement; onClose: () => void }) {
  const t = useT()
  const store = useBuilderStore()
  const spread = store.project.book.spreads.find((item) => item.id === spreadId)
  const descendants = spread ? elementDescendantIds(spread, element.id) : new Set<string>()
  const candidates = spread?.elements.filter((item) => item.id !== element.id && !descendants.has(item.id)) ?? []
  const [parent, setParent] = useState(parentValue(element.parent))
  const [error, setError] = useState<string>()
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const next = parent === 'left-page' || parent === 'right-page'
      ? { type: parent } as const
      : { type: 'element' as const, elementId: parent.slice('element:'.length) }
    const result = publishOperationResult(moveElementCommand(spreadId, element.id, next))
    if (!result.ok) { setError(result.message); return }
    onClose()
  }
  return <FormDialog title={t.properties.changeParent} submitLabel={t.properties.changeParent}
    kind="element-parent-form" error={error} onSubmit={submit} onClose={onClose}>
    <label className={st.dialogField}>{t.operations.parent}<select autoFocus value={parent} onChange={(event) => setParent(event.target.value)}>
      <option value="left-page">{t.operations.leftPage}</option>
      <option value="right-page">{t.operations.rightPage}</option>
      {candidates.map((item) => <option key={item.id} value={`element:${item.id}`}>{item.name}</option>)}
    </select></label>
  </FormDialog>
}

/**
 * 文字の内容と体裁。
 *
 * 箱 (width/height) は入力させず、内容と体裁から毎回導く。テクスチャは箱いっぱいへ
 * 引き伸ばして貼られるので、箱を手で決められると字が縦横に歪む。歪ませない寸法は
 * runtime/textStyle.ts が一手に持つ。
 */
function TextStyleFields({ element, update }: {
  element: VisualElement
  update: (change: (item: StageElement) => void) => void
}) {
  const t = useT()
  const edit = (change: (item: VisualElement) => void) => update((item) => {
    if (item.type !== 'visual') return
    change(item)
  })
  const toggle = (label: string, key: 'bold' | 'italic' | 'underline') =>
    <div className={st.row} key={key}><span className={st.rowLabel}>{label}</span><label>
      <input type="checkbox" aria-label={label} checked={element[key]} onChange={(event) => edit((item) => {
        item[key] = event.target.checked
      })} />
    </label></div>

  return <>
    <div className={st.subsectionTitle}>{t.properties.text}</div>
    <Text label={t.properties.textBody} value={element.text} onChange={(value) => edit((item) => { item.text = value })} />
    <Select label={t.properties.font} value={element.font}
      options={TEXT_FONT_IDS.map((id) => [id, t.properties[FONT_LABEL_KEY[id]]] as [string, string])}
      onChange={(value) => edit((item) => { item.font = value as TextFont })} />
    <Num label={t.properties.fontSize} value={element.fontSize} onChange={(value) => edit((item) => {
      item.fontSize = Math.max(.02, value)
    })} />
    <Color label={t.properties.textColor} value={element.foregroundColor} onChange={(value) => edit((item) => { item.foregroundColor = value })} />
    <Select label={t.properties.align} value={element.align}
      options={[['left', t.properties.alignLeft], ['center', t.properties.alignCenter], ['right', t.properties.alignRight]]}
      onChange={(value) => edit((item) => { item.align = value as VisualElement['align'] })} />
    {toggle(t.properties.bold, 'bold')}
    {toggle(t.properties.italic, 'italic')}
    {toggle(t.properties.underline, 'underline')}
  </>
}

function activeSpreadTime(): number {
  const state = useBuilderStore.getState()
  const index = state.project.book.spreads.findIndex((spread) => spread.id === state.activeSpreadId)
  return index < 0 ? 0 : evaluateBookSignals(state.project.book, state.previewProgress).spreadTimes[index]
}

function Transform({ value, update, onKey }: {
  value: StageElement
  update: (change: (element: StageElement) => void) => void
  onKey: (property: TimelineProperty, value: TimelineValue) => void
}) {
  const t = useT()
  return <>{(['position', 'rotation', 'scale'] as const).map((group) =>
    <div className={st.row} key={group}>
      <span className={st.rowLabel}>{group}</span>
      <div className={st.vec3}>{value.baseTransform[group].map((part, index) =>
        <input key={index} type="number" aria-label={`${group} ${['X', 'Y', 'Z'][index]}`}
          step={group === 'rotation' ? 1 : .1} value={part}
          onChange={(event) => update((element) => {
            element.baseTransform[group][index as 0 | 1 | 2] = Number(event.target.value)
          })} />)}
      </div>
      <button className={st.keyButton}
        aria-label={t.properties.addKey(group)} title={t.properties.addKeyVec3Hint(group)}
        onClick={() => {
          value.baseTransform[group].forEach((part, index) =>
            onKey(`${group}.${['x', 'y', 'z'][index]}` as TimelineProperty, part))
        }}><Icon as={Diamond} size={13} fill="currentColor" /></button>
    </div>)}</>
}

function Vec3({ label, value, onChange, step = .1 }: {
  label: string
  value: [number, number, number]
  onChange: (value: [number, number, number]) => void
  step?: number
}) {
  return <div className={st.row}><span className={st.rowLabel}>{label}</span><div className={st.vec3}>
    {value.map((part, index) => <input key={index} type="number" aria-label={`${label} ${['X', 'Y', 'Z'][index]}`}
      step={step} value={part} onChange={(event) => {
      const next = [...value] as [number, number, number]
      next[index] = Number(event.target.value)
      onChange(next)
    }} />)}
  </div></div>
}

function Asset({ label, value, onChange, onKey }: { label: string; value?: string; onChange: (value: string) => void; onKey?: () => void }) {
  const t = useT()
  const assets = useBuilderStore((state) => state.project.assets)
    .filter((asset) => ['image', 'svg', 'video'].includes(asset.type))
  return <Select label={label} value={value ?? ''} options={[['', t.properties.unset], ...assets.map((asset) => [asset.id, asset.name] as [string, string])]}
    onChange={onChange} onKey={onKey} />
}

function VisualFields({ element, update, onKey }: {
  element: VisualElement
  update: (change: (item: StageElement) => void) => void
  onKey: (property: TimelineProperty, value: TimelineValue) => void
}) {
  const t = useT()
  return <>
    <Asset label={t.properties.image} value={element.image} onChange={(value) => update((item) => {
      if (item.type !== 'visual') return
      item.image = value || undefined
    })} onKey={() => onKey('visual.image', element.image ?? '')} />
    <VideoAudioFields assetId={element.image} settings={element.videoAudio}
      onChange={(settings) => update((item) => { if (item.type === 'visual') item.videoAudio = settings })} />
    <Asset label={t.properties.backImage} value={element.backImage} onChange={(value) => update((item) => {
      if (item.type !== 'visual') return
      item.backImage = value || undefined
    })} />
    <VideoAudioFields assetId={element.backImage} settings={element.backVideoAudio}
      onChange={(settings) => update((item) => { if (item.type === 'visual') item.backVideoAudio = settings })} />
    <Num label={t.properties.width} value={element.width} onChange={(value) => update((item) => { if (item.type === 'visual') item.width = Math.max(.01, value) })} />
    <Num label={t.properties.height} value={element.height} onChange={(value) => update((item) => { if (item.type === 'visual') item.height = Math.max(.01, value) })} />
    <label><input type="checkbox" aria-label={t.properties.billboard} checked={element.billboard} onChange={(event) => update((item) => {
      if (item.type === 'visual') item.billboard = event.target.checked
    })} /> {t.properties.billboard}</label>
    <Text label={t.properties.backgroundColor} value={element.backgroundColor} onChange={(value) => update((item) => {
      if (item.type === 'visual') item.backgroundColor = value
    })} />
    <TextStyleFields element={element} update={update} />
  </>
}

function audioAssetLabel(asset: { id: string; name: string }): string {
  const fileName = asset.id.split(/[\\/]/).at(-1) ?? asset.id
  return /\.[^.]+$/.test(fileName) ? fileName : asset.name
}

function ParticleFields({ element, update, onKey }: {
  element: ParticleElement
  update: (change: (item: StageElement) => void) => void
  onKey: (property: TimelineProperty, value: TimelineValue) => void
}) {
  const t = useT()
  return <>
    <div className={st.subsectionTitle}>{t.presets['light-particles']}</div>
    <Num label={t.properties.width} value={element.width} onChange={(value) => update((item) => { if (item.type === 'particle') item.width = Math.max(.01, value) })} />
    <Num label={t.properties.height} value={element.height} onChange={(value) => update((item) => { if (item.type === 'particle') item.height = Math.max(.01, value) })} />
    <label><input type="checkbox" aria-label={t.properties.billboard} checked={element.billboard} onChange={(event) => update((item) => {
      if (item.type === 'particle') item.billboard = event.target.checked
    })} /> {t.properties.billboard}</label>
    <Color label={t.properties.effectColor} value={element.particles.color} onChange={(value) => update((item) => {
      if (item.type === 'particle') item.particles.color = value
    })} onKey={() => onKey('visual.particles.color', element.particles.color)} />
    <Num label={t.properties.effectSize} value={element.particles.size} onChange={(value) => update((item) => {
      if (item.type === 'particle') item.particles.size = Math.max(.01, value)
    })} onKey={() => onKey('visual.particles.size', element.particles.size)} />
    <Num label={t.properties.particleCount} value={element.particles.count} onChange={(value) => update((item) => {
      if (item.type === 'particle') item.particles.count = Math.min(200, Math.max(1, Math.round(value)))
    })} />
    <Num label={t.properties.particleDrift} value={element.particles.drift} onChange={(value) => update((item) => {
      if (item.type === 'particle') item.particles.drift = Math.max(0, value)
    })} />
    <Num label={t.properties.particlePeriod} value={element.particles.period} onChange={(value) => update((item) => {
      if (item.type === 'particle') item.particles.period = Math.max(.01, value)
    })} />
  </>
}

function VideoAudioFields({ assetId, settings, onChange, positional = true }: {
  assetId?: string
  settings?: EmbeddedVideoAudio
  onChange: (settings: EmbeddedVideoAudio | undefined) => void
  positional?: boolean
}) {
  const t = useT()
  const isVideo = useBuilderStore((state) => state.project.assets
    .some((asset) => asset.id === assetId && asset.type === 'video'))
  if (!isVideo) return null
  const current = settings ?? DEFAULT_EMBEDDED_VIDEO_AUDIO
  return <>
    <div className={st.subsectionTitle}>{t.properties.videoAudio}</div>
    {!positional && <div className={st.hintSmall}>{t.properties.videoAudioGlobal}</div>}
    <label><input type="checkbox" aria-label={t.properties.videoAudioEnabled} checked={settings?.enabled ?? DEFAULT_EMBEDDED_VIDEO_AUDIO.enabled}
      onChange={(event) => onChange({ ...DEFAULT_EMBEDDED_VIDEO_AUDIO, enabled: event.target.checked })} />
      {' '}{t.properties.videoAudioEnabled}</label>
    {(settings?.enabled ?? DEFAULT_EMBEDDED_VIDEO_AUDIO.enabled) && <>
      <Num label={t.properties.videoAudioVolume} value={current.volume}
        onChange={(value) => onChange({ ...current, volume: Math.min(2, Math.max(0, value)), enabled: true })} />
      {positional && <>
        <Num label={t.properties.videoAudioReferenceDistance} value={current.referenceDistance}
          onChange={(value) => onChange({ ...current, referenceDistance: Math.min(8, Math.max(.05, value)), enabled: true })} />
        <Num label={t.properties.videoAudioRolloff} value={current.rolloffFactor}
          onChange={(value) => onChange({ ...current, rolloffFactor: Math.min(4, Math.max(0, value)), enabled: true })} />
      </>}
    </>}
  </>
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className={st.panel} aria-label={title}><div className={st.panelTitle}>{title}</div>{children}</section>
}

function Text({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId()
  return <div className={st.row}><label className={st.rowLabel} htmlFor={id}>{label}</label>
    <input id={id} value={value} onChange={(event) => onChange(event.target.value)} /></div>
}

/** 編集ビューの補助表示(カメラの錐台・光源のマーカー)の表示切り替え */
function OverlayEye({ hiddenId, label }: { hiddenId: string; label: string }) {
  const t = useT()
  const hidden = useBuilderStore((state) => state.hidden.has(hiddenId))
  const toggleHidden = useBuilderStore((state) => state.toggleHidden)
  return <button className={`${st.ghostBtn} ${hidden ? st.ghostOn : ''}`}
    aria-label={t.properties.overlayVisibility(label)} aria-pressed={!hidden}
    title={hidden ? t.properties.overlayShow(label) : t.properties.overlayHide(label)}
    onClick={() => toggleHidden(hiddenId)}><Icon as={hidden ? EyeOff : Eye} /></button>
}

/** 現在時刻へキーを打つ菱形。何のキーかはホバーで示す */
function KeyButton({ label, onKey }: { label: string; onKey: () => void }) {
  const t = useT()
  return <button className={st.keyButton}
    aria-label={t.properties.addKey(label)} title={t.properties.addKeyHint(label)}
    onClick={onKey}><Icon as={Diamond} size={13} fill="currentColor" /></button>
}

function Num({ label, value, onChange, onKey }: { label: string; value: number; onChange: (value: number) => void; onKey?: () => void }) {
  const id = useId()
  return <div className={st.row}><label className={st.rowLabel} htmlFor={id}>{label}</label><input id={id} type="number" step=".1" value={value}
    onChange={(event) => onChange(Number(event.target.value))} />{onKey && <KeyButton label={label} onKey={onKey} />}</div>
}

function Color({ label, value, onChange, onKey }: { label: string; value: string; onChange: (value: string) => void; onKey?: () => void }) {
  const id = useId()
  return <div className={st.row}><label className={st.rowLabel} htmlFor={id}>{label}</label><input id={id} type="color" value={value}
    onChange={(event) => onChange(event.target.value)} />{onKey && <KeyButton label={label} onKey={onKey} />}</div>
}

function Select({ label, value, options, onChange, onKey }: {
  label: string
  value: string
  options: Array<[string, string]>
  onChange: (value: string) => void
  onKey?: () => void
}) {
  const id = useId()
  return <div className={st.row}><label className={st.rowLabel} htmlFor={id}>{label}</label><select id={id} value={value}
    onChange={(event) => onChange(event.target.value)}>{options.map(([option, text]) =>
      <option key={option} value={option}>{text}</option>)}</select>
    {onKey && <KeyButton label={label} onKey={onKey} />}
  </div>
}
