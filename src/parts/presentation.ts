import type { StageElement } from '../schema/stageElement'
import type { TimelineTrack } from '../schema/timeline'

/** 本体の移動・拡縮・出現は演出。紙に印刷した絵柄の切替だけは紙の支持を維持する。 */
export function requiresFiction(element: Pick<StageElement, 'type' | 'motion'> & Partial<Pick<StageElement, 'parent' | 'attachment'>>, tracks: TimelineTrack[], printed = false): boolean {
  return Boolean(element.motion.length || element.type === 'particle' || element.attachment?.type === 'visual'
    || !element.attachment && element.parent?.type === 'element'
    || tracks.some(track => /^(position|rotation|scale|visual\.(width|height))/.test(track.property)
      || !printed && ['opacity', 'visible'].includes(track.property) && new Set(track.keys.map(key => JSON.stringify(key.value))).size > 1))
}
