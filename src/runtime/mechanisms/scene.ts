import * as THREE from 'three'
import type { Book, Spread } from '../../schema/book'
import type { AssemblyElement, StageElement } from '../../schema/stageElement'
import type { MechanismSurface, SurfaceAttachment } from '../../schema/mechanism'
import { evaluateElementTimeline } from '../timeline/evaluate'
import { evaluateContentMotion } from '../motion'
import { evaluateMechanism, surfaceFrame } from './evaluate'
import { compileVirtualStow, evaluateVirtualStow, type VirtualStowPlan } from './stow'
import { evaluateSurfaceStow } from './surfaceStow'

type Evaluated = ReturnType<typeof evaluateMechanism>
type Surface = Evaluated['surfaces'][number]
export interface AssemblySurfaceInstance {
  rootId: string
  key: string
  elementId: string
  surface: Surface
  material: MechanismSurface
  matrix: THREE.Matrix4
  opacity: number
}
export interface AssemblyVisualInstance {
  rootId: string
  key: string
  element: StageElement
  matrix: THREE.Matrix4
  opacity: number
}
export interface AssemblyScene {
  surfaces: AssemblySurfaceInstance[]
  visuals: AssemblyVisualInstance[]
  diagnostics: string[]
}
export interface AssemblySceneInput {
  open: number
  leftAngle: number
  rightAngle: number
  spreadTime: number
  clock: number
  isHidden?: (element: StageElement) => boolean
}

function transformMatrix(element: StageElement, clock: number, amount: number, foldToSurface = false): THREE.Matrix4 {
  const base = element.baseTransform
  const motion = evaluateContentMotion(element.motion, clock)
  const p = base.position.map((n, i) => n + motion.position[i] * amount) as [number, number, number]
  const r = base.rotation.map((n, i) => THREE.MathUtils.degToRad(n + motion.rotationDeg[i] * amount + motion.spinDeg[i])) as [number, number, number]
  const scale = 1 + (motion.scaleMul - 1) * amount
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...r))
  if (foldToSurface) {
    const f = Math.max(0, Math.min(1, (amount - .22) / .7))
    const folded = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
    rotation.copy(folded.slerp(rotation, f * f * (3 - 2 * f)))
  }
  return new THREE.Matrix4().compose(new THREE.Vector3(...p), rotation,
    new THREE.Vector3(...base.scale).multiplyScalar(scale))
}

/** 面上の局所Yは法線方向。人物を天板に置くと、そのまま直立する。 */
function attachmentMatrix(result: Evaluated, attachment: SurfaceAttachment): THREE.Matrix4 | undefined {
  const frame = surfaceFrame(result, attachment.surfaceId, attachment.u, attachment.v, attachment.offset)
  if (!frame) return undefined
  return new THREE.Matrix4().fromArray(frame.matrix)
}

