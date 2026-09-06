import * as THREE from 'three'
import type { Book, Spread } from '../../schema/book'
import type { AssemblyElement, StageElement } from '../../schema/stageElement'
import type { MechanismSurface, SurfaceAttachment } from '../../schema/mechanism'
import { mechanismSurfaceSize } from '../../schema/mechanism'
import type { Vec3 } from '../../schema/geometry'
import { evaluateElementTimeline } from '../timeline/evaluate'
import { evaluateContentMotion } from '../motion'
import { constrainSurfaceHinge } from './hinge'
import { bridgePointNames, driverFromBridge, evaluateMechanism, gutterDriver, surfaceFrame,
  type ConnectionExpected, type EvaluatedBridge, type EvaluatedMechanism, type MechanismDriver } from './evaluate'

type Surface = EvaluatedMechanism['surfaces'][number]
export interface AssemblySurfaceInstance {
  rootId: string; key: string; elementId: string; surface: Surface; material: MechanismSurface; matrix: THREE.Matrix4; opacity: number
}
export interface AssemblyVisualInstance {
  rootId: string; key: string; element: StageElement; matrix: THREE.Matrix4; opacity: number
}
export interface AssemblyConnection {
  elementId: string
  actual: { elementId: string; surfaceId: string; vertexId: string }
  expected: ConnectionExpected
}
export interface AssemblySceneIssue { elementId: string; code: string; severity: 'error' | 'warning'; message: string }
export interface AssemblyScene {
  surfaces: AssemblySurfaceInstance[]
  structuralSurfaces: AssemblySurfaceInstance[]
  visuals: AssemblyVisualInstance[]
  connections: AssemblyConnection[]
  bridges: (EvaluatedBridge & { elementId: string })[]
  issues: AssemblySceneIssue[]
  diagnostics: string[]
}
export interface AssemblySceneInput {
  open: number; leftAngle: number; rightAngle: number; spreadTime: number; clock: number
  isHidden?: (element: StageElement) => boolean
}

function visualTransform(element: StageElement, clock: number, amount: number, fold = false): THREE.Matrix4 {
  const base = element.baseTransform, motion = evaluateContentMotion(element.motion, clock)
  const p = base.position.map((n, i) => n + motion.position[i] * amount) as Vec3
  const r = base.rotation.map((n, i) => THREE.MathUtils.degToRad(n + motion.rotationDeg[i] * amount + motion.spinDeg[i])) as Vec3
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...r))
  if (fold) {
    // 単面上の起立片のヒンジ。複合機構の折り方には使用しない。
    const closed = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
    rotation.copy(closed.slerp(rotation, amount))
  }
  return new THREE.Matrix4().compose(new THREE.Vector3(...p), rotation,
    new THREE.Vector3(...base.scale).multiplyScalar(1 + (motion.scaleMul - 1) * amount))
}

/** 片ページの実座標で接着ヒンジを構成する。 */
function pageDriver(book: Book, element: AssemblyElement, input: AssemblySceneInput): MechanismDriver {
  const spec = element.mechanism
  if (spec.mount.type !== 'page') throw new Error('Page mount required')
  const side = spec.mount.side, left = side === 'left', angle = left ? input.leftAngle : input.rightAngle
  const rotation = angle - (left ? Math.PI : 0)
  const points = {} as MechanismDriver['points']
  for (const name of bridgePointNames) {
    const x = (name.startsWith('left') ? -.5 : name.startsWith('right') ? .5 : 0) * spec.parameters.width
    const distance = book.format.pageWidth / 2 + (left ? -1 : 1) * (element.baseTransform.position[0] + x)
    const z = element.baseTransform.position[2]
    points[name] = { position: [distance * Math.cos(angle), distance * Math.sin(angle), z], expected: { type: 'page', side, distance, z } }
  }
  const amount = Math.max(0, Math.min(1, (input.leftAngle - input.rightAngle) / Math.PI))
  return { points, restWidth: spec.parameters.width, restDepth: 0, restAngle: Math.PI,
    xAxis: [Math.cos(rotation), Math.sin(rotation), 0], yAxis: [-Math.sin(rotation), Math.cos(rotation), 0], zAxis: [0, 0, 1],
    panel: { angle: spec.parameters.angleDeg * Math.PI / 180 * amount } }
}

