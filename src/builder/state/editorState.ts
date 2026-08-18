import type { Asset } from '../../schema/assets'
import type { BookProject } from '../../schema/bookPackage'
import type { BookValidationResult } from '../../schema/bookValidate'
import type { ParentSpace, StageElement, StageElementType } from '../../schema/stageElement'
import type { TimelineKey, TimelineProperty, TimelineTarget, TimelineValue } from '../../schema/timeline'
import type { RootParentType } from '../hierarchy'
import type { PlacementMode, VisualPresetId } from '../presets'

export type EditorMode = 'edit' | 'play'
export type GizmoMode = 'translate' | 'rotate' | 'scale'
export interface KeySelection { spreadId: string; trackId: string; keyId: string }
export type BookSelection =
  | { type: 'book' }
  | { type: 'light' }
  | { type: 'cover'; side: 'front' | 'back' }
  | { type: 'spread'; spreadId: string }
  | { type: 'page'; spreadId: string; side: 'left' | 'right' }
  | { type: 'element'; spreadId: string; elementId: string }
export type ProjectSource = 'new' | 'idb' | 'import'
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'quota-error' | 'error'

export interface EditorState {
  project: BookProject
  projectSession: number
  activeSpreadId: string
  selection: BookSelection
  selectedKey: KeySelection | null
  hidden: ReadonlySet<string>
  mode: EditorMode
  /**
   * 掴んで置くプリセットの選択。
   * 編集セッションの状態で、作品データには入らない。
   */
  placement: PlacementMode | null
  gizmo: GizmoMode
  previewProgress: number
  undoStack: BookProject[]
  redoStack: BookProject[]
  issues: BookValidationResult
  source: ProjectSource
  saveStatus: SaveStatus
  saveError?: string
  setProject(project: BookProject, source: ProjectSource): void
  commit(change: (project: BookProject) => void): void
  undo(): void
  redo(): void
  select(selection: BookSelection): void
  selectKey(key: KeySelection | null): void
  toggleHidden(key: string): void
  setTimelineKeyEase(spreadId: string, trackId: string, keyId: string, ease: TimelineKey['ease']): void
  setMode(mode: EditorMode): void
  /** 同じものをもう一度押したら解除する側 (UI) の判断で null を渡す */
  setPlacement(mode: PlacementMode | null): void
  setGizmo(mode: GizmoMode): void
  setPreviewProgress(progress: number): void
  setSpreadTime(spreadId: string, seconds: number): void
  upsertTimelineKey(
    spreadId: string,
    target: TimelineTarget,
    property: TimelineProperty,
    time: number,
    value: TimelineValue,
  ): void
  updateTimelineKeyTime(spreadId: string, trackId: string, keyId: string, time: number): void
  removeTimelineKey(spreadId: string, trackId: string, keyId: string): void
  removeTimelineTrack(spreadId: string, trackId: string): void
  upsertCameraKeys(spreadId: string, time: number, pose: {
    position: [number, number, number]
    target: [number, number, number]
    fov: number
  }): void
  applyGizmoTransform(spreadId: string, elementId: string, time: number, transform: StageElement['baseTransform']): void
  setActiveSpread(id: string): void
  addSpread(): void
  duplicateSpread(id: string): void
  moveSpread(id: string, direction: -1 | 1): void
  removeSpread(id: string): void
  addElement(
    spreadId: string,
    type: StageElementType,
    parent?: ParentSpace,
    assetId?: string,
  ): void
  moveElement(spreadId: string, id: string, parent: ParentSpace): void
  placeAsset(
    spreadId: string,
    side: 'left' | 'right',
    assetId: string,
    point?: { x: number; y: number },
  ): void
  placeAssetWithPreset(
    spreadId: string,
    side: 'left' | 'right',
    assetId: string,
    presetId: Extract<VisualPresetId, 'paper-stack' | 'bottom-upright' | 'depth-layer'>,
    point?: { x: number; y: number },
  ): string | null
  addPresetVisual(
    spreadId: string,
    side: 'left' | 'right',
    presetId: Extract<VisualPresetId, 'light-particles' | 'page-text'>,
  ): string | null
  updateElement(spreadId: string, id: string, change: (element: StageElement) => void): void
  removeElement(spreadId: string, id: string): void
  clearContainerElements(spreadId: string, parentType: RootParentType): void
  addAsset(asset: Asset): void
  /** 音声を取り込んで作品全体のBGMにする。取り込みと割り当てで1操作 */
  assignBgm(asset: Asset): void
  clearBgm(): void
  replaceAsset(id: string, asset: Asset): void
  removeAsset(id: string): void
}
