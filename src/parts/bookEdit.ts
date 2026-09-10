import type { BookProject } from '../schema/bookPackage'
import { spreadPartNodes } from './book'
import { bindBookContents } from './contents'
import { inspectContentsAt } from './contentValidation'
import { pagePorts } from './geometry'
import type { PartEditScene, PartEditPlan } from './edit'
import { partInstanceSchema } from './schema'

export function bookEditScene(project: BookProject, spreadId: string): PartEditScene {
  const spread = project.book.spreads.find((item) => item.id === spreadId)
  if (!spread) throw new Error('Edited spread was not found')
  const width = project.book.format.pageWidth, depth = width / project.book.format.pageAspect
  return { nodes: spreadPartNodes(spread), definitions: project.partDefinitions ?? {}, maxAngle: 180,
    validateContents: (result, nodes, angle) => {
      const candidate = { ...spread, elements: spread.elements.map((element) => element.type === 'part' ? { ...element, part: partInstanceSchema.parse(nodes.find((node) => node.id === element.id)!) } : element) }
      return inspectContentsAt(bindBookContents(project, candidate, result, angle * Math.PI / 180, 0), { openingAngleDeg: angle, maxOpeningAngleDeg: 180, holdTime: 0 })
    },
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
