import type { StoreApi } from 'zustand'
import type { BookProject } from '../../schema/bookPackage'
import type { TimelineProperty } from '../../schema/timeline'
import { compileBookBeats, playbackDurationSeconds } from '../../runtime/signals'
import type { EditorState } from './editorState'
import { normalizeElementLayout } from './elementConstraints'
import { upsertProjectTimelineKey } from './timelineProject'

type TimelineCommands = Pick<EditorState,
  | 'setTimelineKeyEase'
  | 'setSpreadTime'
  | 'upsertTimelineKey'
  | 'updateTimelineKeyTime'
  | 'removeTimelineKey'
  | 'removeTimelineTrack'
  | 'upsertCameraKeys'
  | 'applyGizmoTransform'
>

interface TimelineCommandContext {
  commit(change: (project: BookProject) => void): void
  get: StoreApi<EditorState>['getState']
  set: StoreApi<EditorState>['setState']
}

export function createTimelineCommands({ commit, get, set }: TimelineCommandContext): TimelineCommands {
  return {
    setTimelineKeyEase: (spreadId, trackId, keyId, ease) => commit((project) => {
      const spread = project.book.spreads.find((item) => item.id === spreadId)
      const key = spread?.timeline.tracks.find((item) => item.id === trackId)?.keys.find((item) => item.id === keyId)
      if (key) key.ease = ease
    }),
    setSpreadTime: (spreadId, seconds) => {
      const book = get().project.book
      const spread = book.spreads.find((item) => item.id === spreadId)
      const hold = compileBookBeats(book).find((beat) => beat.kind === 'hold' && beat.spreadId === spreadId)
      if (!spread || !hold) return
      const bookTime = hold.startSeconds + Math.min(spread.sequence.holdSeconds, Math.max(0, seconds))
      set({ previewProgress: bookTime / playbackDurationSeconds(book), activeSpreadId: spreadId })
    },
    upsertTimelineKey: (spreadId, target, property, time, value) => commit((project) => {
      upsertProjectTimelineKey(project, spreadId, target, property, time, value)
    }),
    updateTimelineKeyTime: (spreadId, trackId, keyId, time) => commit((project) => {
      const spread = project.book.spreads.find((item) => item.id === spreadId)
      const track = spread?.timeline.tracks.find((item) => item.id === trackId)
      const key = track?.keys.find((item) => item.id === keyId)
      if (!spread || !track || !key) return
      key.time = Math.min(spread.sequence.holdSeconds, Math.max(0, time))
      const duplicate = track.keys.find((item) => item.id !== keyId && Math.abs(item.time - key.time) < 0.001)
      if (duplicate) track.keys = track.keys.filter((item) => item.id !== duplicate.id)
      track.keys.sort((a, b) => a.time - b.time)
    }),
    removeTimelineKey: (spreadId, trackId, keyId) => {
      commit((project) => {
        const spread = project.book.spreads.find((item) => item.id === spreadId)
        const track = spread?.timeline.tracks.find((item) => item.id === trackId)
        if (!spread || !track) return
        track.keys = track.keys.filter((key) => key.id !== keyId)
        if (!track.keys.length) spread.timeline.tracks = spread.timeline.tracks.filter((item) => item.id !== trackId)
      })
      if (get().selectedKey?.keyId === keyId) set({ selectedKey: null })
    },
    removeTimelineTrack: (spreadId, trackId) => {
      commit((project) => {
        const spread = project.book.spreads.find((item) => item.id === spreadId)
        if (spread) spread.timeline.tracks = spread.timeline.tracks.filter((track) => track.id !== trackId)
      })
      if (get().selectedKey?.trackId === trackId) set({ selectedKey: null })
    },
    upsertCameraKeys: (spreadId, time, pose) => commit((project) => {
      upsertProjectTimelineKey(project, spreadId, { type: 'camera' }, 'position', time, pose.position)
      upsertProjectTimelineKey(project, spreadId, { type: 'camera' }, 'target', time, pose.target)
      upsertProjectTimelineKey(project, spreadId, { type: 'camera' }, 'fov', time, pose.fov)
    }),
    applyGizmoTransform: (spreadId, elementId, time, transform) => commit((project) => {
      const spread = project.book.spreads.find((item) => item.id === spreadId)
      const element = spread?.elements.find((item) => item.id === elementId)
      if (!spread || !element) return
      const bounded = structuredClone(element)
      bounded.baseTransform = structuredClone(transform)
      const index = spread.elements.indexOf(element)
      spread.elements[index] = bounded
      normalizeElementLayout(spread, elementId, project.book.format.pageWidth)
      const next = bounded.baseTransform
      element.parent = structuredClone(bounded.parent)
      const target = { type: 'element' as const, elementId }
      const governed = (property: TimelineProperty) => spread.timeline.tracks.some((track) =>
        track.target.type === 'element' && track.target.elementId === elementId
        && track.property === property && track.keys.length > 0)
      if (governed('scale')) {
        upsertProjectTimelineKey(project, spreadId, target, 'scale', time, (next.scale[0] + next.scale[1] + next.scale[2]) / 3)
      }
      for (const group of ['position', 'rotation', 'scale'] as const) {
        if (group === 'scale' && governed('scale')) continue
        ;(['x', 'y', 'z'] as const).forEach((axis, index) => {
          const property = `${group}.${axis}` as TimelineProperty
          if (governed(property)) upsertProjectTimelineKey(project, spreadId, target, property, time, next[group][index])
          else element.baseTransform[group][index] = next[group][index]
        })
      }
      spread.elements[index] = element
      normalizeElementLayout(spread, elementId, project.book.format.pageWidth)
    }),
  }
}
