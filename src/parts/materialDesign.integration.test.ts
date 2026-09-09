import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as builtins from './builtins'
import { openingAngle } from './geometry'
import { createBookProject, createStageElement } from '../schema/bookDefaults'
import type { PartElement } from '../schema/stageElement'
import { validateBookParts } from './book'
import { bookEditScene } from './bookEdit'
import { planPartEdit } from './edit'
import { planPartPlacement } from './placement'
import { newPartDefinition } from './schema'
import { syncDefinitionRequirements, validatePartDefinition } from './validate'

const reference = { builtin: 'v-fold', version: 1 }
const mount = { type: 'output' as const, nodeId: '$book', portId: 'gutter' }
const original = builtins.evaluateBuiltin
beforeEach(() => {
  // 接着と各瞬間の剛性は正しいが、途中だけ紙の外形を変える評価器の退行を再現する。
  vi.spyOn(builtins, 'evaluateBuiltin').mockImplementation((...args) => {
    const result = original(...args), [id, input] = args
    if (id === 'v-fold' && input.kind === 'fold-pair') {
      const angle = openingAngle(input), cut = angle > 1 && angle < 179 ? .1 : 0
      result.faces[0].outline = [[0, 0], [1, 0], [1, 1], [0, 1], [cut, .5]]
    }
    return result
  })
})
afterEach(() => vi.restoreAllMocks())

describe('支持紙の共通制約を編集経路へ適用する', () => {
  it('見開きの成立検査で、途中だけ変わる紙を拒否する', () => {
    const project = createBookProject()
    project.book.spreads[0].elements = [{ ...createStageElement('part'), id: 'part',
      part: { definition: reference, mount, parameters: {}, materials: {} } } as PartElement]
    expect(validateBookParts(project)).toContainEqual(expect.stringContaining('Paper material changes during folding'))
  })
  it('配置ホバーの候補とギズモの候補を同じ理由で拒否し、元データを変更しない', () => {
    const project = createBookProject(), spread = project.book.spreads[0]
    const pick = (portId: string) => ({ surface: { nodeId: '$book', portId }, point: [3.2, 1] as [number, number] })
    const placement = planPartPlacement(project, spread.id, reference, pick('right-page'), pick('left-page'))
    expect(placement).toMatchObject({ ok: false, detail: expect.stringContaining('Paper material changes during folding') })
    expect(spread.elements).toHaveLength(0)
    spread.elements = [{ ...createStageElement('part'), id: 'part', part: { definition: reference, mount, parameters: {}, materials: {} } } as PartElement]
    const before = JSON.stringify(project)
    const edit = planPartEdit(bookEditScene(project, spread.id), 'part', { type: 'translate', delta: [.2, 0] })
    expect(edit).toMatchObject({ ok: false, detail: expect.stringContaining('Paper material changes during folding') })
    expect(JSON.stringify(project)).toBe(before)
  })
  it('カスタム部品の公開・読み込み後の成立検査でも、内部の変形を見逃さない', () => {
    const definition = newPartDefinition('折り部品')
    definition.nodes = [{ id: 'part', name: '内部の紙', definition: reference, mount: { type: 'input' }, parameters: {}, materials: {} }]
    syncDefinitionRequirements(definition)
    const restored = JSON.parse(JSON.stringify(definition))
    expect(validatePartDefinition(restored)).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringContaining('Paper material changes during folding')]) })
  })
})
