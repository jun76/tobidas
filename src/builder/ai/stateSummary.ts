import { evaluateBookSignals } from '../../runtime/signals'
import type { BookProject } from '../../schema/bookPackage'
import type { EditorState } from '../state/editorState'
import type { StageElement } from '../../schema/stageElement'
import type { AiElementSummary, AiStateSummary, AiTargetSummary } from './types'

function selectionSummary(state: EditorState): AiTargetSummary {
  const selection = state.selection
  if (selection.type === 'book') return { kind: 'book', id: state.project.id, label: state.project.name }
  if (selection.type === 'light') return { kind: 'light', label: 'directional-light' }
  if (selection.type === 'cover') return { kind: 'cover', id: selection.side, label: `${selection.side}-cover` }
  const spread = state.project.book.spreads.find((item) => item.id === selection.spreadId)
  if (selection.type === 'spread') return { kind: 'spread', id: selection.spreadId, label: spread?.name ?? selection.spreadId }
  if (selection.type === 'page') return { kind: 'page', id: `${selection.spreadId}:${selection.side}`, label: `${selection.side}-page` }
  const element = spread?.elements.find((item) => item.id === selection.elementId)
  return { kind: 'element', id: selection.elementId, label: element?.name ?? selection.elementId }
}
function assetReferences(project: BookProject): Map<string, number> {
  const counts = new Map<string, number>()
  const use = (id: string | undefined) => {
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  use(project.audio?.bgmAsset)
  use(project.book.frontCover.frontAsset)
  use(project.book.frontCover.backAsset)
  use(project.book.backCover.frontAsset)
  use(project.book.backCover.backAsset)
  use(project.book.appearance.backgroundAsset)
  for (const spread of project.book.spreads) {
    use(spread.leftPage.backgroundAsset)
    use(spread.rightPage.backgroundAsset)
    use(spread.enterSound)
    use(spread.pageTurnSound)
    for (const element of spread.elements) {
      if (element.type === 'visual') {
        use(element.image)
        use(element.backImage)
      }
    }
    for (const track of spread.timeline.tracks) {
      if (track.target.type === 'sound') use(track.target.assetId)
      if (track.property === 'visual.image') {
        for (const key of track.keys) if (typeof key.value === 'string') use(key.value)
      }
    }
  }
  return counts
}

function elementSummary(element: StageElement, spreadId: string, trackIds: string[]): AiElementSummary {
  return {
    id: element.id,
    name: element.name,
    type: element.type,
    parent: element.parent,
    spreadId,
    position: [...element.baseTransform.position],
    rotation: [...element.baseTransform.rotation],
    scale: [...element.baseTransform.scale],
    pivot: [...element.pivot],
    layer: element.layer,
    visible: element.visible,
    opacity: element.opacity,
    ...(element.type === 'visual' ? {
      width: element.width,
      height: element.height,
      image: element.image,
      backImage: element.backImage,
      videoAudio: element.videoAudio,
      backVideoAudio: element.backVideoAudio,
      text: element.text,
      particles: element.particles.enabled,
    } : {}),
    ...(element.type === 'particle' ? {
      width: element.width,
      height: element.height,
      particles: true,
      particleSettings: { ...element.particles },
    } : {}),
    motion: element.motion.map((item) => item.type),
    trackIds,
  }
}

export function buildAiStateSummary(state: EditorState): AiStateSummary {
  const spreadIndex = state.project.book.spreads.findIndex((item) => item.id === state.activeSpreadId)
  const spread = state.project.book.spreads[spreadIndex]
  const signals = evaluateBookSignals(state.project.book, state.previewProgress)
  const selection = state.selection
  const selected = selection.type === 'element'
    ? state.project.book.spreads.find((item) => item.id === selection.spreadId)?.elements.find((item) => item.id === selection.elementId)
    : undefined
  const selectedSpread = selection.type === 'element'
    ? state.project.book.spreads.find((item) => item.id === selection.spreadId)
    : spread
  const references = assetReferences(state.project)
  const spreads = state.project.book.spreads.map((item, index) => ({
    id: item.id,
    name: item.name,
    index,
    holdSeconds: item.sequence.holdSeconds,
    turnSeconds: item.sequence.turnSeconds,
    leftPage: { backgroundAsset: item.leftPage.backgroundAsset },
    rightPage: { backgroundAsset: item.rightPage.backgroundAsset },
    elements: item.elements.map((element) => elementSummary(element, item.id, item.timeline.tracks
      .filter((track) => track.target.type === 'element' && track.target.elementId === element.id)
      .map((track) => track.id))),
    timeline: item.timeline.tracks.map((track) => ({
      id: track.id,
      target: track.target,
      property: track.property,
      keys: track.keys.map((key) => ({ id: key.id, time: key.time, value: key.value, ease: key.ease })),
    })),
  }))

  return {
    project: { id: state.project.id, name: state.project.name, source: state.source },
    book: state.project.book,
    audio: state.project.audio,
    mode: state.mode,
    activeSpread: spread ? {
      id: spread.id,
      name: spread.name,
      index: spreadIndex,
      holdSeconds: spread.sequence.holdSeconds,
      turnSeconds: spread.sequence.turnSeconds,
    } : undefined,
    selection: selectionSummary(state),
    selectedElement: selected ? elementSummary(selected, selection.type === 'element' ? selection.spreadId : state.activeSpreadId,
      selectedSpread?.timeline.tracks
        .filter((track) => track.target.type === 'element' && track.target.elementId === selected.id)
        .map((track) => track.id) ?? []) : undefined,
    spreads,
    previewProgress: state.previewProgress,
    spreadTime: spreadIndex < 0 ? 0 : signals.spreadTimes[spreadIndex] ?? 0,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
    validation: { errors: [...state.issues.errors], warnings: [...state.issues.warnings] },
    assets: state.project.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      mime: asset.mime,
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,
      duration: asset.duration,
      references: references.get(asset.id) ?? 0,
    })),
  }
}
