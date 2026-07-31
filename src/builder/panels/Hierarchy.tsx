import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, Copy, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { Icon } from '../../ui/Icon'
import { assetAccept } from '../../package/model'
import type { ParentSpace } from '../../schema/stageElement'
import { useT } from '../i18n'
import { parentForPreset, PART_PRESETS, type PlacementMode } from '../presets'
import { fileToAsset } from '../assets/ingest'
import { requestContainerElementsDelete, requestElementDelete, requestSpreadDelete } from '../elementDelete'
import { ELEMENT_DND_MIME, hiddenKey, useBuilderStore } from '../store'
import type { BookSelection } from '../state/editorState'
import { selectSelectedElement, selectSpreadById } from '../state/selectors'
import st from '../builder.module.css'

export function BookNavigator() {
  const t = useT()
  const store = useBuilderStore()
  const selected = (selection: BookSelection) => JSON.stringify(store.selection) === JSON.stringify(selection)
  /**
   * 見開きの展開は選択と別に持つ。既定は「編集中の見開きだけ開いている」で、
   * 行のねじりボタンはその既定を見開きごとに上書きする。選択していない見開きの
   * 中身も開けないと、部品を探すのに選び直すことになる。
   */
  const [spreadExpanded, setSpreadExpanded] = useState<Map<string, boolean>>(() => new Map())
  const isSpreadExpanded = (spreadId: string) => spreadExpanded.get(spreadId) ?? spreadId === store.activeSpreadId
  const toggleSpread = (spreadId: string) =>
    setSpreadExpanded((current) => new Map(current).set(spreadId, !isSpreadExpanded(spreadId)))

  // 表紙を見ている間は見開きの行を光らせない。見開きの行は「どれが編集中か」を
  // 選択とは別軸で示すので、そのまま残すと2つ選ばれているように見える
  const coverSelected = store.selection.type === 'cover'

  // 余白のクリックで選択解除。行とボタンからの伝播は無視する
  const clearSelection = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as Element
    if (target.closest(`.${st.treeRow}`) || target.closest('button')) return
    store.select({ type: 'book' })
  }

  return <section className={`${st.panel} ${st.navigatorPanel}`} onClick={clearSelection}>
      <div className={st.panelTitle}>{t.app.panelNavigator} <button onClick={store.addSpread}><Icon as={Plus} />{t.navigator.addSpread}</button></div>
      <Row label={t.navigator.frontCover} tag={t.navigator.tagCover} active={selected({ type: 'cover', side: 'front' })} onClick={() => store.select({ type: 'cover', side: 'front' })} />
      {store.project.book.spreads.map((spread, index) => {
        const expanded = isSpreadExpanded(spread.id)
        return <div key={spread.id}>
        <Row label={`${index + 1}. ${spread.name}`} tag={t.navigator.tagSpread}
          active={spread.id === store.activeSpreadId && !coverSelected}
          onClick={() => store.setActiveSpread(spread.id)}
          expanded={expanded} onToggle={() => toggleSpread(spread.id)}>
          <button className={st.ghostBtn}
            aria-label={t.navigator.moveEarlier(spread.name)} title={t.navigator.moveEarlierHint}
            onClick={(event) => { event.stopPropagation(); store.moveSpread(spread.id, -1) }}><Icon as={ChevronUp} /></button>
          <button className={st.ghostBtn}
            aria-label={t.navigator.moveLater(spread.name)} title={t.navigator.moveLaterHint}
            onClick={(event) => { event.stopPropagation(); store.moveSpread(spread.id, 1) }}><Icon as={ChevronDown} /></button>
          <button className={st.ghostBtn}
            aria-label={t.navigator.duplicate(spread.name)} title={t.navigator.duplicateHint}
            onClick={(event) => { event.stopPropagation(); store.duplicateSpread(spread.id) }}><Icon as={Copy} /></button>
          <button className={`${st.ghostBtn} ${st.ghostDanger}`}
            disabled={store.project.book.spreads.length < 2}
            aria-label={t.navigator.deleteSpread(spread.name)}
            title={store.project.book.spreads.length < 2 ? t.navigator.lastSpread : t.navigator.deleteSpreadHint}
            onClick={(event) => { event.stopPropagation(); requestSpreadDelete(spread.id) }}><Icon as={Trash2} /></button>
        </Row>
        {expanded && <Tree spreadId={spread.id} />}
      </div>
      })}
      <Row label={t.navigator.backCover} tag={t.navigator.tagCover} active={selected({ type: 'cover', side: 'back' })} onClick={() => store.select({ type: 'cover', side: 'back' })} />
    </section>
}

/**
 * 部品プリセット。
 *
 * ボタンには2種類ある。混ぜない。
 *
 *   モード — 画像の5つと効果音。押すと選択中のプリセットになり、アセットの
 *            ドラッグを待つ。もう一度押すと解除
 *   即時   — BGM・パーティクル・テキスト。押した瞬間に用が済む
 *
 * その他が即時なのはアセットを要さないからで、BGMが即時なのは置く先が
 * 紙面ではなく作品全体だからである。
 */
