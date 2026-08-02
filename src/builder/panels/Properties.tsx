import { Diamond, Eye, EyeOff, Trash2 } from 'lucide-react'
import { Icon } from '../../ui/Icon'
import type { StageElement, TextElement, TextFont } from '../../schema/stageElement'
import type { TimelineProperty, TimelineValue } from '../../schema/timeline'
import { evaluateBookSignals } from '../../runtime/signals'
import { useT } from '../i18n'
import { measureTextBox, TEXT_FONT_IDS } from '../../runtime/textStyle'
import { presetForElement } from '../presets'
import { hiddenKey, useBuilderStore } from '../store'
import { selectActiveSpread, selectSelectedElement, selectSpreadById } from '../state/selectors'
import st from '../builder.module.css'

/** 書体の名前も表示言語に従う。runtime 側は書体の対応表だけを持つ */
const FONT_LABEL_KEY: Record<TextFont, 'fontRounded' | 'fontSans' | 'fontSerif' | 'fontMono'> = {
  rounded: 'fontRounded',
  sans: 'fontSans',
  serif: 'fontSerif',
  mono: 'fontMono',
}

export function SelectionDetails() {
  const t = useT()
  const store = useBuilderStore()
  const selection = store.selection
  const empty = <Panel title={t.app.panelDetail}>
    <div className={st.hintSmall}>{t.properties.empty}</div>
  </Panel>
  if (selection.type === 'book') return empty
  if (selection.type === 'light') return <Light />
  if (selection.type === 'cover') return <Cover side={selection.side} />
  const spread = selectSpreadById(store, selection.spreadId)
  if (!spread) return empty
  if (selection.type === 'spread') return <SpreadProperties />
  if (selection.type === 'page') return <Page side={selection.side} />
  const element = selectSelectedElement(store)
  return element ? <Element element={element} /> : empty
}

export function BookProperties() {
  const t = useT()
  const store = useBuilderStore()
  const book = store.project.book
  const spreadId = store.activeSpreadId
  const time = activeSpreadTime()
  const environmentKey = (property: TimelineProperty, value: TimelineValue) =>
    store.upsertTimelineKey(spreadId, { type: 'environment' }, property, time, value)
  return <Panel title="BOOK">
    <Text label={t.properties.bookName} value={store.project.name} onChange={(value) => store.commit((project) => { project.name = value })} />
    <Num label={t.properties.pageWidth} value={book.format.pageWidth} onChange={(value) => store.commit((project) => { project.book.format.pageWidth = value })} />
    <Num label={t.properties.pageAspect} value={book.format.pageAspect} onChange={(value) => store.commit((project) => { project.book.format.pageAspect = value })} />
    <Num label={t.properties.coverOpenSeconds} value={book.sequence.coverOpenSeconds} onChange={(value) => store.commit((project) => { project.book.sequence.coverOpenSeconds = Math.max(.1, value) })} />
    <Color label={t.properties.background} value={book.appearance.background}
      onChange={(value) => store.commit((project) => { project.book.appearance.background = value })}
      onKey={() => environmentKey('background', book.appearance.background)} />
    <Asset label={t.properties.backgroundImage} value={book.appearance.backgroundAsset}
      onChange={(value) => store.commit((project) => { project.book.appearance.backgroundAsset = value || undefined })} />
    <Color label={t.properties.coverColor} value={book.appearance.coverColor ?? '#4f392c'}
      onChange={(value) => store.commit((project) => { project.book.appearance.coverColor = value })} />
    <Color label={t.properties.coverEdgeColor} value={book.appearance.coverEdgeColor ?? '#2d2019'}
      onChange={(value) => store.commit((project) => { project.book.appearance.coverEdgeColor = value })} />
    <BookAudio />
    <div className={st.subsectionTitle}>{t.properties.camera}<OverlayEye hiddenId={hiddenKey.camera} label={t.properties.cameraFrustum} /></div>
    <Vec3 label={t.properties.position} value={book.camera.position} onChange={(value) => store.commit((project) => { project.book.camera.position = value })} />
    <Vec3 label={t.properties.target} value={book.camera.target} onChange={(value) => store.commit((project) => { project.book.camera.target = value })} />
    <Num label={t.properties.fov} value={book.camera.fov} onChange={(value) => store.commit((project) => { project.book.camera.fov = Math.min(179, Math.max(1, value)) })} />
    <div className={st.cameraViewStatus}>{t.properties.cameraKeyHint}</div>
    <div className={st.subsectionTitle}>{t.properties.lights}<OverlayEye hiddenId={hiddenKey.light} label={t.properties.lightMarker} /></div>
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
  </Panel>
}

