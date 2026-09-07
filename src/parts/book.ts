import type { BookProject } from '../schema/bookPackage'
import type { Spread } from '../schema/book'
import type { PartElement } from '../schema/stageElement'
import { evaluatePartGraph } from './evaluate'
import { bindingDependencies, type PartNode, type PartMaterial } from './schema'
import { faceCorners, pagePorts } from './geometry'
import { inspectClosedLayout, inspectPaper, validationAngles } from './validate'

export const spreadPartNodes = (spread: Spread): PartNode[] => spread.elements.filter((element): element is PartElement => element.type === 'part')
  .map((element) => ({ id: element.id, name: element.name, ...element.part }))

export function evaluateBookParts(project: Pick<BookProject, 'book' | 'partDefinitions'>, spread: Spread, leftAngle: number, rightAngle: number) {
  const { pageWidth, pageAspect } = project.book.format
  return evaluatePartGraph(spreadPartNodes(spread), project.partDefinitions ?? {}, undefined,
    { $book: pagePorts(pageWidth, pageWidth / pageAspect, leftAngle, rightAngle) })
}
export function validateBookParts(project: BookProject): string[] {
  const errors: string[] = []
  const materials = project.book.spreads.flatMap((spread) => spread.elements.flatMap((element) => element.type === 'part' ? Object.values(element.part.materials) : []))
  for (const definition of Object.values(project.partDefinitions ?? {})) {
    materials.push(...Object.values(definition.materialSlots), ...definition.nodes.flatMap((node) => Object.values(node.materials).filter((value): value is PartMaterial => !('slot' in value))))
  }
  for (const material of materials) for (const id of [material.image, material.backImage]) {
    if (id && !project.assets.some((asset) => asset.id === id && ['image', 'svg'].includes(asset.type))) errors.push(`Missing or unsupported paper artwork: ${id}`)
  }
  for (const spread of project.book.spreads) {
    if (!spread.elements.some((element) => element.type === 'part')) continue
    try {
      for (const element of spread.elements) if (element.type === 'part') {
        if (element.baseTransform.position.some((n) => n !== 0) || element.baseTransform.rotation.some((n) => n !== 0)
          || element.baseTransform.scale.some((n) => n !== 1) || element.motion.length) throw new Error(`Part transforms must preserve their mount: ${element.id}`)
        if (spread.timeline.tracks.some((track) => track.target.type === 'element' && track.target.elementId === element.id
          && !['opacity', 'visible'].includes(track.property))) throw new Error(`Part timeline must preserve its mount: ${element.id}`)
      }
      for (const angle of validationAngles(180)) {
        const result = evaluateBookParts(project, spread, angle * Math.PI / 180, 0)
        errors.push(...inspectPaper(result).map((message) => `${spread.name}: ${message}`))
        if (angle === 0) errors.push(...inspectClosedLayout(result, project.book.format.pageWidth,
          project.book.format.pageWidth / project.book.format.pageAspect).map((message) => `${spread.name}: ${message}`))
      }
    } catch (error) { errors.push(`${spread.name}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  return [...new Set(errors)]
}
export function partIsVisible(spread: Spread, id: string, hidden?: (id: string) => boolean, seen = new Set<string>()): boolean {
  if (id === '$book') return true
  if (seen.has(id)) return false
  seen.add(id)
  const element = spread.elements.find((item) => item.id === id)
  if (!element || !element.visible || element.opacity <= 0 || hidden?.(id)) return false
  return element.type !== 'part' || bindingDependencies(element.part.mount).every((parent) => partIsVisible(spread, parent, hidden, new Set(seen)))
}
export const paperBoundsPoints = (project: BookProject, spread: Spread) => evaluateBookParts(project, spread, Math.PI, 0).faces.flatMap(faceCorners)
