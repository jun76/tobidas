import { cloneProject } from '../schema/cloneProject'
import { z } from 'zod'
import type { BookProject } from '../schema/bookPackage'
import { contentAttachmentSchema, type ConnectedContent } from '../schema/content'
import { bindBookContents, evaluateContents, contentAsStage } from './contents'
import { evaluateBookParts, validateBookParts } from './book'
import { replanAutomaticSupports } from './supportPlanning'

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
export const contentEditIntentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('anchor'), point: z.tuple([z.number().finite(), z.number().finite()]), offset: z.number().finite().optional() }).strict(),
  z.object({ type: z.literal('rotation'), value: vector }).strict(),
  z.object({ type: z.literal('scale'), value: vector }).strict(),
  z.object({ type: z.literal('attachment'), value: contentAttachmentSchema }).strict(),
  z.object({ type: z.literal('position'), value: vector }).strict(),
])
export type ContentEditIntent = z.infer<typeof contentEditIntentSchema>
export function editContentValue(element: ConnectedContent, intent: ContentEditIntent): void {
  if (intent.type === 'anchor') {
    if (element.attachment.type !== 'surface') throw new Error('This content has no material anchor')
    element.attachment.point = [...intent.point]
    if (intent.offset !== undefined) element.baseTransform.position[2] = intent.offset
  } else if (intent.type === 'attachment') element.attachment = intent.value
  else {
    if (intent.type === 'scale' && intent.value.some((value) => value <= 0 || value > 100)) throw new Error('Content scale must be positive and at most 100')
    element.baseTransform[intent.type] = [...intent.value]
  }
}
/** 配置を動かす操作は軌道の基準だけを更新する。キーの変位はタイムライン操作が持つ。 */
export function planContentEdit(project: BookProject, spreadId: string, id: string, intent: ContentEditIntent, thorough = true) {
  const next = cloneProject(project), spread = next.book.spreads.find((item) => item.id === spreadId)
  const element = spread?.elements.find((item) => item.id === id)
  if (!spread || !element?.attachment || !element.presentation || !['visual', 'particle', 'group'].includes(element.type)) throw new Error('Connected content was not found')
  editContentValue(element as ConnectedContent, contentEditIntentSchema.parse(intent))
  spread.elements[spread.elements.indexOf(element)] = contentAsStage(element as ConnectedContent)
  if (thorough) replanAutomaticSupports(next, spread, { preserveConnections: true, floatingIds: new Set([id]) })
  const errors = thorough ? validateBookParts(next) : []
  if (!thorough) evaluateContents(bindBookContents(next, spread, evaluateBookParts(next, spread, Math.PI, 0), Math.PI, 0), { openingAngleDeg: 180, maxOpeningAngleDeg: 180, holdTime: 0, clock: () => 0 })
  if (errors.length) throw new Error(errors[0])
  return next
}
