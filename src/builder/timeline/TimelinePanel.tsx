import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Diamond, Pause, Play, Trash2 } from 'lucide-react'
import { Icon, ICON } from '../../ui/Icon'
import { evaluateBookSignals } from '../../runtime/signals'
import { type TimelineKey, type TimelineTrack } from '../../schema/timeline'
import { useT } from '../i18n'
import { useBuilderStore } from '../store'
import { collectTimelineLanes, type TimelineLane } from './lanes'
import st from '../builder.module.css'

/** 1行の高さ: .timelineRow の min-height + 行間 */
const ROW_HEIGHT = 40
/** 行以外が占める高さ: リサイズハンドル + 進行バー行 + 下余白 */
const PANEL_CHROME = 64
const MIN_HEIGHT = PANEL_CHROME + ROW_HEIGHT
/** 既定は3〜4行が見える高さ。以降は縦スクロールとハンドル操作で見る */
const DEFAULT_HEIGHT = PANEL_CHROME + ROW_HEIGHT * 3.5
const HEIGHT_KEY = 'tobidas4.panelH.timeline'

/** 見出し領域の幅。全トラックで揃えるのでCSS変数で配る */
const LABEL_MIN = 110
const LABEL_MAX = 420
const DEFAULT_LABEL_WIDTH = 170
const LABEL_KEY = 'tobidas4.timelineLabelW'
/** 見出しを広げても、キーを置くレーンにはこれだけ残す */
const LANE_MIN = 160
/** 右端のキー操作列。builder.module.css の --timelineToolsWidth と揃える */
const TOOLS_WIDTH = 128

function storedHeight(): number {
  const value = Number(localStorage.getItem(HEIGHT_KEY))
  return Number.isFinite(value) && value >= MIN_HEIGHT ? value : DEFAULT_HEIGHT
}

function storedLabelWidth(): number {
  const value = Number(localStorage.getItem(LABEL_KEY))
  return Number.isFinite(value) && value >= LABEL_MIN ? Math.min(LABEL_MAX, value) : DEFAULT_LABEL_WIDTH
}

