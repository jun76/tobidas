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
  /** 本の再生が一時停止中か。音声ONなら動画は内蔵音声を保つため再生を続ける。 */
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
