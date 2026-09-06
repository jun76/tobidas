import { describe, expect, it } from 'vitest'
import { createBookProject } from '../../schema/bookDefaults'
import type { AssemblyElement } from '../../schema/stageElement'
import { compositionKinds } from '../mechanismPresets'
import { useBuilderStore } from '../store'
import { buildBuilderStateSummary } from './stateSummary'
import { attachToSurfaceCommand, createCompositionCommand, createMechanismCommand, mechanismKinds, placeSurfaceAssetCommand,
  setMechanismSurfaceCommand, updateCompositionCommand, updateMechanismCommand } from './mechanisms'

function setup() {
  const project = createBookProject('機構の編集')
  project.assets.push({ id: 'actor.svg', type: 'svg', name: '人物', mime: 'image/svg+xml', data: '<svg xmlns="http://www.w3.org/2000/svg" />' })
  useBuilderStore.getState().setProject(project, 'import')
  useBuilderStore.getState().setMode('edit')
  return project.book.spreads[0].id
}
function assembly() { return useBuilderStore.getState().project.book.spreads[0].elements.find((element) => element.type === 'assembly') as AssemblyElement }

describe('機構の共通編集コマンド', () => {
  it.each(mechanismKinds)('%sを標準commitで投入しundo/redoできる', (kind) => {
    const spreadId = setup()
    const before = useBuilderStore.getState().undoStack.length
    expect(createMechanismCommand({ spreadId, kind }).ok).toBe(true)
    expect(useBuilderStore.getState().issues.errors).toEqual([])
    expect(useBuilderStore.getState().undoStack.length).toBe(before + 1)
    useBuilderStore.getState().undo()
    expect(useBuilderStore.getState().project.book.spreads[0].elements).toHaveLength(0)
    useBuilderStore.getState().redo()
    expect(assembly().mechanism.kind).toBe(kind)
    expect(assembly().mechanism.deployment.mode).toBe('page-constrained')
    expect(assembly().mechanism.mount.type).toBe(kind === 'panel' ? 'page' : 'gutter')
    expect(assembly().mechanism.staging.openScale).toBe(1)
    expect(assembly().mechanism.staging.closedScale).toBe(1)
  })

  it('谷間の箱は実駆動で作れ、浮遊との不正な組み合わせは作品を変えず拒否する', () => {
    const spreadId = setup()
    expect(createMechanismCommand({ spreadId, kind: 'box', deployment: { mode: 'page-constrained' } }).ok).toBe(true)
    expect(assembly().mechanism.mount).toEqual({ type: 'gutter' })
    expect(assembly().mechanism.staging.closedScale).toBe(1)
    const before = useBuilderStore.getState().project
    expect(updateMechanismCommand({ spreadId, elementId: assembly().id, staging: { floatAmplitude: [0, 1, 0] } }).ok).toBe(false)
    expect(useBuilderStore.getState().project).toBe(before)
    expect(createMechanismCommand({ spreadId, kind: 'beak', mount: { type: 'page', side: 'right' } }).ok).toBe(false)
    expect(useBuilderStore.getState().project).toBe(before)
  })

  it('巨大化は明示演出で指定し、実際の谷間の取り付けを動かさない', () => {
    const spreadId = setup()
    expect(createMechanismCommand({ spreadId, kind: 'box', parameters: { width: 4, height: 2 },
      deployment: { mode: 'virtual' }, staging: { openScale: 4, closedScale: 1, openPosition: [0, .6, 0], floatAmplitude: [0, .2, 0] } }).ok).toBe(true)
    const part = assembly()
    expect(part.mechanism.mount).toEqual({ type: 'gutter' })
    expect(part.mechanism.parameters.width).toBe(4)
    expect(part.mechanism.staging.openScale).toBe(4)
    expect(part.mechanism.staging.openPosition).toEqual([0, .6, 0])
    expect(part.baseTransform.position).toEqual([0, 0, 0])
    useBuilderStore.getState().updateElement(spreadId, part.id, (item) => { item.name = '巨大な箱' })
    expect(assembly().baseTransform.position).toEqual([0, 0, 0])
  })

  it('ブリッジの親・寸法と位置を検査し、不正な接続をcommitしない', () => {
    const spreadId = setup()
    createMechanismCommand({ spreadId, kind: 'platform', parameters: { width: 6, depth: 4 } })
    const root = assembly()
    const before = useBuilderStore.getState().project
    expect(createMechanismCommand({ spreadId, kind: 'box', parameters: { width: 7 }, mount: { type: 'bridge', elementId: root.id, bridgeId: 'deck' } }).ok).toBe(false)
    expect(useBuilderStore.getState().project).toBe(before)
    expect(createMechanismCommand({ spreadId, kind: 'box', parameters: { width: 3, depth: 1 }, mount: { type: 'bridge', elementId: root.id, bridgeId: 'deck', v: .7 } }).ok).toBe(true)
    const child = useBuilderStore.getState().project.book.spreads[0].elements[1] as AssemblyElement
    expect(child.parent).toEqual({ type: 'element', elementId: root.id })
    expect(child.mechanism.mount).toEqual({ type: 'bridge', elementId: root.id, bridgeId: 'deck', v: .7 })
    const valid = useBuilderStore.getState().project
    expect(updateMechanismCommand({ spreadId, elementId: child.id, parameters: { depth: 5 } }).ok).toBe(false)
    expect(useBuilderStore.getState().project).toBe(valid)
  })

  it('面上の素材配置は一度のundoで戻り、面参照と素材を状態要約に含める', () => {
    const spreadId = setup()
    createMechanismCommand({ spreadId, kind: 'platform' })
    const parent = assembly()
    const before = useBuilderStore.getState().undoStack.length
    expect(placeSurfaceAssetCommand({ spreadId, parentId: parent.id, surfaceId: 'top', assetId: 'actor.svg', u: .2, v: .7, width: 1, height: 2 }).ok).toBe(true)
    const state = useBuilderStore.getState()
    expect(state.undoStack.length).toBe(before + 1)
    const child = state.project.book.spreads[0].elements[1]
    expect(child.parent).toEqual({ type: 'element', elementId: parent.id })
    expect(child.surfaceAttachment).toEqual({ surfaceId: 'top', u: .2, v: .7, offset: 0 })
    expect(buildBuilderStateSummary(state).spreads[0].elements[0].surfaces).toContain('top')
    state.undo(); expect(useBuilderStore.getState().project.book.spreads[0].elements).toHaveLength(1)
  })

  it('面削除前に取り付け部品への影響を返し、残る面の素材は維持する', () => {
    const spreadId = setup()
    createMechanismCommand({ spreadId, kind: 'accordion', parameters: { segments: 6 } })
    const parent = assembly()
    setMechanismSurfaceCommand({ spreadId, elementId: parent.id, surfaceId: 'fold-0', image: 'actor.svg', text: '表面' })
    placeSurfaceAssetCommand({ spreadId, parentId: parent.id, surfaceId: 'fold-5', assetId: 'actor.svg', u: .5, v: .5, width: 1, height: 1 })
    const before = useBuilderStore.getState().project
    const result = updateMechanismCommand({ spreadId, elementId: parent.id, parameters: { segments: 3 } })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('人物')
    expect(useBuilderStore.getState().project).toBe(before)
    expect(updateMechanismCommand({ spreadId, elementId: parent.id, parameters: { segments: 8 } }).ok).toBe(true)
    expect(assembly().mechanism.surfaces['fold-0'].image).toBe('actor.svg')
  })

  it('面の表示を消しても面アンカーが残り、親子循環を拒否する', () => {
    const spreadId = setup()
    createMechanismCommand({ spreadId, kind: 'platform' })
    const root = assembly()
    createMechanismCommand({ spreadId, kind: 'box', mount: { type: 'bridge', elementId: root.id, bridgeId: 'deck' } })
    const child = useBuilderStore.getState().project.book.spreads[0].elements[1]
    expect(setMechanismSurfaceCommand({ spreadId, elementId: root.id, surfaceId: 'top', visible: false }).ok).toBe(true)
    expect(assembly().mechanism.surfaces.top.visible).toBe(false)
    expect(attachToSurfaceCommand({ spreadId, elementId: root.id, parentId: child.id, surfaceId: 'top-left', u: .5, v: .5 }).ok).toBe(false)
  })

  it.each(compositionKinds)('%sの複合プリセットは有効な面階層を持ち、原子的に編集できる', (kind) => {
    const spreadId = setup()
    expect(createCompositionCommand({ spreadId, kind, count: 3 }).ok).toBe(true)
    expect(useBuilderStore.getState().issues.errors).toEqual([])
    const root = assembly()
    expect(root.mechanism.mount.type).toBe('gutter')
    expect(root.mechanism.deployment.mode).toBe('page-constrained')
    const first = useBuilderStore.getState().project.book.spreads[0].elements[1] as AssemblyElement
    const surfaceId = buildBuilderStateSummary(useBuilderStore.getState()).spreads[0].elements[1].surfaces![0]
    setMechanismSurfaceCommand({ spreadId, elementId: first.id, surfaceId, image: 'actor.svg' })
    const before = useBuilderStore.getState().undoStack.length
    expect(updateCompositionCommand({ spreadId, elementId: root.id, count: 4, spacing: 1.5 }).ok).toBe(true)
    expect(useBuilderStore.getState().undoStack.length).toBe(before + 1)
    const preserved = useBuilderStore.getState().project.book.spreads[0].elements.find((item) => item.id === first.id) as AssemblyElement
    expect(preserved.mechanism.surfaces[surfaceId].image).toBe('actor.svg')
    expect(useBuilderStore.getState().issues.errors).toEqual([])
  })

  it('複製した複合プリセットにも面階層と役割IDが保たれる', () => {
    const spreadId = setup()
    createCompositionCommand({ spreadId, kind: 'house', count: 2 })
    useBuilderStore.getState().duplicateSpread(spreadId)
    const copy = useBuilderStore.getState().project.book.spreads[1]
    const root = copy.elements[0] as AssemblyElement
    expect(copy.elements[1].id.startsWith(`${root.id}/`)).toBe(true)
    expect(useBuilderStore.getState().issues.errors).toEqual([])
    expect(updateCompositionCommand({ spreadId: copy.id, elementId: root.id, count: 3, spacing: 1.5 }).ok).toBe(true)
    expect(useBuilderStore.getState().issues.errors).toEqual([])
  })
})