function surfacePanelDriver(parent: AssemblyElement, evaluated: EvaluatedMechanism, child: AssemblyElement, attachment: SurfaceAttachment): MechanismDriver {
  const nominalWidth = mechanismSurfaceSize(parent.mechanism, attachment.surfaceId).width
  const halfU = child.mechanism.parameters.width / nominalWidth / 2
  if (attachment.u - halfU < -1e-7 || attachment.u + halfU > 1 + 1e-7 || attachment.offset !== 0) throw new Error('Panel hinge must fit on its parent surface with zero attachment offset')
  if (attachment.surfaceId === 'top' && ['platform', 'curved-shell'].includes(parent.mechanism.kind)
    && attachment.u - halfU < .5 - 1e-7 && attachment.u + halfU > .5 + 1e-7) {
    throw new Error('A single surface panel cannot cross the parent crease; split it across the two faces')
  }
  const frame = surfaceFrame(evaluated, attachment.surfaceId, attachment.u, attachment.v)!
  const points = {} as MechanismDriver['points']
  for (const name of bridgePointNames) {
    const u = attachment.u + (name.startsWith('left') ? -halfU : name.startsWith('right') ? halfU : 0)
    const point = surfaceFrame(evaluated, attachment.surfaceId, u, attachment.v)!
    points[name] = { position: point.position, expected: { type: 'surface', elementId: parent.id, surfaceId: attachment.surfaceId, weights: point.weights } }
  }
  return { points, restWidth: child.mechanism.parameters.width, restDepth: 0, restAngle: Math.PI,
    xAxis: frame.xAxis, yAxis: frame.yAxis, zAxis: frame.zAxis,
    panel: { angle: child.mechanism.parameters.angleDeg * Math.PI / 180 * evaluated.openFactor } }
}

/**
 * 全assemblyの頂点は実ページ/親面から直接世界座標へ解く。
 * 任意の全体収納行列は存在しない。最終行列と構造面を監査へ公開する。
 */
