import type { ParentSpace, ParticleElement } from '../../schema/stageElement'
import type { EmbeddedVideoAudio } from '../../schema/audio'
import type { TimelineProperty, TimelineTarget, TimelineValue } from '../../schema/timeline'
import type { BookSelection, EditorMode, ProjectSource } from '../state/editorState'

export interface AiTargetSummary {
  kind: BookSelection['type']
  id?: string
  label: string
}

export interface AiElementSummary {
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

export interface AiTimelineKeySummary {
  id: string
  time: number
  value: TimelineValue
  ease: 'linear' | 'easeInOut' | 'hold'
}

export interface AiTimelineTrackSummary {
  id: string
  target: TimelineTarget
  property: TimelineProperty
  keys: AiTimelineKeySummary[]
}

export interface AiSpreadSummary {
  id: string
  name: string
  index: number
  holdSeconds: number
  turnSeconds: number
  leftPage: { backgroundAsset?: string }
  rightPage: { backgroundAsset?: string }
  elements: AiElementSummary[]
  timeline: AiTimelineTrackSummary[]
}

export interface AiAssetSummary {
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

export interface AiStateSummary {
  project: { id: string; name: string; source: ProjectSource }
  /** 素材本体を除く作品データ。AIがフォームを再走査せず現在値を照合できるようにする。 */
  book: import('../../schema/bookPackage').BookProject['book']
  audio?: import('../../schema/bookPackage').BookProject['audio']
  mode: EditorMode
  activeSpread?: { id: string; name: string; index: number; holdSeconds: number; turnSeconds: number }
  spreads: AiSpreadSummary[]
  selection: AiTargetSummary
  selectedElement?: AiElementSummary
  previewProgress: number
  spreadTime: number
  canUndo: boolean
  canRedo: boolean
  validation: { errors: string[]; warnings: string[] }
  assets: AiAssetSummary[]
}

export type AiCommandResult =
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
