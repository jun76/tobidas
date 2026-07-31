import type { BookProject } from '../../schema/bookPackage'
import { bookId } from '../../schema/bookDefaults'
import { DISCRETE_PROPERTIES, timelineTargetKey, type TimelineProperty, type TimelineTarget, type TimelineValue } from '../../schema/timeline'

export function upsertProjectTimelineKey(
  project: BookProject,
  spreadId: string,
  target: TimelineTarget,
  property: TimelineProperty,
  time: number,
  value: TimelineValue,
): void {
  const spread = project.book.spreads.find((item) => item.id === spreadId)
  if (!spread) return
  const bounded = Math.min(spread.sequence.holdSeconds, Math.max(0, time))
  let track = spread.timeline.tracks.find(
    (item) => timelineTargetKey(item.target) === timelineTargetKey(target) && item.property === property,
  )
  if (!track) {
    track = { id: bookId('track'), target: structuredClone(target), property, keys: [] }
    spread.timeline.tracks.push(track)
  }
  const existing = track.keys.find((key) => Math.abs(key.time - bounded) < 0.001)
  const ease = DISCRETE_PROPERTIES.has(property) ? 'hold' as const : 'easeInOut' as const
  if (existing) {
    existing.value = structuredClone(value)
    existing.ease = ease
  } else {
    track.keys.push({ id: bookId('key'), time: bounded, value: structuredClone(value), ease })
    track.keys.sort((left, right) => left.time - right.time)
  }
}