/**
 * BGM。割り当てはプリセットのBGMボタンから行い、
 * ここは確認と微調整、そして解除に絞る。
 */
function BookAudio() {
  const t = useT()
  const store = useBuilderStore()
  const audio = store.project.audio
  const asset = store.project.assets.find((item) => item.id === audio?.bgmAsset)
  return <>
    <div className={st.subsectionTitle}>{t.properties.bgm}</div>
    {!audio && <div className={st.hintSmall}>{t.properties.noBgm}</div>}
    {audio && <>
      <div className={st.row}>
        <span className={st.rowLabel}>{t.properties.bgmAsset}</span>
        <span className={st.rowValue}>{asset?.name ?? audio.bgmAsset}</span>
        <button className={`${st.ghostBtn} ${st.ghostDanger}`} aria-label={t.properties.clearBgm}
          title={t.properties.clearBgm} onClick={() => store.clearBgm()}><Icon as={Trash2} /></button>
      </div>
      <Num label={t.properties.bgmVolume} value={audio.volume}
        onChange={(value) => store.commit((project) => {
          if (project.audio) project.audio.volume = Math.min(1, Math.max(0, value))
        })} />
    </>}
  </>
}

function Light() {
  const t = useT()
  const store = useBuilderStore()
  const light = store.project.book.lights.directional
  return <Panel title={t.properties.directionalLight}>
    <Color label={t.properties.color} value={light.color} onChange={(value) => store.commit((project) => { project.book.lights.directional.color = value })} />
    <Num label={t.properties.intensity} value={light.intensity} onChange={(value) => store.commit((project) => { project.book.lights.directional.intensity = Math.max(0, value) })} />
    <Vec3 label={t.properties.position} value={light.position} onChange={(value) => store.commit((project) => { project.book.lights.directional.position = value })} />
  </Panel>
}

function Cover({ side }: { side: 'front' | 'back' }) {
  const t = useT()
  const store = useBuilderStore()
  const cover = side === 'front' ? store.project.book.frontCover : store.project.book.backCover
  return <Panel title={side === 'front' ? t.properties.frontCover : t.properties.backCover}>
    <Asset label={t.properties.coverFront} value={cover.frontAsset} onChange={(value) => store.commit((project) => {
      (side === 'front' ? project.book.frontCover : project.book.backCover).frontAsset = value || undefined
    })} />
    <Asset label={t.properties.coverBack} value={cover.backAsset} onChange={(value) => store.commit((project) => {
      (side === 'front' ? project.book.frontCover : project.book.backCover).backAsset = value || undefined
    })} />
  </Panel>
}

function SpreadProperties() {
  const t = useT()
  const store = useBuilderStore()
  const id = store.activeSpreadId
  const spread = selectActiveSpread(store)!
  return <Panel title={t.properties.spread}>
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
  </Panel>
}

function Page({ side }: { side: 'left' | 'right' }) {
  const t = useT()
  const store = useBuilderStore()
  const id = store.activeSpreadId
  const page = selectActiveSpread(store)![side === 'left' ? 'leftPage' : 'rightPage']
  return <Panel title={side === 'left' ? t.properties.leftPage : t.properties.rightPage}>
    <Asset label={t.properties.pageBackground} value={page.backgroundAsset} onChange={(value) => store.commit((project) => {
      project.book.spreads.find((item) => item.id === id)![side === 'left' ? 'leftPage' : 'rightPage'].backgroundAsset = value || undefined
    })} />
  </Panel>
}