export function evaluateAssemblyScene(book: Book, spread: Spread, input: AssemblySceneInput): AssemblyScene {
  const scene: AssemblyScene = { surfaces: [], structuralSurfaces: [], visuals: [], connections: [], bridges: [], issues: [], diagnostics: [] }
  const children = new Map<string, StageElement[]>()
  for (const element of spread.elements) if (element.parent.type === 'element') children.set(element.parent.elementId, [...(children.get(element.parent.elementId) ?? []), element])
  const issue = (elementId: string, code: string, message: string, severity: 'error' | 'warning' = 'error') => {
    scene.issues.push({ elementId, code, message, severity }); scene.diagnostics.push(`${elementId}: ${message}`)
  }
  const visited = new Set<string>()
  const visual = (source: StageElement, matrix: THREE.Matrix4, opacity: number, amount: number, rootId: string, fold: boolean) => {
    if (visited.has(source.id)) { issue(source.id, 'cyclic-hierarchy', 'Cyclic visual hierarchy'); return }
    visited.add(source.id)
    const element = evaluateElementTimeline(source, spread, input.spreadTime)
    if (!element.visible || input.isHidden?.(element) || opacity <= .001) return
    if (element.type === 'assembly') { issue(element.id, 'unsupported-parent', 'Folding children require an assembly bridge'); return }
    const start = scene.visuals.length
    const world = matrix.clone().multiply(visualTransform(element, input.clock, amount, fold))
    if (element.type !== 'group') scene.visuals.push({ rootId, key: element.id, element, matrix: world, opacity })
    for (const child of children.get(element.id) ?? []) visual(child, world, opacity * element.opacity, amount, rootId, false)
    if (fold) {
      const entries = scene.visuals.slice(start), inverse = world.clone().invert(), points: THREE.Vector3[] = []
      for (const entry of entries) {
        const visual = entry.element
        if (visual.type !== 'visual' && visual.type !== 'particle') continue
        const local = inverse.clone().multiply(entry.matrix)
        for (const u of [0, 1]) for (const v of [0, 1]) points.push(new THREE.Vector3((u - visual.pivot[0]) * visual.width, (v - visual.pivot[1]) * visual.height, 0).applyMatrix4(local))
      }
      const result = constrainSurfaceHinge({ parent: matrix, authored: visualTransform(element, input.clock, amount),
        points, open: amount, leftAngle: input.leftAngle, rightAngle: input.rightAngle })
      const correction = result.matrix.multiply(inverse)
      for (const entry of entries) entry.matrix.premultiply(correction)
      if (result.invalidBase) issue(element.id, 'invalid-hinge-footprint', 'The flat surface attachment footprint crosses a real page')
    }
  }
  const visit = (source: AssemblyElement, driver: MechanismDriver, opacity: number, rootId: string) => {
    if (visited.has(source.id)) { issue(source.id, 'cyclic-hierarchy', 'Cyclic assembly hierarchy'); return }
    visited.add(source.id)
    const element = evaluateElementTimeline(source, spread, input.spreadTime) as AssemblyElement
    const evaluated = evaluateMechanism(element.mechanism, { ...input, driver })
    const visible = element.visible && !input.isHidden?.(element) && evaluated.drawn
    const currentOpacity = visible ? opacity * element.opacity * evaluated.opacity : 0
    for (const diagnostic of evaluated.diagnostics) issue(element.id, diagnostic.code, diagnostic.message, diagnostic.severity)
    for (const surface of evaluated.surfaces) {
      const material = element.mechanism.surfaces[surface.id] ?? { color: '#f3c980', visible: true }
      const entry = { rootId, key: `${element.id}/${surface.id}`, elementId: element.id, surface, material, matrix: new THREE.Matrix4(), opacity: currentOpacity }
      scene.structuralSurfaces.push(entry)
      if (material.visible && currentOpacity > .001) scene.surfaces.push(entry)
    }
    for (const anchor of evaluated.anchors) scene.connections.push({ elementId: element.id,
      actual: { elementId: element.id, surfaceId: anchor.surfaceId, vertexId: anchor.id }, expected: anchor.expected })
    for (const bridge of evaluated.bridges) scene.bridges.push({ ...bridge, elementId: element.id })
    for (const childSource of children.get(element.id) ?? []) {
      const child = evaluateElementTimeline(childSource, spread, input.spreadTime)
      if (child.type === 'assembly') {
        try {
          if (child.mechanism.mount.type === 'bridge') {
            const mount = child.mechanism.mount
            if (mount.elementId !== element.id) throw new Error('Bridge parent does not match the hierarchy')
            const bridge = evaluated.bridges.find((candidate) => candidate.id === mount.bridgeId)
            if (!bridge) throw new Error(`Unknown bridge ${mount.bridgeId}`)
            visit(child, driverFromBridge(bridge, child.mechanism, element.id), currentOpacity, rootId)
          } else if (child.mechanism.mount.type === 'surface' && child.mechanism.kind === 'panel') {
            const mount = child.mechanism.mount
            if (mount.elementId !== element.id) throw new Error('Surface parent does not match the hierarchy')
            visit(child, surfacePanelDriver(element, evaluated, child, mount), currentOpacity, rootId)
          } else issue(child.id, 'missing-driver', 'Folding children require a parent bridge; single surfaces support panels only')
        } catch (error) { issue(child.id, 'invalid-driver', error instanceof Error ? error.message : String(error)) }
      } else {
        const attachment = child.surfaceAttachment
        if (!attachment) { issue(child.id, 'missing-surface', 'Missing surface attachment'); continue }
        const frame = surfaceFrame(evaluated, attachment.surfaceId, attachment.u, attachment.v, attachment.offset)
        if (!frame) { issue(child.id, 'unknown-surface', `Unknown surface ${attachment.surfaceId}`); continue }
        visual(childSource, new THREE.Matrix4().fromArray(frame.matrix), currentOpacity, evaluated.openFactor, rootId, true)
      }
    }
  }
  for (const element of spread.elements) if (element.type === 'assembly' && element.parent.type !== 'element') {
    const mount = element.mechanism.mount
    if (mount.type !== 'gutter' && mount.type !== 'page') { issue(element.id, 'missing-real-root', 'Every root must attach to a real page or gutter'); continue }
    const driver = mount.type === 'page' ? pageDriver(book, element, input) : gutterDriver(element.mechanism, input.leftAngle, input.rightAngle, element.baseTransform.position[2])
    visit(element, driver, 1, element.id)
  }
  return scene
}

export function assemblySceneBounds(scene: Pick<AssemblyScene, 'surfaces' | 'visuals'>): THREE.Box3 {
  const bounds = new THREE.Box3()
  for (const { surface, matrix } of scene.surfaces) for (let i = 0; i < surface.positions.length; i += 3) bounds.expandByPoint(new THREE.Vector3(surface.positions[i], surface.positions[i + 1], surface.positions[i + 2]).applyMatrix4(matrix))
  for (const { element, matrix } of scene.visuals) {
    if (element.type !== 'visual' && element.type !== 'particle') continue
    for (const u of [0, 1]) for (const v of [0, 1]) bounds.expandByPoint(new THREE.Vector3((u - element.pivot[0]) * element.width, (v - element.pivot[1]) * element.height, 0).applyMatrix4(matrix))
  }
  return bounds
}
