import type { BookProject } from '../schema/bookPackage'
import type { Spread } from '../schema/book'
import type { PartElement } from '../schema/stageElement'
import { evaluatePartGraph } from './evaluate'
import { bindingDependencies, type PartNode, type PartMaterial } from './schema'
import { bindBookContents } from './contents'
import { inspectContentBindings, inspectContentsAt, inspectContentMotion } from './contentValidation'
import { faceCorners, pagePorts } from './geometry'
import { createPaperMotionInspector, inspectClosedLayout, validationAngles } from './validate'

export const spreadPartNodes = (spread: Spread): PartNode[] => spread.elements.filter((element): element is PartElement => element.type === 'part')
  .map((element) => ({ id: element.id, name: element.name, ...element.part }))

export function evaluateBookParts(project: Pick<BookProject, 'book' | 'partDefinitions'>, spread: Spread, leftAngle: number, rightAngle: number) {
  const { pageWidth, pageAspect } = project.book.format
  return evaluatePartGraph(spreadPartNodes(spread), project.partDefinitions ?? {}, undefined,
    { $book: pagePorts(pageWidth, pageWidth / pageAspect, leftAngle, rightAngle) })
}

// 候補の検査、commit、Undoで同じ設計を再検査しない。参照同一性ではなく設計内容を鍵にする。
// 素材の存在確認はこのキャッシュの外で毎回行う。保存・再生データには含めない。
const spreadInspections = new Map<string, string[]>()
const inspectionKey = (value: unknown) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)
export function validateBookParts(project: BookProject): string[] {
  const errors: string[] = []
  const materials = project.book.spreads.flatMap((spread) => spread.elements.flatMap((element) => element.type === 'part' ? Object.values(element.part.materials) : []))
  for (const definition of Object.values(project.partDefinitions ?? {})) {
    materials.push(...Object.values(definition.materialSlots), ...definition.nodes.flatMap((node) => Object.values(node.materials).filter((value): value is PartMaterial => !('slot' in value))))
  }
  for (const material of materials) for (const id of [material.image, material.backImage]) {
    if (id && !project.assets.some((asset) => asset.id === id && ['image', 'svg'].includes(asset.type))) errors.push(`Missing or unsupported paper artwork: ${id}`)
  }
  const contextKey = inspectionKey([project.book.format, project.partDefinitions ?? {}])
  for (const spread of project.book.spreads) {
    if (!spread.elements.some((element) => element.type === 'part' || element.attachment || element.presentation)) continue
    const key = contextKey + '\n' + inspectionKey(spread), cached = spreadInspections.get(key)
    if (cached) {
      spreadInspections.delete(key); spreadInspections.set(key, cached)
      errors.push(...cached); continue
    }
    const firstError = errors.length
    try {
      for (const element of spread.elements) if (element.type === 'part') {
        if (element.baseTransform.position.some((n) => n !== 0) || element.baseTransform.rotation.some((n) => n !== 0)
          || element.baseTransform.scale.some((n) => n !== 1) || element.motion.length) throw new Error(`Part transforms must preserve their mount: ${element.id}`)
        if (spread.timeline.tracks.some((track) => track.target.type === 'element' && track.target.elementId === element.id
          && !['opacity', 'visible'].includes(track.property))) throw new Error(`Part timeline must preserve its mount: ${element.id}`)
      }
      for (const element of spread.elements) if (Boolean(element.attachment) !== Boolean(element.presentation)) throw new Error('Content attachment and presentation must be specified together: ' + element.id)
      const inspectMotion = createPaperMotionInspector()
      const { pageWidth, pageAspect } = project.book.format
      for (const side of ['left', 'right']) for (const angle of validationAngles(180)) {
        const left = side === 'left' ? angle * Math.PI / 180 : Math.PI
        const right = side === 'right' ? (180 - angle) * Math.PI / 180 : 0
        const result = evaluateBookParts(project, spread, left, right)
        const bindings = bindBookContents(project, spread, result, left, right)
        if (side === 'left' && angle === 0) errors.push(...inspectContentBindings(bindings))
        for (const time of [0, spread.sequence.holdSeconds / 2, spread.sequence.holdSeconds]) errors.push(...inspectContentsAt(bindings, { openingAngleDeg: angle, maxOpeningAngleDeg: 180, holdTime: time }))
        const input = pagePorts(pageWidth, pageWidth / pageAspect, left, right).gutter
        if ([0, 15, 30, 60, 90, 120, 150, 172.5, 180].includes(angle) && input.kind === 'fold-pair') errors.push(...inspectContentMotion(bindings,
          [...result.faces, input.a, input.b], { openingAngleDeg: angle, maxOpeningAngleDeg: 180 }, spread.sequence.holdSeconds))
        errors.push(...inspectMotion(result, [input]).map((message) => `${spread.name}: ${message}`))
        if (angle === 0 && input.kind === 'fold-pair') errors.push(...inspectClosedLayout(result, pageWidth,
          pageWidth / pageAspect, input.rayA).map((message) => `${spread.name}: ${message}`))
      }
    } catch (error) { errors.push(`${spread.name}: ${error instanceof Error ? error.message : String(error)}`) }
    // 大きな入力や過去の編集を無制限に保持しない。
    if (key.length < 256 * 1024) {
      spreadInspections.set(key, errors.slice(firstError))
      while (spreadInspections.size > 32) spreadInspections.delete(spreadInspections.keys().next().value!)
    }
  }
  return [...new Set(errors)]
}
export function partIsVisible(spread: Spread, id: string, hidden?: (id: string) => boolean, seen = new Set<string>()): boolean {
  if (id === '$book') return true
  if (seen.has(id)) return false
  seen.add(id)
  const element = spread.elements.find((item) => item.id === id)
  if (!element || !element.visible || element.opacity <= 0 || hidden?.(id)) return false
  const parents = element.type === 'part' ? bindingDependencies(element.part.mount) : element.attachment
    ? [element.attachment.type === 'surface' ? element.attachment.surface.nodeId : element.attachment.elementId] : []
  return parents.every((parent) => partIsVisible(spread, parent, hidden, new Set(seen)))
}
export const paperBoundsPoints = (project: BookProject, spread: Spread) => evaluateBookParts(project, spread, Math.PI, 0).faces.flatMap(faceCorners)
