import { createStageElement } from '../schema/bookDefaults'
import { makeMechanism, mechanismSurfaceIds, type MechanismKind, type MechanismSpec } from '../schema/mechanism'
import type { AssemblyElement } from '../schema/stageElement'

export const compositionKinds = ['stage', 'meadow', 'arcade', 'steps', 'bridge', 'house', 'room', 'tree', 'cake', 'floating-stage', 'scene'] as const
export type CompositionKind = typeof compositionKinds[number]
export interface CompositionParameters { kind: CompositionKind; count: number; spacing: number }

/** 根元そのものが作品の形を持つ。全プリセットを仮想の台へ載せない。 */
export function compositionRootMechanism(kind: CompositionKind, width: number, depth: number, mount: MechanismSpec['mount'] = { type: 'gutter' }): MechanismSpec {
  const shapes: Record<CompositionKind, [MechanismKind, number]> = {
    stage: ['v-fold', 1.8], meadow: ['accordion', .55], arcade: ['v-fold', 2.2], steps: ['platform', .4],
    bridge: ['platform', 1], house: ['box', 1.8], room: ['box', 1.8], tree: ['v-fold', 2.8],
    cake: ['curved-shell', 1], 'floating-stage': ['platform', .8], scene: ['v-fold', 1.2],
  }
  const [primitive, height] = shapes[kind]
  const spec = makeMechanism(primitive, { parameters: { width, depth, height }, mount, deployment: { mode: 'page-constrained' } })
  if (kind === 'room') for (const id of ['front-left', 'front-right', 'top-left', 'top-right']) spec.surfaces[id] = { color: '#c8d0bd', visible: false }
  return spec
}

