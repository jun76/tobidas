import * as THREE from 'three'
import type { BookCamera, BookLights, Spread } from '../../schema/book'
import type { StageElement } from '../../schema/stageElement'
import {
  COLOR_PROPERTIES,
  DISCRETE_PROPERTIES,
  NUMBER_PROPERTIES,
  VEC3_PROPERTIES,
  type TimelineProperty,
  type TimelineTrack,
  type TimelineValue,
} from '../../schema/timeline'

const EPSILON = 1e-9

export interface EnvironmentState {
  background: string
  lights: BookLights
}

export interface CameraPose {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

export function evaluateTimelineTrack(track: TimelineTrack, rawTime: number): TimelineValue | undefined {
  if (!track.keys.length) return undefined
  const keys = [...track.keys].sort((a, b) => a.time - b.time)
  const time = Math.max(0, rawTime)
  if (time <= keys[0].time) return cloneValue(keys[0].value)
  const last = keys[keys.length - 1]
  if (time >= last.time) return cloneValue(last.value)

  for (let index = 1; index < keys.length; index++) {
    const left = keys[index - 1]
    const right = keys[index]
    if (time > right.time) continue
    if (DISCRETE_PROPERTIES.has(track.property) || right.ease === 'hold') return cloneValue(left.value)
    const local = (time - left.time) / Math.max(EPSILON, right.time - left.time)
    const amount = right.ease === 'easeInOut' ? smooth(local) : local
    return interpolateValue(track.property, left.value, right.value, amount)
  }
  return cloneValue(last.value)
}

export function evaluateElementTimeline(element: StageElement, spread: Spread, time: number): StageElement {
  const tracks = spread.timeline.tracks.filter(
    (track) => track.target.type === 'element' && track.target.elementId === element.id && track.keys.length,
  )
  if (!tracks.length) return element

  const next = {
    ...element,
    baseTransform: {
      position: [...element.baseTransform.position] as [number, number, number],
      rotation: [...element.baseTransform.rotation] as [number, number, number],
      scale: [...element.baseTransform.scale] as [number, number, number],
    },
    ...(element.type === 'visual' ? { particles: { ...element.particles } } : {}),
  } as StageElement

  for (const track of tracks) {
    const value = evaluateTimelineTrack(track, time)
    if (value === undefined) continue
    applyElementProperty(next, track.property, value)
  }
  return next
}

export function evaluateSpreadCamera(spread: Spread, time: number, fallback: BookCamera): CameraPose {
  const pose: CameraPose = {
    position: [...fallback.position],
    target: [...fallback.target],
    fov: fallback.fov,
  }
  for (const track of spread.timeline.tracks) {
    if (track.target.type !== 'camera') continue
    const value = evaluateTimelineTrack(track, time)
    if (track.property === 'position' && isVec3(value)) pose.position = value
    else if (track.property === 'target' && isVec3(value)) pose.target = value
    else if (track.property === 'fov' && typeof value === 'number') pose.fov = value
  }
  return pose
}

export function evaluateSpreadEnvironment(
  spread: Spread,
  time: number,
  background: string,
  lights: BookLights,
): EnvironmentState {
  const state: EnvironmentState = {
    background,
    lights: structuredClone(lights),
  }
  for (const track of spread.timeline.tracks) {
    if (track.target.type !== 'environment') continue
    const value = evaluateTimelineTrack(track, time)
    switch (track.property) {
      case 'background': if (typeof value === 'string') state.background = value; break
      case 'ambient.color': if (typeof value === 'string') state.lights.ambient.color = value; break
      case 'ambient.intensity': if (typeof value === 'number') state.lights.ambient.intensity = value; break
      case 'directional.color': if (typeof value === 'string') state.lights.directional.color = value; break
      case 'directional.intensity': if (typeof value === 'number') state.lights.directional.intensity = value; break
      default: break
    }
  }
  return state
}

export function blendCamera(a: CameraPose, b: CameraPose, amount: number): CameraPose {
  const t = smooth(amount)
  return {
    position: lerpVec3(a.position, b.position, t),
    target: lerpVec3(a.target, b.target, t),
    fov: THREE.MathUtils.lerp(a.fov, b.fov, t),
  }
}

export function blendEnvironment(a: EnvironmentState, b: EnvironmentState, amount: number): EnvironmentState {
  const t = smooth(amount)
  return {
    background: lerpColor(a.background, b.background, t),
    lights: {
      ambient: {
        color: lerpColor(a.lights.ambient.color, b.lights.ambient.color, t),
        intensity: THREE.MathUtils.lerp(a.lights.ambient.intensity, b.lights.ambient.intensity, t),
      },
      directional: {
        color: lerpColor(a.lights.directional.color, b.lights.directional.color, t),
        intensity: THREE.MathUtils.lerp(a.lights.directional.intensity, b.lights.directional.intensity, t),
        position: lerpVec3(a.lights.directional.position, b.lights.directional.position, t),
      },
    },
  }
}

function applyElementProperty(element: StageElement, property: TimelineProperty, value: TimelineValue): void {
  const numberValue = typeof value === 'number' ? value : undefined
  switch (property) {
    case 'position.x': if (numberValue !== undefined) element.baseTransform.position[0] = numberValue; break
    case 'position.y': if (numberValue !== undefined) element.baseTransform.position[1] = numberValue; break
    case 'position.z': if (numberValue !== undefined) element.baseTransform.position[2] = numberValue; break
    case 'rotation.x': if (numberValue !== undefined) element.baseTransform.rotation[0] = numberValue; break
    case 'rotation.y': if (numberValue !== undefined) element.baseTransform.rotation[1] = numberValue; break
    case 'rotation.z': if (numberValue !== undefined) element.baseTransform.rotation[2] = numberValue; break
    case 'scale.x': if (numberValue !== undefined) element.baseTransform.scale[0] = numberValue; break
    case 'scale.y': if (numberValue !== undefined) element.baseTransform.scale[1] = numberValue; break
    case 'scale.z': if (numberValue !== undefined) element.baseTransform.scale[2] = numberValue; break
    case 'scale':
      if (numberValue !== undefined) element.baseTransform.scale = [numberValue, numberValue, numberValue]
      break
    case 'opacity':
      if (numberValue !== undefined) element.opacity = THREE.MathUtils.clamp(numberValue, 0, 1)
      break
    case 'visible':
      if (typeof value === 'boolean') element.visible = value
      break
    case 'visual.image':
      if (typeof value === 'string' && element.type === 'visual') element.image = value
      break
    case 'visual.foregroundColor':
      if (typeof value === 'string' && element.type === 'visual') element.foregroundColor = value
      break
    case 'visual.backgroundColor':
      if (typeof value === 'string' && element.type === 'visual') element.backgroundColor = value
      break
    case 'visual.width':
      if (numberValue !== undefined && element.type === 'visual') element.width = Math.max(0.001, numberValue)
      break
    case 'visual.height':
      if (numberValue !== undefined && element.type === 'visual') element.height = Math.max(0.001, numberValue)
      break
    case 'visual.particles.color':
      if (typeof value === 'string' && element.type === 'visual') element.particles.color = value
      break
    case 'visual.particles.size':
      if (numberValue !== undefined && element.type === 'visual') element.particles.size = Math.max(0.001, numberValue)
      break
    default: break
  }
}

function interpolateValue(
  property: TimelineProperty,
  left: TimelineValue,
  right: TimelineValue,
  amount: number,
): TimelineValue {
  if (NUMBER_PROPERTIES.has(property) && typeof left === 'number' && typeof right === 'number') {
    if (property.startsWith('rotation.')) return lerpAngleDegrees(left, right, amount)
    return THREE.MathUtils.lerp(left, right, amount)
  }
  if (COLOR_PROPERTIES.has(property) && typeof left === 'string' && typeof right === 'string') {
    return lerpColor(left, right, amount)
  }
  if (VEC3_PROPERTIES.has(property) && isVec3(left) && isVec3(right)) return lerpVec3(left, right, amount)
  return cloneValue(left)
}

function lerpAngleDegrees(left: number, right: number, amount: number): number {
  const delta = THREE.MathUtils.euclideanModulo(right - left + 180, 360) - 180
  return left + delta * amount
}

function lerpColor(left: string, right: string, amount: number): string {
  // CSS colors are converted into Three.js's linear working space by Color.setStyle.
  // Interpolate there and encode to sRGB only when serializing the authored color.
  const a = new THREE.Color(left)
  const b = new THREE.Color(right)
  return `#${a.lerp(b, amount).getHexString(THREE.SRGBColorSpace)}`
}

function lerpVec3(
  left: [number, number, number],
  right: [number, number, number],
  amount: number,
): [number, number, number] {
  return [
    THREE.MathUtils.lerp(left[0], right[0], amount),
    THREE.MathUtils.lerp(left[1], right[1], amount),
    THREE.MathUtils.lerp(left[2], right[2], amount),
  ]
}

function isVec3(value: TimelineValue | undefined): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === 'number')
}

function cloneValue(value: TimelineValue): TimelineValue {
  return Array.isArray(value) ? [...value] as [number, number, number] : value
}

function smooth(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}
