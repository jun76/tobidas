import type { ParentSpace, ParticleElement } from '../../schema/stageElement'
import type { EmbeddedVideoAudio } from '../../schema/audio'
import type { TimelineProperty, TimelineTarget, TimelineValue } from '../../schema/timeline'
import type { BookSelection, EditorMode, ProjectSource } from '../state/editorState'

export interface TargetSummary {
  kind: BookSelection['type']
  id?: string
  label: string
}

export interface ElementSummary {
  id: string
  name: string
  type: string
  parent: ParentSpace
  spreadId: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
  pivot: [number, number]
  layer: number
  visible: boolean
  opacity: number
  width?: number
  height?: number
  billboard?: boolean
  image?: string
  backImage?: string
  videoAudio?: EmbeddedVideoAudio
  backVideoAudio?: EmbeddedVideoAudio
  text?: string
  particles?: boolean
  particleSettings?: ParticleElement['particles']
  motion: string[]
  trackIds: string[]
}

export interface TimelineKeySummary {
  id: string
  time: number
  value: TimelineValue
  ease: 'linear' | 'easeInOut' | 'hold'
}

export interface TimelineTrackSummary {
  id: string
  target: TimelineTarget
  property: TimelineProperty
  keys: TimelineKeySummary[]
}

export interface SpreadSummary {
  id: string
  name: string
  index: number
  holdSeconds: number
  turnSeconds: number
  leftPage: { backgroundAsset?: string }
  rightPage: { backgroundAsset?: string }
  elements: ElementSummary[]
  timeline: TimelineTrackSummary[]
}

export interface AssetSummary {
  id: string
  name: string
  type: string
  mime: string
  bytes?: number
  width?: number
  height?: number
  duration?: number
  references: number
}

export interface BuilderStateSummary {
  project: { id: string; name: string; source: ProjectSource }
  /** 素材本体を除く作品データ。AIがフォームを再走査せず現在値を照合できるようにする。 */
  book: import('../../schema/bookPackage').BookProject['book']
  audio?: import('../../schema/bookPackage').BookProject['audio']
  mode: EditorMode
  activeSpread?: { id: string; name: string; index: number; holdSeconds: number; turnSeconds: number }
  spreads: SpreadSummary[]
  selection: TargetSummary
  selectedElement?: ElementSummary
  previewProgress: number
  spreadTime: number
  canUndo: boolean
  canRedo: boolean
  validation: { errors: string[]; warnings: string[] }
  assets: AssetSummary[]
}

export type BuilderCommandResult =
  | {
    ok: true
    action: string
    target?: { kind: string; id: string }
    message: string
    corrections: string[]
    validation: { errors: number; warnings: number }
  }
  | {
    ok: false
    action: string
    message: string
    fieldErrors: Record<string, string>
  }
