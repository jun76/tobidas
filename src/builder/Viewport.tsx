import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Move, Pause, Play, RotateCcw, RotateCw, Scale3d, Video, Volume2, VolumeX } from 'lucide-react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { BookRuntime, type RuntimeSelection } from '../runtime/BookRuntime'
import { VIEW_CLIP, VIEW_GL } from '../runtime/camera/view'
import { evaluateBookSignals } from '../runtime/signals'
import type { StageElement } from '../schema/stageElement'
import { Icon, ICON } from '../ui/Icon'
import st from './builder.module.css'
import { useT } from './i18n'
import { hiddenKey, useBuilderStore } from './store'
import { TimelinePanel } from './timeline/TimelinePanel'
import { didGizmoPress, useGizmoPressReset } from './viewport/gizmoInteraction'
import { PageDropController } from './viewport/PageDropController'
import { CameraPreview, EditableLight, SavedCameraMarkers } from './viewport/SceneGuides'
import { SelectionGizmo } from './viewport/SelectionGizmo'
import { useSoundCueDrop } from './viewport/useSoundCueDrop'
import { useViewportPlayback } from './viewport/useViewportPlayback'
import { selectActiveSpread } from './state/selectors'

export const viewportGlRef: { current: THREE.WebGLRenderer | null } = { current: null }