export function PartPresets() {
  const t = useT()
  const store = useBuilderStore()
  const selectedPage = store.selection.type === 'page' && store.selection.spreadId === store.activeSpreadId
    ? store.selection.side
    : undefined
  const bgmRef = useRef<HTMLInputElement>(null)

  const modeButton = (mode: PlacementMode, label: string, hint: string) => {
    const active = store.placement === mode
    return <button key={mode} className={active ? st.presetButtonActive : ''} aria-pressed={active}
      title={hint} onClick={() => store.setPlacement(active ? null : mode)}>{label}</button>
  }
  const imagePresets = PART_PRESETS.filter((preset) => preset.group === 'image')
  const otherPresets = PART_PRESETS.filter((preset) => preset.group === 'other')

  return <section className={st.panel}>
      <div className={st.panelTitle}>{t.app.panelPresets}</div>

      <div className={st.presetGroupTitle}>{t.presets.groupImage}</div>
      <div className={st.presetGrid}>
        {imagePresets.map((preset) => modeButton(preset.id, t.presets[preset.id], t.presets.dragHint(t.presets[preset.id])))}
      </div>

      <div className={st.presetGroupTitle}>{t.presets.groupSound}</div>
      <div className={st.presetGrid}>
        {modeButton('sound-cue', t.presets.soundCue, t.presets.soundCueHint)}
        <button title={t.presets.bgmHint} onClick={() => bgmRef.current?.click()}>{t.presets.bgm}</button>
      </div>

      <div className={st.presetGroupTitle}>{t.presets.groupOther}</div>
      <div className={st.presetGrid}>
        {otherPresets.map((preset) => <button key={preset.id}
          title={t.presets.create(t.presets[preset.id])}
          onClick={() => store.addElement(store.activeSpreadId, preset.type, parentForPreset(preset, selectedPage),
            preset.mechanism, undefined, preset.id)}>
          {t.presets[preset.id]}
        </button>)}
      </div>

      <div className={st.hintSmall}>
        {store.placement ? t.presets.dropHint : t.presets.pickHint}
      </div>
      <input ref={bgmRef} hidden type="file" accept={assetAccept('audio')}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          void fileToAsset(file, new Set(store.project.assets.map((asset) => asset.id)))
            .then((asset) => store.assignBgm(asset))
            .catch((error) => alert(String(error)))
        }} />
    </section>
}

/**
 * 編集ビューでの表示・非表示。作品データには触れない。
 * 隠しているあいだは行にホバーしていなくても見えるようにする。
 */
function EyeButton({ hiddenId, label }: { hiddenId: string; label: string }) {
  const t = useT()
  const hidden = useBuilderStore((state) => state.hidden.has(hiddenId))
  const toggleHidden = useBuilderStore((state) => state.toggleHidden)
  return <button className={`${st.ghostBtn} ${hidden ? st.ghostOn : ''}`} draggable={false}
    aria-label={t.properties.overlayVisibility(label)} aria-pressed={!hidden}
    title={hidden ? t.properties.overlayShow(label) : t.properties.overlayHide(label)}
    onClick={(event) => { event.stopPropagation(); toggleHidden(hiddenId) }}><Icon as={hidden ? EyeOff : Eye} /></button>
}

function Tree({ spreadId }: { spreadId: string }) {
  const t = useT()
  const store = useBuilderStore()
  const spread = selectSpreadById(store, spreadId)!
  const roots = (key: string) => spread.elements.filter((element) => element.parent.type === key)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  return <div style={{ paddingLeft: 12 }}>
    {(['left', 'right'] as const).map((side) => {
      const children = roots(`${side}-page`)
      const key = `page:${side}`
      const expanded = !collapsed.has(key)
      return <div key={side}>
      <Row label={side === 'left' ? t.properties.leftPage : t.properties.rightPage} tag={t.navigator.tagPage}
        active={store.selection.type === 'page' && store.selection.spreadId === spreadId && store.selection.side === side}
        onClick={() => store.select({ type: 'page', spreadId, side })}
        spreadId={spreadId} dropParent={{ type: `${side}-page` }}
        expanded={children.length ? expanded : undefined} onToggle={children.length ? () => toggle(key) : undefined}>
        <EyeButton hiddenId={hiddenKey.page(spreadId, side)} label={side === 'left' ? t.properties.leftPage : t.properties.rightPage} />
        <button className={`${st.ghostBtn} ${st.ghostDanger}`}
          disabled={!children.length}
          aria-label={t.navigator.clearParts(side === 'left' ? t.properties.leftPage : t.properties.rightPage)}
          title={children.length ? t.navigator.clearPartsHint : t.navigator.clearPartsNone}
          onClick={(event) => {
            event.stopPropagation()
            requestContainerElementsDelete({ spreadId, parentType: `${side}-page` })
          }}><Icon as={Trash2} /></button>
      </Row>
      {expanded && children.map((element) => <ElementRow key={element.id} id={element.id} spreadId={spreadId} collapsed={collapsed} toggle={toggle} />)}
    </div>})}
    {(() => {
      const children = roots('spread')
      const key = 'spread'
      const expanded = !collapsed.has(key)
      return <>
    <Row label={t.properties.spreadSpace} tag={t.navigator.tagSpace} active={store.selection.type === 'spread' && store.selection.spreadId === spreadId}
      onClick={() => store.select({ type: 'spread', spreadId })}
      spreadId={spreadId} dropParent={{ type: 'spread' }}
      expanded={children.length ? expanded : undefined} onToggle={children.length ? () => toggle(key) : undefined}>
      <EyeButton hiddenId={hiddenKey.space(spreadId)} label={t.properties.spreadSpace} />
      <button className={`${st.ghostBtn} ${st.ghostDanger}`}
        disabled={!children.length}
        aria-label={t.navigator.clearParts(t.properties.spreadSpace)}
        title={children.length ? t.navigator.clearPartsHint : t.navigator.clearPartsNone}
        onClick={(event) => {
          event.stopPropagation()
          requestContainerElementsDelete({ spreadId, parentType: 'spread' })
        }}><Icon as={Trash2} /></button>
    </Row>
    {expanded && children.map((element) => <ElementRow key={element.id} id={element.id} spreadId={spreadId} collapsed={collapsed} toggle={toggle} />)}
      </>
    })()}
  </div>
}

