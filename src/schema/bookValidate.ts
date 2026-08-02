import type { BookProject } from './bookPackage'
import { bookProjectSchema } from './bookPackage'
import { AUDIO_BYTE_LIMIT } from './assets'
import {
  COLOR_PROPERTIES,
  DISCRETE_PROPERTIES,
  NUMBER_PROPERTIES,
  VEC3_PROPERTIES,
  timelineTargetKey,
  type TimelineProperty,
  type TimelineTrack,
  type TimelineValue,
} from './timeline'

export interface BookValidationResult { ok: boolean; errors: string[]; warnings: string[] }
export function validateBookProject(data: unknown): BookValidationResult {
  const errors: string[] = [], warnings: string[] = []
  const parsed = bookProjectSchema.safeParse(data)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`schema: ${issue.path.join('.')}: ${issue.message}`)
    return { ok: false, errors, warnings }
  }
  const project = data as BookProject
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const used = new Set<string>()
  const useAsset = (id: string | undefined, expected: string[], label: string) => {
    if (!id) return
    used.add(id)
    const asset = assets.get(id)
    if (!asset) errors.push(`${label}: unregistered asset ${id}`)
    else if (!expected.includes(asset.type)) errors.push(`${label}: expected ${expected.join('/')}`)
  }
  const ids = project.assets.map((a) => a.id)
  if (new Set(ids).size !== ids.length) errors.push('duplicate asset id')
  const totalBytes = project.assets.reduce((total, asset) => total + (asset.bytes ?? 0), 0)
  if (totalBytes > 20 * 1024 * 1024) warnings.push(`package exceeds 20MB (${(totalBytes / 1024 / 1024).toFixed(1)}MB)`)
  // 音声は data URL のまま単一HTMLへ入る。取り込みでは弾くが、外から来た
  // パッケージは読めなくする必要が無いので警告に留める
  for (const asset of project.assets) {
    if (asset.type !== 'audio' || (asset.bytes ?? 0) <= AUDIO_BYTE_LIMIT) continue
    warnings.push(`${asset.name}: audio exceeds 3MB (${((asset.bytes ?? 0) / 1024 / 1024).toFixed(1)}MB)`)
  }
  useAsset(project.audio?.bgmAsset, ['audio'], 'BGM')
  useAsset(project.book.frontCover.frontAsset, ['image', 'svg'], 'front cover')
  useAsset(project.book.frontCover.backAsset, ['image', 'svg'], 'front cover reverse')
  useAsset(project.book.backCover.frontAsset, ['image', 'svg'], 'back cover inside')
  useAsset(project.book.backCover.backAsset, ['image', 'svg'], 'back cover')
  useAsset(project.book.appearance.backgroundAsset, ['image', 'svg'], 'stage background')
  for (const spread of project.book.spreads) {
    useAsset(spread.leftPage.backgroundAsset, ['image', 'svg'], `${spread.name} left page`)
    useAsset(spread.rightPage.backgroundAsset, ['image', 'svg'], `${spread.name} right page`)
    useAsset(spread.enterSound, ['audio'], `${spread.name} enter sound`)
    useAsset(spread.pageTurnSound, ['audio'], `${spread.name} page turn sound`)
    const elementIds = spread.elements.map((e) => e.id)
    if (new Set(elementIds).size !== elementIds.length) errors.push(`${spread.name}: duplicate element id`)
    for (const element of spread.elements) {
      if (element.parent.type === 'element' && !elementIds.includes(element.parent.elementId)) errors.push(`${element.name}: parent element not found`)
      if (element.sourcePreset === 'depth-layer') {
        if (element.parent.type !== 'left-page' && element.parent.type !== 'right-page') {
          errors.push(`${element.name}: a backdrop must sit directly under the left or right page`)
        }
        if (element.type === 'image') {
          const tracks = spread.timeline.tracks.filter(
            (track) => track.target.type === 'element' && track.target.elementId === element.id,
          )
          const positions = [
            element.baseTransform.position[0],
            ...tracks.filter((track) => track.property === 'position.x')
              .flatMap((track) => track.keys.map((key) => key.value))
              .filter((value): value is number => typeof value === 'number'),
          ]
          const scales = [
            Math.abs(element.baseTransform.scale[0]),
            ...tracks.filter((track) => track.property === 'scale.x' || track.property === 'scale')
              .flatMap((track) => track.keys.map((key) => key.value))
              .filter((value): value is number => typeof value === 'number')
              .map(Math.abs),
          ]
          const width = element.width * Math.max(...scales)
          const minimum = Math.min(...positions.map((x) => x - element.pivot[0] * width))
          const maximum = Math.max(...positions.map((x) => x + (1 - element.pivot[0]) * width))
          if (minimum < -project.book.format.pageWidth / 2 || maximum > project.book.format.pageWidth / 2) {
            errors.push(`${element.name}: backdrop position or scale exceeds the page width`)
          }
        }
      }
      if (element.type === 'image') {
        if (!element.asset) warnings.push(`${element.name}: no image assigned`)
        useAsset(element.asset || undefined, ['image', 'svg'], element.name)
        useAsset(element.backAsset, ['image', 'svg'], `${element.name} reverse`)
      }
      const elementTracks = spread.timeline.tracks.filter(
        (track) => track.target.type === 'element' && track.target.elementId === element.id,
      )
      if (element.sourcePreset === 'light-particles') {
        if (element.type !== 'effect') errors.push(`${element.name}: particle preset must be an effect`)
      }
      const everVisible = element.visible || elementTracks.some(
        (track) => track.property === 'visible' && track.keys.some((key) => key.value === true),
      )
      if (!everVisible) warnings.push(`${element.name}: hidden for the whole hold`)
      const opacityTrack = elementTracks.find((track) => track.property === 'opacity')
      if (element.opacity === 0 && !opacityTrack?.keys.some((key) => typeof key.value === 'number' && key.value > 0)) {
        warnings.push(`${element.name}: fully transparent for the whole hold`)
      }
    }
    validateTimeline(spread.timeline.tracks, spread.sequence.holdSeconds, spread.elements, assets, used, errors, warnings)
    if (spread.elements.length > 80) warnings.push(`${spread.name}: many parts shown at once`)
  }
  for (const asset of project.assets) if (!used.has(asset.id)) warnings.push(`unused asset: ${asset.name}`)
  return { ok: errors.length === 0, errors, warnings }
}

