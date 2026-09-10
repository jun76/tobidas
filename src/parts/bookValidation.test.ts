import { describe, expect, it, vi } from 'vitest'
import { createBookProject, createStageElement } from '../schema/bookDefaults'
import { connectedContentSchema } from '../schema/content'
import { contentAsStage } from './contents'
import { validateBookParts } from './book'
import * as evaluation from './evaluate'

describe('見開きごとの検査結果の再利用', () => {
  it('複製された同じ設計だけを再利用し、基準点と本の寸法の変更を再検査する', () => {
    const project = createBookProject(), spread = project.book.spreads[0]
    spread.elements = [contentAsStage(connectedContentSchema.parse({ ...createStageElement('visual'),
      attachment: { type: 'surface', surface: { nodeId: '$book', portId: 'right-page' }, point: [4, 1], side: 'front' },
      presentation: { kind: 'decal' }, width: 1, height: 1, billboard: false, motion: [],
      baseTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }))]
    const evaluate = vi.spyOn(evaluation, 'evaluatePartGraph')
    try {
      expect(validateBookParts(project)).toEqual([])
      expect(evaluate).toHaveBeenCalled()
      evaluate.mockClear()
      expect(validateBookParts(structuredClone(project))).toEqual([])
      expect(evaluate).not.toHaveBeenCalled()
      const changed = structuredClone(project), attachment = changed.book.spreads[0].elements[0].attachment!
      if (attachment.type === 'surface') attachment.point = [100, 1]
      expect(validateBookParts(changed).some((message) => message.includes('outside material'))).toBe(true)
      expect(evaluate).toHaveBeenCalled()
      evaluate.mockClear()
      expect(validateBookParts(project)).toEqual([])
      expect(evaluate).not.toHaveBeenCalled()
      project.book.format.pageWidth = 2
      expect(validateBookParts(project).some((message) => message.includes('outside material'))).toBe(true)
      expect(evaluate).toHaveBeenCalled()
    } finally { evaluate.mockRestore() }
  })
})