/** 描画、境界検査、面上追従が同一の評価結果を使う。 */
function evaluateLocalScene(book: Book, spread: Spread, input: AssemblySceneInput): AssemblyScene {
  const scene: AssemblyScene = { surfaces: [], visuals: [], diagnostics: [] }
  const children = new Map<string, StageElement[]>()
  for (const e of spread.elements) if (e.parent.type === 'element') {
    children.set(e.parent.elementId, [...(children.get(e.parent.elementId) ?? []), e])
  }
  const visited = new Set<string>()
  let rootId = ''
  let physicalRoot = false
  const visitVisual = (source: StageElement, parentMatrix: THREE.Matrix4, inheritedOpacity: number, amount: number, fold: boolean) => {
    if (visited.has(source.id)) { scene.diagnostics.push(`${source.name}: cyclic visual hierarchy`); return }
    visited.add(source.id)
    const element = evaluateElementTimeline(source, spread, input.spreadTime)
    if (!element.visible || input.isHidden?.(element)) return
    const matrix = parentMatrix.clone().multiply(transformMatrix(element, input.clock, amount, fold))
    if (element.type !== 'group') scene.visuals.push({ rootId, key: element.id, element, matrix, opacity: inheritedOpacity })
    for (const child of children.get(element.id) ?? []) {
      visitVisual(child, matrix, inheritedOpacity * element.opacity, amount, false)
    }
  }
  const visit = (source: AssemblyElement, parentMatrix: THREE.Matrix4, inheritedOpacity: number, parentOpen: number) => {
    if (visited.has(source.id)) { scene.diagnostics.push(`${source.name}: cyclic assembly hierarchy`); return }
    visited.add(source.id)
    const element = evaluateElementTimeline(source, spread, input.spreadTime) as AssemblyElement
    if (!element.visible || input.isHidden?.(element)) return
    const spec = element.mechanism
    const open = Math.min(input.open, parentOpen)
    const evaluated = evaluateMechanism(spec, { open, clock: input.clock,
      leftAngle: input.leftAngle, rightAngle: input.rightAngle })
    const opacity = inheritedOpacity * element.opacity * evaluated.opacity
    if (!evaluated.drawn || opacity <= .001) return
    const root = parentMatrix.clone()
    if (source.parent.type !== 'element' && spec.mount.type === 'page') {
      const left = spec.mount.side === 'left'
      const angle = spec.deployment.mode === 'virtual' ? 0 : left ? input.leftAngle - Math.PI : input.rightAngle
      root.multiply(new THREE.Matrix4().makeRotationZ(angle))
      root.multiply(new THREE.Matrix4().makeTranslation(left ? -book.format.pageWidth / 2 : book.format.pageWidth / 2, .008, 0))
    }
    root.multiply(transformMatrix(element, input.clock, evaluated.openFactor))
    const stage = evaluated.rootTransform
    root.multiply(new THREE.Matrix4().makeTranslation(...stage.position))
    root.multiply(new THREE.Matrix4().makeScale(stage.scale, stage.scale, stage.scale))
    for (const diagnostic of evaluated.diagnostics) scene.diagnostics.push(`${element.name}: ${diagnostic.message}`)
    for (const surface of evaluated.surfaces) {
      const material = spec.surfaces[surface.id] ?? { color: '#f3c980', visible: true }
      if (!material.visible) continue
      scene.surfaces.push({ rootId, key: `${element.id}/${surface.id}`, elementId: element.id,
        surface, material, matrix: root.clone(), opacity })
    }
    for (const childSource of children.get(element.id) ?? []) {
      const child = evaluateElementTimeline(childSource, spread, input.spreadTime)
      if (!child.visible || input.isHidden?.(child)) continue
      const attachment = child.type === 'assembly' && child.mechanism.mount.type === 'surface'
        ? child.mechanism.mount : child.surfaceAttachment
      if (!attachment) { scene.diagnostics.push(`${child.name}: missing surface attachment`); continue }
      const anchor = attachmentMatrix(evaluated, attachment)
      if (!anchor) { scene.diagnostics.push(`${child.name}: unknown surface ${attachment.surfaceId}`); continue }
      const matrix = root.clone().multiply(anchor)
      const surfaceStart = scene.surfaces.length, visualStart = scene.visuals.length
      if (child.type === 'assembly') {
        visit(child, matrix, opacity, evaluated.openFactor)
      } else visitVisual(childSource, matrix, opacity, evaluated.openFactor, true)
      if (child.type === 'assembly' || physicalRoot) {
        // 子自身の内部折りを評価してから、全子孫へ面上収納を一度だけ合成する。
        const childSurfaces = scene.surfaces.slice(surfaceStart), childVisuals = scene.visuals.slice(visualStart)
        const inverse = matrix.clone().invert()
        const localScene: AssemblyScene = {
          surfaces: childSurfaces.map((entry) => ({ ...entry, matrix: inverse.clone().multiply(entry.matrix) })),
          visuals: childVisuals.map((entry) => ({ ...entry, matrix: inverse.clone().multiply(entry.matrix) })), diagnostics: [],
        }
        const parentSurface = evaluated.surfaces.find((surface) => surface.id === attachment.surfaceId)!
        const inverseAnchor = anchor.clone().invert()
        const surfacePoints: THREE.Vector3[] = []
        for (let vertex = 0; vertex < parentSurface.positions.length; vertex += 3) {
          surfacePoints.push(new THREE.Vector3(...parentSurface.positions.slice(vertex, vertex + 3) as [number, number, number]).applyMatrix4(inverseAnchor))
        }
        const foldedAlongX = child.type === 'assembly' && ['v-fold', 'platform', 'box', 'accordion'].includes(child.mechanism.kind)
        const foldNormal = new THREE.Vector3(foldedAlongX ? 1 : 0, foldedAlongX ? 0 : 1, 0)
        const localRoot = localScene.surfaces.find((entry) => entry.elementId === child.id)?.matrix
        if (child.type === 'assembly' && localRoot) foldNormal.transformDirection(localRoot)
        const result = evaluateSurfaceStow({ bounds: assemblySceneBounds(localScene), surfacePoints,
          open: evaluated.openFactor, foldNormal,
          pageFrame: physicalRoot ? { anchorMatrix: matrix, leftAngle: input.leftAngle, rightAngle: input.rightAngle } : undefined })
        const correction = matrix.clone().multiply(result.matrix).multiply(inverse)
        for (const entry of [...childSurfaces, ...childVisuals]) entry.matrix.premultiply(correction)
        for (const diagnostic of result.diagnostics) scene.diagnostics.push(`${child.name}: ${diagnostic}`)
      }
    }
  }
  for (const element of spread.elements) if (element.type === 'assembly' && element.parent.type !== 'element') {
    rootId = element.id
    physicalRoot = element.mechanism.deployment.mode === 'page-constrained'
    visit(element, new THREE.Matrix4(), 1, 1)
  }
  return scene
}

