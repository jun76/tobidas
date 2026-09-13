import type { BookProject } from '../schema/bookPackage'
import { spreadPartNodes } from './book'
import { bindBookContents } from './contents'
import { inspectContentsAt } from './contentValidation'
import { pagePorts } from './geometry'
import type { PartEditScene, PartEditPlan } from './edit'
import { partInstanceSchema } from './schema'
import { planSupportedPart } from './supportPlanning'
import { evaluateBookParts } from './book'
import { pointOnFace } from './geometry'

export function bookEditScene(project: BookProject, spreadId: string): PartEditScene {
  const spread = project.book.spreads.find((item) => item.id === spreadId)
  if (!spread) throw new Error('Edited spread was not found')
  const width = project.book.format.pageWidth, depth = width / project.book.format.pageAspect
  return { nodes: spreadPartNodes(spread), definitions: project.partDefinitions ?? {}, maxAngle: 180,
    redesignSupports: (nodes, affected) => {
      const candidate = { ...spread, elements: spread.elements.map(element => element.type === 'part' ? { ...element, part: partInstanceSchema.parse(nodes.find(node => node.id === element.id)!) } : element) }
      for (const node of nodes) {
        if (!affected.has(node.id) || node.supportDesign !== 'automatic' || !('builtin' in node.definition) || node.definition.builtin !== 'upright') continue
        // 傾きの変更は固定長四節リンクの逆算を使う。通常の平行な支持だけを自動で再設計する。
        if (node.parameters.tiltAngle && node.parameters.tiltAngle !== 90) continue
        const element = candidate.elements.find(e => e.id === node.id)!
        if (element.type !== 'part') continue
        const paper = evaluateBookParts(project, candidate, Math.PI, 0), panel = paper.nodes[node.id].ports.panel
        if (panel.kind !== 'surface' || element.part.mount.type !== 'pair') continue
        const result = planSupportedPart(project, candidate, element, { position: pointOnFace(panel.face, panel.face.width / 2, 0).toArray(), surfaces: [element.part.mount.a, element.part.mount.b] })
        element.part = result.part
        Object.assign(node, result.part)
      }
    },
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