function Element({ element }: { element: StageElement }) {
  const t = useT()
  const store = useBuilderStore()
  const selection = store.selection
  if (selection.type !== 'element') return null
  const update = (change: (item: StageElement) => void) => store.updateElement(selection.spreadId, element.id, change)
  const preset = presetForElement(element)
  const nested = element.parent.type === 'element'
  const time = activeSpreadTime()
  const key = (property: TimelineProperty, value: TimelineValue) =>
    store.upsertTimelineKey(selection.spreadId, { type: 'element', elementId: element.id }, property, time, value)

  return <Panel title={t.properties.element(element.type)}>
    <div className={st.presetIdentity}><span>{t.properties.sourcePreset}</span>
      <strong>{preset ? t.presets[preset.id] : t.properties.custom}</strong></div>
    <Text label={t.properties.name} value={element.name} onChange={(value) => update((item) => { item.name = value })} />
    <Select label={t.properties.parentSpace} value={element.parent.type} options={element.sourcePreset === 'depth-layer'
      ? [['left-page', t.properties.leftPage], ['right-page', t.properties.rightPage]]
      : [['spread', t.properties.spreadSpace], ['left-page', t.properties.leftPage], ['right-page', t.properties.rightPage]]}
      onChange={(value) => update((item) => { item.parent = { type: value as 'spread' | 'left-page' | 'right-page' } })} />
    <Transform value={element} update={update} onKey={key} />
    {!nested && <>
      <div className={st.subsectionTitle}>{t.properties.stow}</div>
      <Select label={t.properties.mechanism} value={element.stow.mechanism} options={[
        ['auto', t.properties.mechanismAuto], ['page-glue', t.properties.mechanismPageGlue],
        ['flap', t.properties.mechanismFlap], ['v-fold', t.properties.mechanismVFold],
      ]} onChange={(value) => update((item) => {
        item.stow.mechanism = value as typeof item.stow.mechanism
        if (item.stow.mechanism === 'page-glue') item.stow.fallDirection = 'auto'
      })} />
      {element.stow.mechanism !== 'page-glue' && <Select label={t.properties.fallDirection} value={element.stow.fallDirection}
        options={[['auto', t.properties.fallAuto], ['back', t.properties.fallBack], ['front', t.properties.fallFront]]} onChange={(value) => update((item) => {
          item.stow.fallDirection = value as typeof item.stow.fallDirection
        })} />}
      <Num label={t.properties.stagger} value={element.stow.stagger} onChange={(value) => update((item) => {
        item.stow.stagger = Math.min(1, Math.max(0, value))
      })} />
      {element.stow.mechanism === 'v-fold' && <Num label={t.properties.crease} value={element.stow.crease ?? element.pivot[0]}
        onChange={(value) => update((item) => { item.stow.crease = Math.min(.95, Math.max(.05, value)) })} />}
    </>}
    <Num label={t.properties.pivotX} value={element.pivot[0]} onChange={(value) => update((item) => { item.pivot = [value, item.pivot[1]] })} />
    <Num label={t.properties.pivotY} value={element.pivot[1]} onChange={(value) => update((item) => { item.pivot = [item.pivot[0], value] })} />
    <Num label={t.properties.layer} value={element.layer} onChange={(value) => update((item) => { item.layer = Math.round(value) })} />
    <div className={st.row}><span className={st.rowLabel}>{t.properties.visible}</span><label>
      <input type="checkbox" checked={element.visible} onChange={(event) => update((item) => { item.visible = event.target.checked })} />
      {element.visible ? t.properties.visibleOn : t.properties.visibleOff}
    </label><KeyButton label={t.properties.visible} onKey={() => key('visible', element.visible)} /></div>
    <Num label={t.properties.opacity} value={element.opacity} onChange={(value) => update((item) => {
      item.opacity = Math.min(1, Math.max(0, value))
    })} onKey={() => key('opacity', element.opacity)} />
    {element.type === 'image' && <>
      <Asset label={t.properties.image} value={element.asset} onChange={(value) => update((item) => { if (item.type === 'image') item.asset = value })}
        onKey={() => key('asset', element.asset)} />
      <Num label={t.properties.width} value={element.width} onChange={(value) => update((item) => { if (item.type === 'image') item.width = value })} />
      <Num label={t.properties.height} value={element.height} onChange={(value) => update((item) => { if (item.type === 'image') item.height = value })} />
      <label><input type="checkbox" checked={element.billboard} onChange={(event) => update((item) => {
        if (item.type === 'image') item.billboard = event.target.checked
      })} /> {t.properties.billboard}</label>
    </>}
    {element.type === 'text' && <TextStyleFields element={element} update={update} />}
    {element.type === 'effect' && <>
      <Color label={t.properties.effectColor} value={element.color} onChange={(value) => update((item) => {
        if (item.type === 'effect') item.color = value
      })} onKey={() => key('effect.color', element.color)} />
      <Num label={t.properties.effectSize} value={element.size} onChange={(value) => update((item) => {
        if (item.type === 'effect') item.size = Math.max(.01, value)
      })} onKey={() => key('effect.size', element.size)} />
    </>}
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
  </Panel>
}

