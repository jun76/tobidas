import type { BookProject } from '../schema/bookPackage'
import type { Spread } from '../schema/book'
import type { StageElement } from '../schema/stageElement'
import type { CompiledSpreadStow } from './stow/model'

export type RuntimeSelection =
  | { type: 'spread'; spreadId: string }
  | { type: 'page'; spreadId: string; side: 'left' | 'right' }
  | { type: 'element'; spreadId: string; elementId: string }

export interface BookRuntimeProps {
  project: BookProject
  progress: number
  foldOverride?: { spreadId: string; openness: number }
  showGuides?: boolean
  isHidden?: (spreadId: string, element: StageElement) => boolean
  onSelect?: (selection: RuntimeSelection) => void
  /** ビルダーでは再生モードだけtrue。公開プレイヤーは常にtrue。 */
  audioActive?: boolean
  audioMuted?: boolean
  /** 本の再生が一時停止中か。表示中の動画も同じ状態で停止・再開する。 */
  playing?: boolean
}

export interface RenderSpreadFrame {
  spread: Spread
  index: number
  t: number
  open: boolean
  stow: CompiledSpreadStow
  spreadTime: number
}