export function TimelinePanel() {
  const t = useT()
  const store = useBuilderStore()
  const [playing, setPlaying] = useState(false)
  const [height, setHeight] = useState(storedHeight)
  const [labelWidth, setLabelWidth] = useState(storedLabelWidth)
  const playStart = useRef({ clock: 0, time: 0 })
  const sectionRef = useRef<HTMLElement>(null)
  const spread = store.project.book.spreads.find((item) => item.id === store.activeSpreadId)
  const spreadIndex = spread ? store.project.book.spreads.indexOf(spread) : -1
  const time = spreadIndex < 0 ? 0 : evaluateBookSignals(store.project.book, store.previewProgress).spreadTimes[spreadIndex]
  const lanes = spread ? collectTimelineLanes(spread, store.project.assets) : []

  useEffect(() => { localStorage.setItem(HEIGHT_KEY, String(Math.round(height))) }, [height])
  useEffect(() => { localStorage.setItem(LABEL_KEY, String(Math.round(labelWidth))) }, [labelWidth])

  /** ビューポートの上端を越えない範囲で高さを増減する */
  const resize = (delta: number) => setHeight((value) => {
    const available = (sectionRef.current?.parentElement?.clientHeight ?? 0) - 24
    return Math.min(Math.max(MIN_HEIGHT, available), Math.max(MIN_HEIGHT, value + delta))
  })

  /** 見出し領域の幅。レーンを潰さない範囲で広げられる */
  const resizeLabel = (delta: number) => setLabelWidth((value) => {
    const panelWidth = sectionRef.current?.clientWidth ?? 0
    const max = Math.max(LABEL_MIN, Math.min(LABEL_MAX, panelWidth - LANE_MIN - TOOLS_WIDTH))
    return Math.min(max, Math.max(LABEL_MIN, value + delta))
  })

  /**
   * キーの行の外を押したら選択を解く。補間や削除はその行のキーへ効くので、
   * 同じ行の中 (見出し・レーン・キー操作) を押しているあいだは残す。
   * パネルはpointerdownを止めるため、捕捉段で受ける。
   */
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const selected = useBuilderStore.getState().selectedKey
      if (!selected) return
      const row = (event.target as Element | null)?.closest?.('[data-track-id]')
      if (row?.getAttribute('data-track-id') === selected.trackId) return
      useBuilderStore.getState().selectKey(null)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [])

  useEffect(() => {
    if (!playing || !spread) return
    playStart.current = { clock: performance.now(), time }
    let frame = 0
    const tick = (clock: number) => {
      const next = playStart.current.time + (clock - playStart.current.clock) / 1000
      if (next >= spread.sequence.holdSeconds) {
        store.setSpreadTime(spread.id, spread.sequence.holdSeconds)
        setPlaying(false)
        return
      }
      store.setSpreadTime(spread.id, next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // Starting playback takes a snapshot of the current local time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, spread?.id, spread?.sequence.holdSeconds])

  if (!spread) return null
  return <section ref={sectionRef} className={st.timelineEditor}
    data-tobidas-kind="timeline" data-tobidas-spread-id={spread.id}
    style={{ height, '--timelineLabelWidth': `${labelWidth}px` } as CSSProperties}
    onPointerDown={(event) => event.stopPropagation()}>
    <ResizeHandle onDelta={resize} />
    <div className={st.timelineScrubberRow}>
      <button type="button" className={st.playbackToggle} data-tobidas-action={playing ? 'pause-timeline' : 'play-timeline'}
        aria-label={playing ? t.timeline.pause : t.timeline.playSpread} title={playing ? t.timeline.pause : t.timeline.playSpreadHint}
        onClick={() => {
          if (!playing && time >= spread.sequence.holdSeconds - 0.01) store.setSpreadTime(spread.id, 0)
          setPlaying(!playing)
        }}><Icon as={playing ? Pause : Play} size={ICON.bar} /></button>
      <input className={st.timelineScrubber} data-tobidas-kind="timeline-scrubber" aria-label={t.timeline.holdTime} type="range" min={0}
        max={spread.sequence.holdSeconds} step={0.01} value={time}
        onChange={(event) => store.setSpreadTime(spread.id, Number(event.target.value))} />
      <span className={st.timelineTime}>{t.timeline.seconds(time.toFixed(2), spread.sequence.holdSeconds.toFixed(2))}</span>
    </div>
    <div className={st.timelineBody}>
      <div className={st.timelineRows}>
        {!lanes.length && <div className={st.timelineEmpty}>{t.timeline.emptyHint}</div>}
        {lanes.map((lane) => <TrackRow key={lane.id} lane={lane} holdSeconds={spread.sequence.holdSeconds} />)}
      </div>
      {!!lanes.length && <LabelHandle onDelta={resizeLabel} />}
    </div>
  </section>
}

/** 見出し領域とレーンの境界。右へドラッグすると見出しが広がる */
function LabelHandle({ onDelta }: { onDelta: (delta: number) => void }) {
  const t = useT()
  const last = useRef(0)
  return <div className={st.timelineLabelHandle} role="separator" aria-orientation="vertical"
    aria-label={t.timeline.headerWidth} title={t.timeline.headerWidthHint}
    onPointerDown={(event) => {
      last.current = event.clientX
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      onDelta(event.clientX - last.current)
      last.current = event.clientX
    }} />
}

/** パネル上端のつまみ。上へドラッグすると高さが増える */
function ResizeHandle({ onDelta }: { onDelta: (delta: number) => void }) {
  const t = useT()
  const last = useRef(0)
  return <div className={st.timelineResizeHandle} role="separator" aria-label={t.timeline.panelHeight}
    title={t.timeline.panelHeightHint}
    onPointerDown={(event) => {
      last.current = event.clientY
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      onDelta(last.current - event.clientY)
      last.current = event.clientY
    }} />
}

function TrackRow({ lane, holdSeconds }: { lane: TimelineLane; holdSeconds: number }) {
  const t = useT()
  const store = useBuilderStore()
  const { track, targetName, discrete } = lane
  const [drag, setDrag] = useState<{ keyId: string; time: number } | null>(null)
  const selectedKeyId = store.selectedKey?.trackId === track.id ? store.selectedKey.keyId : null
  const selectedKey = selectedKeyId ? track.keys.find((key) => key.id === selectedKeyId) : undefined
  /**
   * キーを選ぶだけ。部品の選択は動かさない。
   * 動かすと Delete が部品の削除へ流れてしまう (補間と削除は進行バーの行が持つ)
   */
  const selectKey = (keyId: string) =>
    store.selectKey({ spreadId: store.activeSpreadId, trackId: track.id, keyId })
  return <div className={st.timelineRow} data-track-id={track.id} data-tobidas-kind="timeline-track"
    data-tobidas-id={track.id} data-tobidas-target={JSON.stringify(track.target)} data-tobidas-property={track.property}>
    <div className={st.timelineRowLabel}>
      <span>{targetName}</span>
      <strong>{track.property}</strong>
      <button className={st.ghostDanger} data-tobidas-action="delete-timeline-track" data-tobidas-track-id={track.id}
        aria-label={t.timeline.deleteTrack(targetName, track.property)} title={t.timeline.deleteTrackHint}
        onClick={() => store.removeTimelineTrack(store.activeSpreadId, track.id)}><Icon as={Trash2} /></button>
    </div>
    <div className={st.timelineLane}>
      {track.keys.map((key) => {
        const shownTime = drag?.keyId === key.id ? drag.time : key.time
        return <button key={key.id}
        className={`${st.timelineKey} ${selectedKeyId === key.id ? st.timelineKeySelected : ''}`}
        data-tobidas-kind="timeline-key" data-tobidas-id={key.id} data-tobidas-track-id={track.id}
        data-tobidas-time={String(key.time)} data-tobidas-value={formatTimelineValue(key.value)}
        style={{ left: `${holdSeconds <= 0 ? 0 : shownTime / holdSeconds * 100}%` }}
        title={t.timeline.keyHint(shownTime.toFixed(2), formatTimelineValue(key.value))}
        aria-label={t.timeline.keyHint(shownTime.toFixed(2), formatTimelineValue(key.value))}
        onPointerDown={(event) => {
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          setDrag({ keyId: key.id, time: key.time })
          selectKey(key.id)
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          const lane = event.currentTarget.parentElement?.getBoundingClientRect()
          if (!lane) return
          const next = Math.min(holdSeconds, Math.max(0, (event.clientX - lane.left) / lane.width * holdSeconds))
          setDrag({ keyId: key.id, time: next })
          store.setSpreadTime(store.activeSpreadId, next)
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          event.currentTarget.releasePointerCapture(event.pointerId)
          const next = drag?.keyId === key.id ? drag.time : key.time
          setDrag(null)
          store.updateTimelineKeyTime(store.activeSpreadId, track.id, key.id, next)
          store.setSpreadTime(store.activeSpreadId, next)
        }}
        onClick={() => {
          if (drag) return
          store.setSpreadTime(store.activeSpreadId, key.time)
          selectKey(key.id)
        }}><Icon as={Diamond} size={13} fill="currentColor" /></button>
      })}
    </div>
    {/* キーの操作。常に見えていて、キーを選ぶまでは無効 */}
    <div className={st.timelineRowTools}>
      <select className={st.timelineKeyEase} data-tobidas-kind="timeline-ease" data-tobidas-track-id={track.id}
        aria-label={t.timeline.ease(track.property)}
        disabled={!selectedKey}
        title={!selectedKey ? t.timeline.easeNoKey
          : discrete ? t.timeline.easeDiscrete : t.timeline.easeSelected}
        value={selectedKey?.ease ?? ''}
        onChange={(event) => selectedKey && store.setTimelineKeyEase(
          store.activeSpreadId, track.id, selectedKey.id, event.target.value as TimelineKey['ease'])}>
        {!selectedKey && <option value="">—</option>}
        {discrete
          ? <option value="hold">hold</option>
          : <><option value="linear">linear</option><option value="easeInOut">easeInOut</option></>}
      </select>
      <button className={st.ghostDanger} data-tobidas-action="delete-timeline-key" data-tobidas-track-id={track.id}
        data-tobidas-key-id={selectedKey?.id ?? ''} disabled={!selectedKey}
        aria-label={t.timeline.deleteKey}
        title={selectedKey ? t.timeline.deleteKeyHint : t.timeline.deleteKeyNone}
        onClick={() => selectedKey && store.removeTimelineKey(store.activeSpreadId, track.id, selectedKey.id)}><Icon as={Trash2} /></button>
    </div>
  </div>
}

function formatTimelineValue(value: TimelineTrack['keys'][number]['value']): string {
  return Array.isArray(value) ? value.map((part) => Number(part).toFixed(2)).join(', ') : String(value)
}
