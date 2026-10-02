import type { BookProject } from '../../schema/bookPackage'
import type { Spread } from '../../schema/book'
import { planPartEdit, type PartEditIntent } from '../../parts/edit'
import { applyBookEditPlan, bookEditScene } from '../../parts/bookEdit'
import { partInstanceSchema } from '../../parts/schema'

/** ギズモ操作中の候補。変わるのは編集した見開きだけなので、その要素とタイムラインだけを返す。 */
export type PartEditPreview =
  | { ok: true; elements: Spread['elements']; timeline: Spread['timeline'] }
  | { ok: false; detail: string }

/** 描画スレッドとWorkerで共有する、操作中の簡易検査つき候補計算。確定時の全角度検査は共通コマンドが担う。 */
export function previewPartEdit(project: BookProject, spreadId: string, elementId: string, intent: PartEditIntent): PartEditPreview {
  const plan = planPartEdit(bookEditScene(project, spreadId), elementId, intent, false)
  if (!plan.ok) return { ok: false, detail: plan.detail }
  const spread = applyBookEditPlan(project, spreadId, plan).book.spreads.find((item) => item.id === spreadId)!
  return { ok: true, elements: spread.elements, timeline: spread.timeline }
}

/**
 * ギズモと同じフレームで紙を動かすための幾何だけの候補。衝突・演出の検査と浮遊演出の押しのけは
 * previewPartEdit (Worker) と確定時の共通コマンドが行う。
 */
export function sketchPartEdit(project: BookProject, spreadId: string, elementId: string, intent: PartEditIntent): PartEditPreview {
  const plan = planPartEdit(bookEditScene(project, spreadId), elementId, intent, 'geometry')
  if (!plan.ok) return { ok: false, detail: plan.detail }
  const spread = project.book.spreads.find((item) => item.id === spreadId)!, nodes = new Map(plan.nodes.map((node) => [node.id, node]))
  return { ok: true, timeline: spread.timeline, elements: spread.elements.map((element) => element.type === 'part' && nodes.has(element.id)
    ? { ...element, part: partInstanceSchema.parse(nodes.get(element.id)) } : element) }
}

/** 候補の見開きだけを差し替え、ほかの見開きと素材は元の作品と共有する。 */
export function withPreviewSpread(project: BookProject, spreadId: string, preview: Extract<PartEditPreview, { ok: true }>): BookProject {
  return { ...project, book: { ...project.book, spreads: project.book.spreads.map((spread) => spread.id === spreadId
    ? { ...spread, elements: preview.elements, timeline: preview.timeline } : spread) } }
}