const stowPlans = new WeakMap<Book, WeakMap<Spread, Map<string, VirtualStowPlan>>>()
function groupScene(scene: AssemblyScene, rootId: string): AssemblyScene {
  return { surfaces: scene.surfaces.filter((entry) => entry.rootId === rootId),
    visuals: scene.visuals.filter((entry) => entry.rootId === rootId), diagnostics: [] }
}

/** 仮想機構の収納経路は親子全体へ一度だけ掛け、内部の継ぎ目を動かさない。 */
export function evaluateAssemblyScene(book: Book, spread: Spread, input: AssemblySceneInput): AssemblyScene {
  const scene = evaluateLocalScene(book, spread, input)
  const virtualRoots = spread.elements.filter((element) => element.type === 'assembly'
    && element.parent.type !== 'element' && element.mechanism.deployment.mode === 'virtual')
  if (!virtualRoots.length || input.open >= 1) return scene
  let bySpread = stowPlans.get(book)
  if (!bySpread) { bySpread = new WeakMap(); stowPlans.set(book, bySpread) }
  let plans = bySpread.get(spread)
  if (!plans) {
    plans = new Map(); bySpread.set(spread, plans)
    const full = evaluateLocalScene(book, spread, { open: 1, leftAngle: Math.PI, rightAngle: 0, spreadTime: 0, clock: 0 })
    for (const root of virtualRoots) plans.set(root.id, compileVirtualStow(assemblySceneBounds(groupScene(full, root.id)), book.format))
  }
  for (const root of virtualRoots) {
    const group = groupScene(scene, root.id)
    const plan = plans.get(root.id)
    if (!plan) continue
    const result = evaluateVirtualStow(plan, { ...input, bounds: assemblySceneBounds(group) })
    for (const entry of [...group.surfaces, ...group.visuals]) entry.matrix.premultiply(result.matrix)
    for (const diagnostic of result.diagnostics) scene.diagnostics.push(`${root.name}: ${diagnostic}`)
  }
  return scene
}

export function assemblySceneBounds(scene: AssemblyScene): THREE.Box3 {
  const bounds = new THREE.Box3()
  for (const { surface, matrix } of scene.surfaces) {
    for (let i = 0; i < surface.positions.length; i += 3) {
      bounds.expandByPoint(new THREE.Vector3(surface.positions[i], surface.positions[i + 1], surface.positions[i + 2]).applyMatrix4(matrix))
    }
  }
  for (const { element, matrix } of scene.visuals) {
    if (element.type !== 'visual' && element.type !== 'particle') continue
    for (const u of [0, 1]) for (const v of [0, 1]) bounds.expandByPoint(new THREE.Vector3(
      (u - element.pivot[0]) * element.width, (v - element.pivot[1]) * element.height, 0).applyMatrix4(matrix))
  }
  return bounds
}