/** 折れる子は両面を跨ぐ。単面の飾りだけ、指定面のヒンジを使う。 */
export function buildMechanismComposition(root: AssemblyElement, settings: CompositionParameters): AssemblyElement[] {
  const count = Math.max(1, Math.min(12, Math.round(settings.count)))
  const { width: w, depth: d, height: h } = root.mechanism.parameters
  const parts: AssemblyElement[] = []
  const colors = ['#54845a', '#daa862', '#bd6266', '#6196a8', '#8b77b8', '#edcc83']
  const finish = (role: string, spec: MechanismSpec, parent: AssemblyElement, color?: string) => {
    const part = createStageElement('assembly', { type: 'element', elementId: parent.id }) as AssemblyElement
    part.id = `${root.id}/${role}`; part.name = role; part.mechanism = spec
    part.baseTransform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    for (const id of mechanismSurfaceIds(spec)) spec.surfaces[id] ??= { color: color ?? colors[parts.length % colors.length], visible: true }
    parts.push(part)
    return part
  }
  const bridge = (role: string, kind: MechanismKind, parent: AssemblyElement, width: number, depth: number, height: number, v = .5, color?: string) =>
    finish(role, makeMechanism(kind, { parameters: { width, depth, height }, mount: { type: 'bridge', elementId: parent.id, bridgeId: 'deck', v }, deployment: { mode: 'page-constrained' } }), parent, color)
  const panel = (role: string, parent: AssemblyElement, surfaceId: string, width: number, height: number, u: number, v: number, color?: string) =>
    finish(role, makeMechanism('panel', { parameters: { width, height }, mount: { type: 'surface', elementId: parent.id, surfaceId, u, v, offset: 0 }, deployment: { mode: 'page-constrained' } }), parent, color)
  // 反復要素は綴じ目方向の有限領域へ並べ、左右へ移して接続線を外さない。
  const row = (index: number, partDepth: number) => .5 + (index - (count - 1) / 2)
    * Math.min(settings.spacing, Math.max(0, d - partDepth) / Math.max(1, count - 1)) / Math.max(1e-9, d - partDepth)

  if (settings.kind === 'stage') for (let i = 0; i < count; i++) panel(`scenery-${i}`, root, i % 2 ? 'wing-right' : 'wing-left', w * .25, .6 + i * .12, .55, (i + .5) / count)
  if (settings.kind === 'meadow') for (let i = 0; i < count; i++) {
    const id = `fold-${Math.min(root.mechanism.parameters.segments - 1, Math.floor(i / count * root.mechanism.parameters.segments))}`
    panel(`grass-${i}`, root, id, w / root.mechanism.parameters.segments * .8, .45, .5, .3, '#60934f')
    panel(`flower-${i}`, root, id, w / root.mechanism.parameters.segments * .6, .6, .5, .75, '#e5ae73')
  }
  if (settings.kind === 'arcade') for (let i = 0; i < count; i++) {
    const arch = bridge(`arch-${i}`, 'v-fold', root, w * .8, d / count * .6, .9, row(i, d / count * .6), '#c6a482')
    for (const side of ['left', 'right']) panel(`arch-${i}/pier-${side}`, arch, `wing-${side}`, w * .08, .65, .1, .5, '#a98666')
  }
  if (settings.kind === 'steps') {
    let parent = root
    for (let i = 0; i < count; i++) parent = bridge(`step-${i}`, 'platform', parent, parent.mechanism.parameters.width * .8, parent.mechanism.parameters.depth * .8, .35)
  }
  if (settings.kind === 'bridge') for (let i = 0; i < count; i++) {
    for (const [side, center] of [['left', .25], ['right', .75]] as const) {
      const u = center + ((i + .5) / count - .5) / 2
      panel(`rail-front-${side}-${i}`, root, 'top', w / count * .4, .35, u, .05, '#ae794b')
      panel(`rail-back-${side}-${i}`, root, 'top', w / count * .4, .35, u, .95, '#ae794b')
    }
  }
  if (settings.kind === 'house') {
    bridge('roof-0', 'v-fold', root, w * .95, d * .95, h * .6, .5, '#a65852')
    for (let i = 0; i < count; i++) panel(`window-${i}`, root, 'wall-right', .4, .45, (i + .5) / count, .5, '#edd397')
  }
  if (settings.kind === 'room') for (let i = 0; i < count; i++) panel(`furniture-${i}`, root, 'wall-left', .6, .5, (i + .5) / count, .2, '#849e9b')
  if (settings.kind === 'tree') {
    const crown = bridge('crown-0', 'accordion', root, w * .9, d * .85, 1.1, .5, '#5b8a50')
    for (let i = 0; i < count; i++) panel(`leaf-${i}`, crown, `fold-${Math.floor(i / count * crown.mechanism.parameters.segments)}`, .45, .5, .5, .5, '#74a65b')
  }
  if (settings.kind === 'cake') {
    let parent = root
    for (let i = 0; i < count; i++) parent = bridge(`tier-${i}`, 'curved-shell', parent, parent.mechanism.parameters.width * .6, parent.mechanism.parameters.depth * .6, .7, .5, i % 2 ? '#f0c6d2' : '#fff0d1')
  }
  if (settings.kind === 'floating-stage') for (let i = 0; i < count; i++) {
    // 初期状態は実接続。浮遊・拡大は利用者が明示したときだけ使う。
    bridge(`island-${i}`, i % 2 ? 'curved-shell' : 'platform', root, w * .7, d / count * .6, .5, row(i, d / count * .6))
  }
  if (settings.kind === 'scene') for (let i = 0; i < count; i++) {
    const kind = (['house', 'tree', 'cake', 'arcade'] as const)[i % 4], depth = d / count * .7
    const part = finish(`scene-${i}`, compositionRootMechanism(kind, w * .65, depth, { type: 'bridge', elementId: root.id, bridgeId: 'deck', v: row(i, depth) }), root)
    part.composition = { kind, count: 1, spacing: 1 }
    parts.push(...buildMechanismComposition(part, part.composition))
  }
  return parts
}
