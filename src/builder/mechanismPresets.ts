import { createStageElement } from '../schema/bookDefaults'
import { makeMechanism, mechanismSurfaceIds, type MechanismKind, type MechanismSpec } from '../schema/mechanism'
import type { AssemblyElement } from '../schema/stageElement'

export const compositionKinds = ['stage', 'meadow', 'arcade', 'steps', 'bridge', 'house', 'room', 'tree', 'cake', 'floating-stage', 'scene'] as const
export type CompositionKind = typeof compositionKinds[number]
export interface CompositionParameters { kind: CompositionKind; count: number; spacing: number }

/** 役割IDを固定し、段数を変えても残る面の素材と取り付けを維持する。 */
export function buildMechanismComposition(root: AssemblyElement, settings: CompositionParameters): AssemblyElement[] {
  const count = Math.max(1, Math.min(12, Math.round(settings.count)))
  const gap = settings.spacing
  const { width: w, depth: d } = root.mechanism.parameters
  const h = root.mechanism.parameters.height * 8
  const parts: AssemblyElement[] = []
  const color = ['#54845a', '#daa862', '#bd6266', '#6196a8', '#8b77b8', '#edcc83']
  const add = (role: string, kind: MechanismKind, parameters: Partial<MechanismSpec['parameters']>, position: [number, number, number],
    options: { parent?: AssemblyElement; surface?: string; u?: number; v?: number; rotation?: [number, number, number]; color?: string } = {}) => {
    const parent = options.parent ?? root
    const part = createStageElement('assembly', { type: 'element', elementId: parent.id }) as AssemblyElement
    part.id = `${root.id}/${role}`
    part.name = role
    part.mechanism = makeMechanism(kind, { parameters,
      mount: { type: 'surface', elementId: parent.id, surfaceId: options.surface ?? 'top', u: options.u ?? .5, v: options.v ?? .5, offset: 0 },
      staging: { closedScale: 1 }, deployment: { start: .16, end: .9 } })
    part.baseTransform = { position, rotation: options.rotation ?? [0, 0, 0], scale: [1, 1, 1] }
    for (const id of mechanismSurfaceIds(part.mechanism)) part.mechanism.surfaces[id] = { color: options.color ?? color[parts.length % color.length], visible: true }
    parts.push(part)
    return part
  }
  for (let i = 0; i < count; i++) {
    const x = (i - (count - 1) / 2) * gap
    if (settings.kind === 'stage') add(`scenery-${i}`, 'panel', { width: w * .9, height: h * (1 + i * .25) }, [0, 0, (i - (count - 1) / 2) * gap])
    if (settings.kind === 'meadow') {
      add(`grass-${i}`, 'panel', { width: w, height: h * .6 }, [0, 0, x])
      add(`flower-${i}`, 'beak', { width: h * .65, depth: h * .5, height: h * .5 }, [Math.sin(i * 2) * w * .3, h * .5, x])
    }
    if (settings.kind === 'arcade') {
      for (const side of [-1, 1]) add(`arch-${i}/pier-${side}`, 'panel', { width: w * .12, height: h * 2 }, [side * w * .4, 0, x], { color: '#bb9476' })
      add(`arch-${i}/lintel`, 'v-fold', { width: w, height: h * .7 }, [0, h * 2, x], { color: '#d7b990' })
    }
    if (settings.kind === 'steps') add(`step-${i}`, 'platform', { width: w * .8, height: h * (i + 1) / count, depth: d / count }, [0, 0, x])
    if (settings.kind === 'bridge') add(`span-${i}`, 'platform', { width: w / count, height: h, depth: d * .35 }, [x, 0, 0], { color: '#bc8554' })
    if (settings.kind === 'house') {
      const house = add(`house-${i}`, 'box', { width: w / Math.max(2, count), height: h, depth: d * .6 }, [x, 0, 0], { color: '#e5c789' })
      add(`roof-${i}`, 'v-fold', { width: w / Math.max(2, count) * 1.1, height: h * .6, depth: d * .7 }, [0, 0, 0],
        { parent: house, surface: 'top-left', u: 1, color: '#9e5a59' })
    }
    if (settings.kind === 'room') add(`bed-${i}`, 'platform', { width: w / Math.max(2, count), height: h * .4, depth: d * .55 }, [x, 0, 0], { color: '#799dab' })
    if (settings.kind === 'tree') {
      const trunk = add(`trunk-${i}`, 'panel', { width: h * .25, height: h * 2.5 }, [x, 0, 0], { color: '#966e49' })
      add(`crown-${i}`, 'accordion', { width: w / Math.max(1, count) * 1.8, height: h * 1.5, depth: h, segments: 10 }, [0, 0, 0],
        { parent: trunk, surface: 'panel', v: 1, color: '#5c8b59', rotation: [90, 0, 0] })
    }
    if (settings.kind === 'cake') {
      const parent = parts.find((part) => part.id === `${root.id}/tier-${i - 1}`) ?? root
      add(`tier-${i}`, 'curved-shell', { width: w * (1 - i / (count + 1) * .6), height: h, depth: d * (1 - i / (count + 1) * .6), segments: 24 }, [0, 0, 0],
        { parent, color: i % 2 ? '#e8a5b8' : '#fff0d1' })
    }
    if (settings.kind === 'floating-stage') {
      const part = add(`island-${i}`, i % 2 ? 'curved-shell' : 'platform', { width: w / 3, height: h * .5, depth: d / 3 }, [x, h * (1 + Math.sin(i) * .4), Math.cos(i) * d * .25])
      part.mechanism.staging.floatAmplitude = [.1, .2, .1]
      part.mechanism.staging.floatPhase = i * .8
    }
    if (settings.kind === 'scene') {
      const sceneKinds = ['house', 'tree', 'cake', 'arcade'] as const
      const width = w / Math.max(2, Math.ceil(count / 2))
      const part = add(`scene-${i}`, 'platform', { width, height: .14, depth: d * .4 },
        [(i % 2 ? 1 : -1) * w * .25, 0, (Math.floor(i / 2) - Math.floor((count - 1) / 2) / 2) * gap], { color: '#778769' })
      part.composition = { kind: sceneKinds[i % sceneKinds.length], count: 1, spacing: 1 }
      part.mechanism.deployment = { mode: 'virtual', start: .08 + i / count * .12, end: .8 + i / count * .15 }
      parts.push(...buildMechanismComposition(part, part.composition))
    }
  }
  if (settings.kind === 'room') {
    add('back-wall', 'panel', { width: w, height: h * 2 }, [0, 0, -d / 2], { color: '#b5c5bf' })
    add('side-wall', 'panel', { width: d, height: h * 2 }, [-w / 2, 0, 0], { rotation: [0, 90, 0], color: '#d1c4b1' })
  }
  return parts
}
