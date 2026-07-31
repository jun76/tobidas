import { z } from 'zod'
import { vec3Schema } from './geometry'

export const timelineTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('element'), elementId: z.string().min(1) }),
  z.object({ type: z.literal('environment') }),
  z.object({ type: z.literal('camera') }),
  // 効果音は紙面の部品ではなくタイムラインの点。
  // 音声アセット1つにつき1トラックで、キーが「ここで鳴らす」印になる
  z.object({ type: z.literal('sound'), assetId: z.string().min(1) }),
])

export const timelinePropertySchema = z.enum([
  'position.x', 'position.y', 'position.z',
  'rotation.x', 'rotation.y', 'rotation.z',
  'scale.x', 'scale.y', 'scale.z', 'scale',
  'opacity', 'visible', 'asset',
  'effect.color', 'effect.size',
  'background',
  'ambient.color', 'ambient.intensity',
  'directional.color', 'directional.intensity',
  'position', 'target', 'fov',
  'cue',
])

export const timelineValueSchema = z.union([
  z.number(),
  z.boolean(),
  z.string(),
  vec3Schema,
])

export const timelineKeySchema = z.object({
  id: z.string().min(1),
  time: z.number().nonnegative(),
  value: timelineValueSchema,
  ease: z.enum(['linear', 'easeInOut', 'hold']),
})

export const timelineTrackSchema = z.object({
  id: z.string().min(1),
  target: timelineTargetSchema,
  property: timelinePropertySchema,
  keys: z.array(timelineKeySchema),
})

export const spreadTimelineSchema = z.object({
  tracks: z.array(timelineTrackSchema),
})

export type TimelineTarget = z.infer<typeof timelineTargetSchema>
export type TimelineProperty = z.infer<typeof timelinePropertySchema>
export type TimelineValue = z.infer<typeof timelineValueSchema>
export type TimelineKey = z.infer<typeof timelineKeySchema>
export type TimelineTrack = z.infer<typeof timelineTrackSchema>

export const NUMBER_PROPERTIES = new Set<TimelineProperty>([
  'position.x', 'position.y', 'position.z',
  'rotation.x', 'rotation.y', 'rotation.z',
  'scale.x', 'scale.y', 'scale.z', 'scale',
  'opacity', 'effect.size', 'ambient.intensity', 'directional.intensity', 'fov',
])

export const COLOR_PROPERTIES = new Set<TimelineProperty>([
  'effect.color', 'background', 'ambient.color', 'directional.color',
])

export const DISCRETE_PROPERTIES = new Set<TimelineProperty>(['visible', 'asset', 'cue'])
export const VEC3_PROPERTIES = new Set<TimelineProperty>(['position', 'target'])

export function timelineTargetKey(target: TimelineTarget): string {
  if (target.type === 'element') return `element:${target.elementId}`
  if (target.type === 'sound') return `sound:${target.assetId}`
  return target.type
}
