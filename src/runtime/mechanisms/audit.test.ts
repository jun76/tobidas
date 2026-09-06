import { describe, expect, it } from 'vitest'
import { createBook, createStageElement } from '../../schema/bookDefaults'
import { makeMechanism } from '../../schema/mechanism'
import type { AssemblyElement, VisualElement } from '../../schema/stageElement'
import { auditAssemblies } from './audit'

function fixture() {
  const book = createBook()
  const root = createStageElement('assembly') as AssemblyElement
  root.mechanism = makeMechanism('platform', { parameters: { height: .1 } })
  const spread = book.spreads[0]
  spread.elements = [root]
  return { book, spread, root }
}

describe('複合機構の保持時刻と周期位相の包含検査', () => {
  it('無限平面上では接着していても、実際の紙より外のアンカーは拒否する', () => {
    const { book, spread, root } = fixture()
    root.mechanism = makeMechanism('box', { parameters: { width: 30 }, deployment: { mode: 'page-constrained' } })
    const issue = auditAssemblies(book, spread).issues.find((entry) => entry.code === 'invalid-page-anchor')
    expect(issue?.elementId).toBe(root.id)
    expect(issue?.message).toContain('real gutter anchors exceed page width')
    expect(issue?.message).toContain('rigid folded mechanism exceeds finite page reach')
  })

  it('時計0では紙面より上でも、浮遊の下端で沈む機構をエラーにする', () => {
    const { book, spread, root } = fixture()
    root.mechanism.staging.floatAmplitude = [0, 2, 0]
    root.mechanism.staging.floatPeriod = 5
    const before = structuredClone(book)
    const errors = auditAssemblies(book, spread).issues.filter((issue) => issue.severity === 'error')
    expect(errors).toEqual([expect.objectContaining({ elementId: root.id, code: 'page-penetration' })])
    expect(errors[0].message).toContain('openness 1.000')
    expect(errors[0].message).toContain('clock')
    expect(book).toEqual(before)
  })

  it('紙面外へ巨大に広がる安全な浮遊は許容し、全開形状を補正しない', () => {
    const { book, spread, root } = fixture()
    root.baseTransform.position = [15, 3, -6]
    root.mechanism.parameters.width = 30
    root.mechanism.staging.floatAmplitude = [.5, 2, .2]
    root.mechanism.staging.floatPhase = .4
    const before = structuredClone(book)
    const report = auditAssemblies(book, spread)
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(report.maxExtent).toBeGreaterThan(30)
    expect(book).toEqual(before)
  })

  it('保持区間の短い下降キーも見逃さない', () => {
    const { book, spread, root } = fixture()
    spread.timeline.tracks = [{
      id: 'dip', target: { type: 'element', elementId: root.id }, property: 'position.y',
      keys: [{ id: 'start', time: 0, value: 0, ease: 'linear' },
        { id: 'dip', time: .017, value: -.6, ease: 'linear' },
        { id: 'end', time: .025, value: 0, ease: 'linear' }],
    }]
    const issue = auditAssemblies(book, spread).issues.find((entry) => entry.code === 'page-penetration')
    expect(issue?.elementId).toBe(root.id)
    expect(issue?.message).toContain('hold 0.009s')
  })

  it('保持中の位置変化と浮遊の組み合わせでだけ起こる貫通も検出する', () => {
    const { book, spread, root } = fixture()
    root.baseTransform.position[1] = 2.5
    root.mechanism.staging.floatAmplitude = [0, 1, 0]
    spread.timeline.tracks = [{
      id: 'lower', target: { type: 'element', elementId: root.id }, property: 'position.y',
      keys: [{ id: 'a', time: 0, value: 2.5, ease: 'linear' },
        { id: 'b', time: .2, value: .5, ease: 'linear' },
        { id: 'c', time: .4, value: 2.5, ease: 'linear' }],
    }]
    const issue = auditAssemblies(book, spread).issues.find((entry) => entry.elementId === root.id && entry.code === 'page-penetration')
    expect(issue).toBeDefined()
    expect(issue?.message).toContain('openness 1.000')
    expect(issue?.message).not.toContain('hold 0.000s')
    expect(issue?.message).not.toContain('clock 0.000s')
  })

  it('キーの端点だけでは安全に見える子の回転も、補間途中で検査する', () => {
    const { book, spread, root } = fixture()
    const child = createStageElement('visual', { type: 'element', elementId: root.id }) as VisualElement
    child.surfaceAttachment = { surfaceId: 'top', u: .5, v: .5, offset: 0 }
    child.width = 4; child.height = .4; child.pivot = [.5, .5]
    child.baseTransform = { position: [0, .5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    spread.elements.push(child)
    spread.timeline.tracks = [{
      id: 'rotate', target: { type: 'element', elementId: child.id }, property: 'rotation.z',
      keys: [{ id: 'a', time: 0, value: 0, ease: 'linear' },
        { id: 'b', time: .01, value: 180, ease: 'linear' }],
    }]
    const issue = auditAssemblies(book, spread).issues.find((entry) => entry.elementId === child.id && entry.code === 'page-penetration')
    expect(issue?.message).toContain('hold 0.005s')
  })

  it('位相がずれた短周期のわずかな沈み込みを、波の極値で検出する', () => {
    const { book, spread, root } = fixture()
    root.baseTransform.position[1] = 1.999
    root.motion = [{ type: 'bob', amplitude: 2, period: .013, phase: .19 }]
    expect(auditAssemblies(book, spread).issues).toContainEqual(expect.objectContaining({ elementId: root.id, code: 'page-penetration' }))
  })

  it('driftのY方向の0.83倍の周期を使って最大下降を検出する', () => {
    const { book, spread, root } = fixture()
    root.baseTransform.position[1] = 1.999
    root.motion = [{ type: 'drift', amplitude: [0, 2, 0], period: 1, phase: .73 }]
    expect(auditAssemblies(book, spread).issues).toContainEqual(expect.objectContaining({ elementId: root.id, code: 'page-penetration' }))
  })

  it('面上groupの通常の孫部品の動きも検査する', () => {
    const { book, spread, root } = fixture()
    const group = createStageElement('group', { type: 'element', elementId: root.id })
    group.surfaceAttachment = { surfaceId: 'top', u: .5, v: .5, offset: 0 }
    group.baseTransform.position = [0, 0, 0]
    const child = createStageElement('visual', { type: 'element', elementId: group.id }) as VisualElement
    child.baseTransform = { position: [0, .2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    child.motion = [{ type: 'bob', amplitude: 1, period: 2.9, phase: 0 }]
    spread.elements.push(group, child)
    expect(auditAssemblies(book, spread).issues).toContainEqual(expect.objectContaining({ elementId: child.id, code: 'page-penetration' }))
  })

  it('隠した機構や無関係な通常部品の周期で、結果や走査量を増やさない', () => {
    const { book, spread, root } = fixture()
    root.visible = false
    root.baseTransform.position[1] = -5
    const unrelated = createStageElement('visual')
    unrelated.motion = [{ type: 'bob', amplitude: 100, period: 99, phase: 0 }]
    spread.elements.push(unrelated)
    const report = auditAssemblies(book, spread)
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(report.samples).toBe(82)
  })
})