function ElementRow({ id, spreadId, collapsed, toggle }: { id: string; spreadId: string; collapsed: Set<string>; toggle: (key: string) => void }) {
  const t = useT()
  const store = useBuilderStore()
  const spread = store.project.book.spreads.find((item) => item.id === spreadId)!
  const element = spread.elements.find((item) => item.id === id)!
  const children = spread.elements.filter((child) => child.parent.type === 'element' && child.parent.elementId === id)
  const key = `element:${id}`
  const expanded = !collapsed.has(key)
  return <div style={{ paddingLeft: 12 }}>
    <Row label={element.name} tag={element.stow.mechanism}
      active={store.selection.type === 'element' && store.selection.elementId === id}
      onClick={() => store.select({ type: 'element', spreadId, elementId: id })}
      spreadId={spreadId} draggableId={id} dropParent={{ type: 'element', elementId: id }}
      expanded={children.length ? expanded : undefined} onToggle={children.length ? () => toggle(key) : undefined}>
      <EyeButton hiddenId={hiddenKey.element(id)} label={element.name} />
      <button className={`${st.ghostBtn} ${st.ghostDanger}`} draggable={false}
        aria-label={t.navigator.deleteElement(element.name)} title={t.navigator.deleteElementHint}
        onClick={(event) => {
          event.stopPropagation()
          requestElementDelete({ spreadId, elementId: id })
        }}><Icon as={Trash2} /></button>
    </Row>
    {expanded && children.map((child) => <ElementRow key={child.id} id={child.id} spreadId={spreadId} collapsed={collapsed} toggle={toggle} />)}
  </div>
}

interface RowProps {
  label: string
  tag: string
  active: boolean
  onClick: () => void
  children?: ReactNode
  spreadId?: string
  draggableId?: string
  dropParent?: ParentSpace
  expanded?: boolean
  onToggle?: () => void
}

function Row({ label, tag, active, onClick, children, spreadId, draggableId, dropParent, expanded, onToggle }: RowProps) {
  const t = useT()
  const store = useBuilderStore()
  const [dropOver, setDropOver] = useState(false)
  const acceptsElement = (event: DragEvent) => Boolean(spreadId && dropParent && event.dataTransfer.types.includes(ELEMENT_DND_MIME))

  return <div className={`${st.treeRow} ${active ? st.selected : ''} ${dropOver ? st.treeDropTarget : ''}`}
    draggable={Boolean(draggableId)}
    onClick={onClick}
    onDragStart={(event) => {
      if (!draggableId) return
      event.stopPropagation()
      event.dataTransfer.setData(ELEMENT_DND_MIME, draggableId)
      event.dataTransfer.effectAllowed = 'move'
    }}
    onDragEnd={() => setDropOver(false)}
    onDragEnter={(event) => { if (acceptsElement(event)) { event.preventDefault(); setDropOver(true) } }}
    onDragOver={(event) => { if (acceptsElement(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropOver(false) }}
    onDrop={(event) => {
      if (!spreadId || !dropParent) return
      const id = event.dataTransfer.getData(ELEMENT_DND_MIME)
      if (!id) return
      event.preventDefault()
      event.stopPropagation()
      setDropOver(false)
      store.moveElement(spreadId, id, dropParent)
      store.select({ type: 'element', spreadId, elementId: id })
    }}>
    {onToggle
      ? <button className={`${st.ghostBtn} ${st.twisty}`} draggable={false}
        aria-label={expanded ? t.navigator.collapse : t.navigator.expand} aria-expanded={expanded}
        title={expanded ? t.navigator.collapse : t.navigator.expand}
        onClick={(event) => { event.stopPropagation(); onToggle() }}><Icon as={expanded ? ChevronDown : ChevronRight} size={12} /></button>
      : <span className={st.twistySpacer} aria-hidden="true" />}
    <span className={st.typeTag}>{tag}</span>
    <span className={st.treeName}>{label}</span>
    {children}
  </div>
}
