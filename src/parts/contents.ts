import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { Spread } from '../schema/book'
import type { BookProject } from '../schema/bookPackage'
import type { ConnectedContent } from '../schema/content'
import type { StageElement } from '../schema/stageElement'
import type { TimelineTrack } from '../schema/timeline'
import { evaluateContentMotion } from '../runtime/motion'
import { evaluateElementTimeline } from '../runtime/timeline/evaluate'
import { evaluatedOutput } from './evaluate'
import { faceContains, pagePorts, pointOnFace, type BoundPaperContent, type PaperEvaluation, type PaperFace, type PartPort } from './geometry'

/** 旧parentは表示ツリーとの互換用に導出する。保存時はattachmentだけを残す。 */
export function contentAsStage(element: ConnectedContent): StageElement {
  const attachment = element.attachment, node = attachment.type === 'surface' ? attachment.surface.nodeId : attachment.elementId
  return { ...element, parent: node === '$book' && attachment.type === 'surface'
    ? { type: attachment.surface.portId === 'left-page' ? 'left-page' : 'right-page' }
    : { type: 'element', elementId: node }, stow: { fallDirection: 'auto', stagger: 0 } }
}
export const contentTargetId = (owner: string, path: string[]) => [owner, ...path.slice(0, -1), 'content', path.at(-1)].join('/')
export function bindBookContents(project: Pick<BookProject, 'book'>, spread: Spread, paper: PaperEvaluation,
  leftAngle: number, rightAngle: number): BoundPaperContent[] {
  const { pageWidth, pageAspect } = project.book.format, pages = pagePorts(pageWidth, pageWidth / pageAspect, leftAngle, rightAngle)
  const result = (paper.contents ?? []).map((bound) => ({ ...bound, tracks: [...bound.tracks] }))
  for (const element of spread.elements) {
    if (!element.attachment) continue
    if (!element.presentation || !['visual', 'particle', 'group'].includes(element.type)) throw new Error(`Invalid connected content: ${element.id}`)
    const attachment = element.attachment
    let port: PartPort | undefined
    if (attachment.type === 'surface') {
      const { nodeId, portId } = attachment.surface
      port = nodeId === '$book' ? pages[portId] : paper.nodes?.[nodeId] && evaluatedOutput(paper.nodes[nodeId], portId, nodeId)
      if (port?.kind !== 'surface') throw new Error(`Missing content surface: ${element.id} -> ${nodeId}/${portId}`)
    }
    result.push({ id: element.id, ownerId: element.id, element: element as ConnectedContent,
      face: port?.kind === 'surface' ? port.face : undefined,
      unitScale: attachment.type === 'surface' && attachment.surface.nodeId !== '$book' ? paper.deploymentScale ?? 1 : 1,
      parentId: attachment.type === 'visual' ? attachment.elementId : undefined,
      tracks: spread.timeline.tracks.filter((track) => track.target.type === 'element' && track.target.elementId === element.id) })
  }
  // 内部の表示名ではなく、配置IDと内部パスを使って作品のトラックを解決する。
  for (const track of spread.timeline.tracks) if (track.target.type === 'part-content') {
    const id = contentTargetId(track.target.elementId, track.target.path), bound = result.find((item) => item.id === id)
    if (!bound) throw new Error(`Missing internal content target: ${id}`)
    bound.tracks = [...bound.tracks.filter((item) => item.property !== track.property), { ...track, target: { type: 'element', elementId: bound.element.id } }]
  }
  const byId = new Map(result.map(bound => [bound.id, bound]))
  const inheritScale = (bound: BoundPaperContent, seen = new Set<string>()): number => {
    if (!bound.parentId || seen.has(bound.id)) return bound.unitScale
    seen.add(bound.id)
    const parent = byId.get(bound.parentId)
    if (parent && bound.id === bound.ownerId) bound.unitScale = inheritScale(parent, seen)
    return bound.unitScale
  }
  result.forEach(bound => inheritScale(bound))
  return result
}

