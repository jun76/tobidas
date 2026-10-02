import { cloneProject } from '../schema/cloneProject'
import type { BookProject } from '../schema/bookPackage'
import type { Spread } from '../schema/book'
import { spreadPartNodes } from './book'
import { bindBookContents } from './contents'
import { inspectContentsAt } from './contentValidation'
import { logicalPagePorts as pagePorts } from './geometry'
import { describePartEdit, type PartEditScene, type PartEditPlan } from './edit'
import { partInstanceSchema, type PartInstance, type PartNode } from './schema'
import { replanMovedSupport, supportedPartFoot, supportEvaluates, withoutParts } from './supportPlanning'
import { evaluateBookParts } from './book'
import { clearFictionPaperCrossings, floatingFictionIds } from './contentPlacement'
import { pointOnFace } from './geometry'

/** 計画途中の候補を評価するための部品。保存しないので検証付きの複製は省き、確定時の applyBookEditPlan で検証する */
const candidatePart = ({ id: _id, name: _name, outline: _outline, ...part }: PartNode) => part as PartInstance
export function bookEditScene(project: BookProject, spreadId: string): PartEditScene {
  const spread = project.book.spreads.find((item) => item.id === spreadId)
  if (!spread) throw new Error('Edited spread was not found')
  const width = project.book.format.pageWidth, depth = width / project.book.format.pageAspect
  // 動かした紙に当たる浮遊演出は編集を止めず、確定時に押しのける (applyBookEditPlan)。動かす部品に貼った演出は検査する
  const floating = floatingFictionIds(spread)
  const ignoredContents = (affected: ReadonlySet<string>) => new Set([...floating].filter(id => {
    const element = spread.elements.find(e => e.id === id)
    return element?.attachment?.type === 'surface' && !affected.has(element.attachment.surface.nodeId)
  }))
  const scene: PartEditScene = { nodes: spreadPartNodes(spread), definitions: project.partDefinitions ?? {}, maxAngle: 180,
    redesignSupports: (nodes, affected, edited, intent, pending, checked) => {
      // まだ取り付け直していない追従部品は古い折り線のままで評価できないので、候補の検査から外す
      const candidate = withoutParts({ ...spread, elements: spread.elements.map(element => element.type === 'part' ? { ...element, part: candidatePart(nodes.find(node => node.id === element.id)!) } : element) }, pending)
      // 操作した部品を先に作り直す。子部品の足元は作り直した親から測る。
      for (const node of [...nodes].sort((a, b) => Number(b.id === edited) - Number(a.id === edited))) {
        if (!affected.has(node.id) || !('builtin' in node.definition) || node.definition.builtin !== 'upright') continue
        // 傾きの変更は固定長四節リンクの逆算を使う。通常の平行な支持だけを自動で再設計する。
        if (node.parameters.tiltAngle && node.parameters.tiltAngle !== 90) continue
        const element = candidate.elements.find(e => e.id === node.id)!
        if (element.type !== 'part' || element.part.mount.type !== 'pair') continue
        // 手で接着位置を決めた子部品は、親に追従した取り付けがそのまま成り立つなら触らない
        if (node.supportDesign !== 'automatic' && node.id !== edited && supportEvaluates(project, candidate, element)) continue
        // 移動は元の足元へ移動量を足して目標にする (親の後ろへ動かした取り付けは仮の距離になっているため)
        const position = node.id === edited && intent.type === 'translate' ? movedFoot(project, spread, scene, edited, intent.delta) : supportedPartFoot(project, candidate, element)
        // 今の接続先で成り立つならそれを保ち、届かなくなったときだけ移動先の奥にある紙へ乗り換える
        const result = replanMovedSupport(project, candidate, element, position, ignoredContents(new Set([...affected, ...pending])), !checked)
        element.part = result.part
        Object.assign(node, result.part)
      }
    },
    validateContents: (result, nodes, angle, affected) => {
      const candidate = { ...spread, elements: spread.elements.map((element) => element.type === 'part' ? { ...element, part: candidatePart(nodes.find((node) => node.id === element.id)!) } : element) }
      const ignored = ignoredContents(affected)
      return inspectContentsAt(bindBookContents(project, candidate, result, angle * Math.PI / 180, 0).filter((binding) => !ignored.has(binding.id)), { openingAngleDeg: angle, maxOpeningAngleDeg: 180, holdTime: 0 })
    },
    closedBounds: { width, depth, shrink: true }, at: (angle) => ({ external: { $book: pagePorts(width, depth, angle * Math.PI / 180, 0) } }) }
  return scene
}
/** 操作前の足元に、折り線に沿った量と手前への量を足した位置 */
function movedFoot(project: BookProject, spread: Spread, scene: PartEditScene, id: string, delta: [number, number]): [number, number, number] {
  const panel = evaluateBookParts(project, spread, Math.PI, 0).nodes[id].ports.panel
  if (panel.kind !== 'surface') throw new Error('Upright panel is missing')
  const input = describePartEdit(scene, id).input
  if (input.kind !== 'fold-pair') throw new Error('Expected a two-surface mount')
  return pointOnFace(panel.face, panel.face.width / 2, 0).addScaledVector(input.axis, delta[0]).addScaledVector(input.rayA, delta[1]).toArray() as [number, number, number]
}
export function applyBookEditPlan(project: BookProject, spreadId: string, plan: Extract<PartEditPlan, { ok: true }>): BookProject {
  const next = cloneProject(project), spread = next.book.spreads.find((item) => item.id === spreadId)!
  for (const node of plan.nodes) {
    const element = spread.elements.find((item) => item.id === node.id)
    if (element?.type !== 'part') continue
    element.part = partInstanceSchema.parse(node)
  }
  // 動かした紙に当たることになった浮遊演出を押しのける (計画時には検査していない)
  const affected = new Set(plan.affected)
  const floating = new Set([...floatingFictionIds(spread)].filter((id) => {
    const element = spread.elements.find((e) => e.id === id)
    return element?.attachment?.type === 'surface' && !affected.has(element.attachment.surface.nodeId)
  }))
  if (floating.size) clearFictionPaperCrossings(next, spread, affected, floating)
  return next
}