export function Viewport({ showEditTimeline = true }: { showEditTimeline?: boolean } = {}) {
  const t = useT()
  const store = useBuilderStore()
  const editCameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const orbitRef = useRef<OrbitControlsImpl | null>(null)
  const playback = useViewportPlayback()
  const rootRef = useRef<HTMLDivElement>(null)
  // 効果音の受け口はビューポートとタイムラインの全域。両方ともこの箱の中にある
  const soundDropOver = useSoundCueDrop(rootRef)
  useGizmoPressReset()
  const activeSpreadName = selectActiveSpread(store)?.name
  // 表紙を選んでいる間は見開きの外を見ている。保持区間の秒を持たないので
  // タイムラインは出さず、見出しも見開き名ではなく表紙の名前にする
  const coverSide = store.selection.type === 'cover' ? store.selection.side : undefined
  const viewTitle = coverSide
    ? (coverSide === 'front' ? t.navigator.frontCover : t.navigator.backCover)
    : activeSpreadName
  const selectionLabel = (() => {
    const selection = store.selection
    if (selection.type === 'book') return `${store.project.name} (${store.project.id})`
    if (selection.type === 'light') return t.properties.directionalLight
    if (selection.type === 'cover') return selection.side
    const spread = store.project.book.spreads.find((item) => item.id === selection.spreadId)
    if (selection.type === 'spread') return `${spread?.name ?? selection.spreadId} (${selection.spreadId})`
    if (selection.type === 'page') return `${spread?.name ?? selection.spreadId} ${selection.side} (${selection.spreadId}:${selection.side})`
    const element = spread?.elements.find((item) => item.id === selection.elementId)
    return `${element?.name ?? selection.elementId} (${selection.elementId})`
  })()
  // 再生ボタンは3態。終端では「最初から」になる (書き出した再生画面と同じ)
  const playbackLabel = playback.isAutoPlaying ? t.viewport.pause : playback.atEnd ? t.viewport.replay : t.viewport.play
  const hidden = store.hidden
  const hiddenPredicate = useMemo(() => (spreadId: string, element: StageElement) => {
    if (!hidden.size) return false
    if (hidden.has(hiddenKey.element(element.id))) return true
    if (element.parent.type === 'left-page') return hidden.has(hiddenKey.page(spreadId, 'left'))
    if (element.parent.type === 'right-page') return hidden.has(hiddenKey.page(spreadId, 'right'))
    return false
  }, [hidden])

  const select = (selection: RuntimeSelection) => {
    if (!didGizmoPress()) store.select(selection)
  }
  const saveCameraView = () => {
    const camera = editCameraRef.current
    const orbit = orbitRef.current
    if (!camera || !orbit) return
    const spreadIndex = store.project.book.spreads.findIndex((spread) => spread.id === store.activeSpreadId)
    const time = evaluateBookSignals(store.project.book, store.previewProgress).spreadTimes[spreadIndex] ?? 0
    store.upsertCameraKeys(store.activeSpreadId, time, {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [orbit.target.x, orbit.target.y, orbit.target.z],
      fov: camera.fov,
    })
  }

  return <div
    ref={rootRef}
    className={`${st.viewport} ${soundDropOver ? st.viewportSoundDrop : ''}`}
    data-viewport-root
    role="region"
    aria-label={t.viewport.scene(viewTitle ?? '', store.mode === 'edit' ? t.toolbar.edit : t.toolbar.play, selectionLabel)}
    onWheel={(event) => {
      if (store.mode === 'play') {
        event.preventDefault()
        playback.pause()
        playback.adjust(event.deltaY)
      }
    }}
  >
    <Canvas
      dpr={[1, 2]}
      shadows
      gl={{ ...VIEW_GL, preserveDrawingBuffer: true }}
      camera={{ position: store.project.book.camera.position, fov: store.project.book.camera.fov, ...VIEW_CLIP }}
      onCreated={({ gl, camera }) => {
        viewportGlRef.current = gl
        if (camera instanceof THREE.PerspectiveCamera) editCameraRef.current = camera
        camera.lookAt(...store.project.book.camera.target)
      }}
    >
      <BookRuntime
        project={store.project}
        progress={playback.progress}
        showGuides={store.mode === 'edit'}
        isHidden={store.mode === 'edit' ? hiddenPredicate : undefined}
        onSelect={store.mode === 'edit' ? select : undefined}
        audioActive={store.mode === 'play'}
        audioMuted={playback.audioMuted}
      />
      {store.mode === 'edit' && <>
        <PageDropController />
        <OrbitControls
          ref={orbitRef}
          makeDefault
          target={store.project.book.camera.target}
          enableDamping
          dampingFactor={0.12}
        />
        <SelectionGizmo />
        {!store.hidden.has(hiddenKey.camera) && <>
          <CameraPreview book={store.project.book} progress={playback.progress} />
          <SavedCameraMarkers />
        </>}
        {!store.hidden.has(hiddenKey.light) && <EditableLight lights={store.project.book.lights} />}
      </>}
    </Canvas>

    {store.mode === 'edit' && viewTitle && <div className={st.viewportTitle}>{viewTitle}</div>}
    {store.mode === 'edit' && <div className={st.transformTools} aria-label={t.viewport.tools}>
      {([
        ['translate', Move, t.viewport.translate],
        ['rotate', RotateCw, t.viewport.rotate],
        ['scale', Scale3d, t.viewport.scale],
      ] as const).map(([mode, glyph, label]) => (
        <button
          key={mode}
          type="button"
          className={store.gizmo === mode ? st.active : ''}
          aria-label={label}
          title={label}
          onClick={() => store.setGizmo(mode)}
        >
          <Icon as={glyph} size={ICON.float} />
        </button>
      ))}
      <button type="button" aria-label={t.viewport.saveCameraKey} title={t.viewport.saveCameraKey} onClick={saveCameraView}>
        <Icon as={Video} size={ICON.float} />
      </button>
    </div>}

    {store.mode === 'edit'
      ? (showEditTimeline && !coverSide ? <TimelinePanel /> : null)
      : <div className={`${st.timeline} ${st.timelinePlayback}`} onPointerDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          className={st.playbackToggle}
          aria-label={playbackLabel}
          title={playbackLabel}
          onClick={playback.toggle}
        >
          <Icon as={playback.isAutoPlaying ? Pause : playback.atEnd ? RotateCcw : Play} size={ICON.bar} />
        </button>
        <div className={st.timelineTrack}>
          <input
            aria-label={t.viewport.progress}
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={playback.progress}
            style={{
              background: `linear-gradient(to right, #168af0 0%, #168af0 ${playback.progress * 100}%, #d6d6dd ${playback.progress * 100}%, #d6d6dd 100%)`,
            }}
            onPointerDown={playback.pause}
            onChange={(event) => playback.seek(Number(event.target.value))}
          />
        </div>
        {playback.hasAudio && <button
          type="button"
          className={st.playbackToggle}
          aria-label={playback.audioMuted ? t.viewport.unmuteAudio : t.viewport.muteAudio}
          title={playback.audioMuted ? t.viewport.unmuteAudio : t.viewport.muteAudio}
          onClick={playback.toggleAudio}
        >
          <Icon as={playback.audioMuted ? VolumeX : Volume2} size={ICON.bar} />
        </button>}
      </div>}
  </div>
}
