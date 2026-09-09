import type { BookProject } from '../schema/bookPackage'
import { spreadPartNodes } from './book'
import { pagePorts } from './geometry'
import type { PartEditScene, PartEditPlan } from './edit'
import { partInstanceSchema } from './schema'

export function bookEditScene(project: BookProject, spreadId: string): PartEditScene {
  const spread = project.book.spreads.find((item) => item.id === spreadId)
  if (!spread) throw new Error('Edited spread was not found')
  const width = project.book.format.pageWidth, depth = width / project.book.format.pageAspect
  return { nodes: spreadPartNodes(spread), definitions: project.partDefinitions ?? {}, maxAngle: 180,
    closedBounds: { width, depth }, at: (angle) => ({ external: { $book: pagePorts(width, depth, angle * Math.PI / 180, 0) } }) }
}
export function applyBookEditPlan(project: BookProject, spreadId: string, plan: Extract<PartEditPlan, { ok: true }>): BookProject {
  const next = structuredClone(project), spread = next.book.spreads.find((item) => item.id === spreadId)!
  for (const node of plan.nodes) {
    const element = spread.elements.find((item) => item.id === node.id)
    if (element?.type !== 'part') continue
    element.part = partInstanceSchema.parse(node)
  }
  return next
}