/**
 * 文字の内容と体裁。
 *
 * 箱 (width/height) は入力させず、内容と体裁から毎回導く。テクスチャは箱いっぱいへ
 * 引き伸ばして貼られるので、箱を手で決められると字が縦横に歪む。歪ませない寸法は
 * runtime/textStyle.ts が一手に持つ。
 */
function TextStyleFields({ element, update }: {
  element: TextElement
  update: (change: (item: StageElement) => void) => void
}) {
  const t = useT()
  const edit = (change: (item: TextElement) => void) => update((item) => {
    if (item.type !== 'text') return
    change(item)
    Object.assign(item, measureTextBox(item, item.fontSize))
  })
  const toggle = (label: string, key: 'bold' | 'italic' | 'underline') =>
    <div className={st.row} key={key}><span className={st.rowLabel}>{label}</span><label>
      <input type="checkbox" checked={element[key]} onChange={(event) => edit((item) => {
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
    <Color label={t.properties.textColor} value={element.color} onChange={(value) => edit((item) => { item.color = value })} />
    <Select label={t.properties.align} value={element.align}
      options={[['left', t.properties.alignLeft], ['center', t.properties.alignCenter], ['right', t.properties.alignRight]]}
      onChange={(value) => edit((item) => { item.align = value as TextElement['align'] })} />
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
        <input key={index} type="number" step={group === 'rotation' ? 1 : .1} value={part}
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
    {value.map((part, index) => <input key={index} type="number" step={step} value={part} onChange={(event) => {
      const next = [...value] as [number, number, number]
      next[index] = Number(event.target.value)
      onChange(next)
    }} />)}
  </div></div>
}

function Asset({ label, value, onChange, onKey }: { label: string; value?: string; onChange: (value: string) => void; onKey?: () => void }) {
  const t = useT()
  const assets = useBuilderStore((state) => state.project.assets).filter((asset) => asset.type === 'image' || asset.type === 'svg')
  return <Select label={label} value={value ?? ''} options={[['', t.properties.unset], ...assets.map((asset) => [asset.id, asset.name] as [string, string])]}
    onChange={onChange} onKey={onKey} />
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className={st.panel}><div className={st.panelTitle}>{title}</div>{children}</section>
}

function Text({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className={st.row}><span className={st.rowLabel}>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></div>
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
  return <div className={st.row}><span className={st.rowLabel}>{label}</span><input type="number" step=".1" value={value}
    onChange={(event) => onChange(Number(event.target.value))} />{onKey && <KeyButton label={label} onKey={onKey} />}</div>
}

function Color({ label, value, onChange, onKey }: { label: string; value: string; onChange: (value: string) => void; onKey?: () => void }) {
  return <div className={st.row}><span className={st.rowLabel}>{label}</span><input type="color" value={value}
    onChange={(event) => onChange(event.target.value)} />{onKey && <KeyButton label={label} onKey={onKey} />}</div>
}

function Select({ label, value, options, onChange, onKey }: {
  label: string
  value: string
  options: Array<[string, string]>
  onChange: (value: string) => void
  onKey?: () => void
}) {
  return <div className={st.row}><span className={st.rowLabel}>{label}</span><select value={value}
    onChange={(event) => onChange(event.target.value)}>{options.map(([option, text]) =>
      <option key={option} value={option}>{text}</option>)}</select>
    {onKey && <KeyButton label={label} onKey={onKey} />}
  </div>
}