export interface ContentContext {
  openingAngleDeg: number; maxOpeningAngleDeg: number; holdTime: number
  clock: (id: string, mode: ConnectedContent['clock']) => number
  hidden?: (id: string) => boolean
  displayFace?: (face: PaperFace) => PaperFace
  billboardQuaternion?: Quaternion
}
export interface EvaluatedContent {
  id: string; ownerId: string; parentId?: string; element: ConnectedContent; matrix: Matrix4; anchor: Matrix4
  face?: PaperFace; visible: boolean; opacity: number; time: number; unitScale: number; exitScale: number
}
export const contentExitScale = (angle: number, max: number): number => {
  const t = Math.max(0, Math.min(1, angle / Math.max(1e-9, max)))
  return t * t * (3 - 2 * t)
}
/** 開き角の 4〜8 割で現れ、閉じるときは逆順に消える。見えない間は紙との交差も検査しない。 */
export const contentFadeOpacity = (angle: number, max: number): number => {
  const t = Math.max(0, Math.min(1, (angle / Math.max(1e-9, max) - .4) / .4))
  return t * t * (3 - 2 * t)
}
export function contentSurfaceFrame(face: PaperFace, point: [number, number], side: 'front' | 'back'): Matrix4 {
  const sign = side === 'front' ? 1 : -1, u = face.u.clone().multiplyScalar(sign), normal = u.clone().cross(face.v)
  return new Matrix4().makeBasis(u, face.v, normal).setPosition(pointOnFace(face, ...point))
}
function timeline(element: ConnectedContent, tracks: TimelineTrack[], time: number): ConnectedContent {
  return evaluateElementTimeline(contentAsStage(element), { timeline: { tracks } } as Spread, time) as ConnectedContent
}
/** 紙の評価を受け取る純粋関数。時計の進行や姿勢の履歴は持たない。 */
export function evaluateContents(bindings: BoundPaperContent[], context: ContentContext): EvaluatedContent[] {
  const byId = new Map(bindings.map((item) => [item.id, item])), result = new Map<string, EvaluatedContent>(), active = new Set<string>()
  if (byId.size !== bindings.length) throw new Error('Duplicate connected content ID')
  const visit = (id: string): EvaluatedContent => {
    const cached = result.get(id); if (cached) return cached
    if (active.has(id)) throw new Error(`Cyclic content attachment: ${id}`)
    const bound = byId.get(id); if (!bound) throw new Error(`Missing content parent: ${id}`)
    active.add(id)
    const { unitScale } = bound, attachment = bound.element.attachment
    const element = timeline(bound.element, bound.tracks, context.holdTime)
    const parent = bound.parentId ? visit(bound.parentId) : undefined
    const face = bound.face && (context.displayFace?.(bound.face) ?? bound.face)
    if (attachment.type === 'surface') {
      if (!bound.face || !faceContains(bound.face, pointOnFace(bound.face, attachment.point[0] * unitScale, attachment.point[1] * unitScale), 1e-6)) throw new Error(`Content anchor lies outside material: ${id}`)
    } else if (element.presentation.kind === 'decal') throw new Error(`Decals require real paper: ${id}`)
    if (parent?.element.presentation.kind === 'decal') throw new Error(`Moving content cannot attach to printed decoration: ${id}`)
    const anchor = attachment.type === 'surface' && face ? contentSurfaceFrame(face, [attachment.point[0] * unitScale, attachment.point[1] * unitScale], attachment.side)
      : parent!.matrix.clone()
    const time = context.clock(id, element.clock), motion = evaluateContentMotion(element.motion, time)
    const fiction = element.presentation.kind === 'fiction', fading = element.presentation.kind === 'fiction' && element.presentation.closing === 'fade'
    const g = fiction && !parent && !fading ? contentExitScale(context.openingAngleDeg, context.maxOpeningAngleDeg) : 1
    const fade = fading && !parent ? contentFadeOpacity(context.openingAngleDeg, context.maxOpeningAngleDeg) : 1
    const ratio = parent ? unitScale / parent.unitScale : unitScale
    const position = new Vector3(...element.baseTransform.position).add(new Vector3(...motion.position)).multiplyScalar(ratio * g)
    const rotation = element.baseTransform.rotation.map((value, i) => (value + motion.rotationDeg[i] + motion.spinDeg[i]) * Math.PI / 180)
    if (!fiction) {
      if (element.type !== 'visual' || element.billboard || Math.abs(rotation[0]) > 1e-8 || Math.abs(rotation[1]) > 1e-8
        || Math.abs(element.baseTransform.position[2]) > 1e-8 || element.motion.length) throw new Error(`Printed content must stay on its material plane: ${id}`)
      // 印刷の枚数やlayer値を紙の厚みに変えない。貼り紙より薄い一定のリフトだけを持たせる。
      position.z = .0005
    }
    const scale = new Vector3(...element.baseTransform.scale).multiplyScalar(ratio * g * motion.scaleMul)
    const matrix = anchor.clone().multiply(new Matrix4().compose(position, new Quaternion().setFromEuler(new Euler(rotation[0], rotation[1], rotation[2])), scale))
    if (fiction && element.type !== 'group' && element.billboard && context.billboardQuaternion) {
      const worldPosition = new Vector3().setFromMatrixPosition(matrix), worldScale = new Vector3().setFromMatrixScale(matrix)
      const turn = new Quaternion().setFromEuler(new Euler(rotation[0], rotation[1], rotation[2]))
      matrix.compose(worldPosition, context.billboardQuaternion.clone().multiply(turn), worldScale)
    }
    if (matrix.elements.some((value) => !Number.isFinite(value))) throw new Error(`Non-finite content transform: ${id}`)
    const opacity = element.opacity * (parent?.opacity ?? 1) * fade
    const item: EvaluatedContent = { id, ownerId: bound.ownerId, parentId: bound.parentId, element, matrix, anchor, face, opacity, time, unitScale,
      exitScale: parent?.exitScale ?? g, visible: element.visible && opacity > 0 && (parent?.visible ?? true)
        && !context.hidden?.(bound.ownerId) && (!fiction || g > 0) }
    active.delete(id); result.set(id, item); return item
  }
  return bindings.map((bound) => visit(bound.id))
}