const ELEMENT_PROPERTIES = new Set<TimelineProperty>([
  'position.x', 'position.y', 'position.z',
  'rotation.x', 'rotation.y', 'rotation.z',
  'scale.x', 'scale.y', 'scale.z', 'scale',
  'opacity', 'visible', 'asset', 'effect.color', 'effect.size',
])
const ENVIRONMENT_PROPERTIES = new Set<TimelineProperty>([
  'background', 'ambient.color', 'ambient.intensity', 'directional.color', 'directional.intensity',
])
const CAMERA_PROPERTIES = new Set<TimelineProperty>(['position', 'target', 'fov'])

function validateTimeline(
  tracks: TimelineTrack[],
  holdSeconds: number,
  elements: BookProject['book']['spreads'][number]['elements'],
  assets: Map<string, BookProject['assets'][number]>,
  used: Set<string>,
  errors: string[],
  warnings: string[],
): void {
  const elementMap = new Map(elements.map((element) => [element.id, element]))
  const trackIds = tracks.map((track) => track.id)
  if (new Set(trackIds).size !== trackIds.length) errors.push('duplicate timeline track id')
  const lanes = new Set<string>()

  for (const track of tracks) {
    const lane = `${timelineTargetKey(track.target)}:${track.property}`
    if (lanes.has(lane)) errors.push(`${lane}: duplicate track for the same target and property`)
    lanes.add(lane)
    if (!track.keys.length) warnings.push(`${lane}: no keys`)

    if (track.target.type === 'element') {
      const element = elementMap.get(track.target.elementId)
      if (!element) {
        errors.push(`${lane}: target element not found`)
      } else if (!ELEMENT_PROPERTIES.has(track.property)
        || track.property === 'asset' && element.type !== 'image'
        || track.property.startsWith('effect.') && element.type !== 'effect') {
        errors.push(`${lane}: property not available on element type ${element.type}`)
      }
    } else if (track.target.type === 'environment' && !ENVIRONMENT_PROPERTIES.has(track.property)) {
      errors.push(`${lane}: property not available on the environment`)
    } else if (track.target.type === 'camera' && !CAMERA_PROPERTIES.has(track.property)) {
      errors.push(`${lane}: property not available on the camera`)
    } else if (track.target.type === 'sound') {
      // 効果音トラックは音声アセットを指し、キューだけを持つ
      if (track.property !== 'cue') errors.push(`${lane}: a sound track only takes cues`)
      const asset = assets.get(track.target.assetId)
      if (!asset) errors.push(`${lane}: sound asset not found`)
      else if (asset.type !== 'audio') errors.push(`${lane}: ${asset.name} is not audio`)
      else used.add(asset.id)
    }
    if (track.property === 'cue' && track.target.type !== 'sound') {
      errors.push(`${lane}: cues belong to a sound track`)
    }

    const times = new Set<number>()
    for (const key of track.keys) {
      if (key.time < 0 || key.time > holdSeconds) errors.push(`${lane}: key time ${key.time} is outside the hold`)
      if (times.has(key.time)) errors.push(`${lane}: duplicate key at time ${key.time}`)
      times.add(key.time)
      if (!timelineValueMatches(track.property, key.value)) errors.push(`${lane}: key value type does not match the property`)
      if (DISCRETE_PROPERTIES.has(track.property) && key.ease !== 'hold') errors.push(`${lane}: discrete properties only accept hold easing`)
      if (!DISCRETE_PROPERTIES.has(track.property) && key.ease === 'hold') errors.push(`${lane}: continuous properties cannot use hold easing`)
      if (track.property === 'asset' && typeof key.value === 'string') {
        used.add(key.value)
        const asset = assets.get(key.value)
        if (!asset) errors.push(`${lane}: unregistered asset ${key.value}`)
        else if (asset.type !== 'image' && asset.type !== 'svg') errors.push(`${lane}: expected image or svg`)
      }
    }
  }
}

function timelineValueMatches(property: TimelineProperty, value: TimelineValue): boolean {
  if (NUMBER_PROPERTIES.has(property)) return typeof value === 'number' && Number.isFinite(value)
  if (COLOR_PROPERTIES.has(property)) return typeof value === 'string'
  if (property === 'visible') return typeof value === 'boolean'
  // キューは時刻だけを持つ印。値は場所取りなので true で固定する
  if (property === 'cue') return value === true
  if (property === 'asset') return typeof value === 'string' && value.length > 0
  if (VEC3_PROPERTIES.has(property)) return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
  return false
}
