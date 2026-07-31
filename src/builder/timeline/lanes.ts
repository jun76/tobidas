import type { Asset } from '../../schema/assets'
import type { Spread } from '../../schema/book'
import { t } from '../i18n'
import { DISCRETE_PROPERTIES, type TimelineTrack } from '../../schema/timeline'

export interface TimelineLane {
  /** 'sound' は音声レーン。紙面の部品ではなく、鳴らす点だけを持つ */
  kind: 'visual' | 'sound'
  id: string
  track: TimelineTrack
  targetName: string
  discrete: boolean
}

/**
 * トラックを表示用laneへ変換する。ここが schema 探索の境界で、
 * 描画側は lane だけを見る。
 */
export function collectTimelineLanes(spread: Spread, assets: readonly Asset[] = []): TimelineLane[] {
  const elementNames = new Map(spread.elements.map((element) => [element.id, element.name]))
  const assetNames = new Map(assets.map((asset) => [asset.id, asset.name]))
  return spread.timeline.tracks.map((track) => ({
    kind: track.target.type === 'sound' ? 'sound' : 'visual',
    id: track.id,
    track,
    targetName: track.target.type === 'element'
      ? elementNames.get(track.target.elementId) ?? track.target.elementId
      : track.target.type === 'sound' ? assetNames.get(track.target.assetId) ?? track.target.assetId
      : track.target.type === 'camera' ? t().timeline.laneCamera : t().timeline.laneEnvironment,
    discrete: DISCRETE_PROPERTIES.has(track.property),
  }))
}
