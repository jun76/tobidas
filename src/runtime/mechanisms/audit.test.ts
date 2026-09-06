import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createBook, createStageElement } from '../../schema/bookDefaults'
import { makeMechanism } from '../../schema/mechanism'
import type { AssemblyElement, VisualElement } from '../../schema/stageElement'
import { auditAssemblies, inspectAssemblyConnections, inspectAssemblyScene, assemblyAuditSampleTimes } from './audit'
import { evaluateAssemblyScene } from './scene'
import { evaluateContentMotion } from '../motion'

describe('最終描画座標での接着検査', () => {
  function connectedBox() {
    const book = createBook()
    const root = createStageElement('assembly') as AssemblyElement
    root.mechanism = makeMechanism('box', { deployment: { mode: 'page-constrained' } })
    const spread = book.spreads[0]
    spread.elements = [root]
    const input = { open: .4, leftAngle: Math.PI, rightAngle: Math.PI * .6, spreadTime: 0, clock: 0 }
    const scene = evaluateAssemblyScene(book, spread, input)
    const connections = scene.connections
    return { root, spread, input, scene, connections }
  }

  it('実ページ座標から独立に求めた接着点と、半開の箱の最終頂点が一致する', () => {
    const { input, scene, connections } = connectedBox()
    const report = inspectAssemblyConnections(input, scene.surfaces, connections)
    expect(report.issues).toEqual([])
    expect(report.checkedConnections).toBe(6)
    expect(report.maxConnectionError).toBeLessThan(1e-7)
  })

  it.each(['translation', 'scale'] as const)('紙を貫通しない全体%sでも、最終変換が接着点を離したら拒否する', (change) => {
    const { input, scene, connections, root } = connectedBox()
    const transform = change === 'translation' ? new THREE.Matrix4().makeTranslation(0, 3, 0) : new THREE.Matrix4().makeScale(.1, .1, .1)
    for (const entry of scene.surfaces) entry.matrix.premultiply(transform)
    const report = inspectAssemblyConnections(input, scene.surfaces, connections)
    expect(report.issues).toContainEqual(expect.objectContaining({ elementId: root.id, code: 'detached-page-anchor' }))
    expect(report.maxConnectionError).toBeGreaterThan(.1)
  })

  it('親面の接続先を欠落させたfixtureを接着済みとして扱わない', () => {
    const { input, scene, connections, root } = connectedBox()
    const connection = { ...connections[0], expected: { type: 'surface' as const, elementId: 'missing-parent', surfaceId: 'top',
      weights: [{ vertexId: 'missing-vertex', weight: 1 }] } }
    expect(inspectAssemblyConnections(input, scene.surfaces, [connection]).issues).toContainEqual(
      expect.objectContaining({ elementId: root.id, code: 'missing-connection-geometry' }))
  })

  it('接着する支持面だけを残して本体面を動かしても、最終座標の継ぎ目で拒否する', () => {
    const { input, scene, connections, root } = connectedBox()
    const top = scene.surfaces.find((entry) => entry.surface.id === 'top-left')!
    top.matrix.premultiply(new THREE.Matrix4().makeTranslation(0, 2, 0))
    expect(inspectAssemblyConnections(input, scene.surfaces, connections).issues).toContainEqual(
      expect.objectContaining({ elementId: root.id, code: 'broken-scene-seam' }))
  })

  it('親面と子の最終座標を比較し、子だけを退避させる修正を検出する', () => {
    const { input, scene, connections } = connectedBox()
    const original = scene.surfaces.find((entry) => entry.surface.id === connections[0].actual.surfaceId)!
    const child = { ...original, elementId: 'child', matrix: original.matrix.clone() }
    const connection = { elementId: child.elementId,
      actual: { ...connections[0].actual, elementId: child.elementId },
      expected: { type: 'surface' as const, elementId: original.elementId, surfaceId: original.surface.id,
        weights: [{ vertexId: connections[0].actual.vertexId, weight: 1 }] } }
    const surfaces = [...scene.surfaces, child]
    expect(inspectAssemblyConnections(input, surfaces, [connection]).issues).toEqual([])
    child.matrix.premultiply(new THREE.Matrix4().makeTranslation(0, 2, 0))
    expect(inspectAssemblyConnections(input, surfaces, [connection]).issues).toContainEqual(
      expect.objectContaining({ elementId: child.elementId, code: 'detached-parent-anchor' }))
  })

  it('全体を空中の一点へ退避する旧方式は、接着と無指定変換の両方で拒否する', () => {
    const { spread, input, scene, root } = connectedBox()
    const correction = new THREE.Matrix4().makeTranslation(0, 2.8, 0).multiply(new THREE.Matrix4().makeScale(.02, .02, .02))
    for (const entry of scene.structuralSurfaces) entry.matrix.premultiply(correction)
    const report = inspectAssemblyScene(spread, input, scene)
    expect(report.issues).toContainEqual(expect.objectContaining({ elementId: root.id, code: 'detached-page-anchor' }))
    expect(report.issues).toContainEqual(expect.objectContaining({ elementId: root.id, code: 'unauthorized-scene-transform' }))
    expect(report.unauthorizedTransforms).toBe(1)
  })

  it('接着記録を削除して検査を0点にするfixtureも拒否する', () => {
    const { spread, input, scene, root } = connectedBox()
    scene.connections = []
    expect(inspectAssemblyScene(spread, input, scene).issues).toContainEqual(
      expect.objectContaining({ elementId: root.id, code: 'incomplete-driver-anchors' }))
  })

  it('支持面が非表示でも、構造面の接着は6点すべて検査する', () => {
    const { spread, input, scene } = connectedBox()
    scene.surfaces = scene.surfaces.filter((entry) => !entry.surface.support)
    const report = inspectAssemblyScene(spread, input, scene)
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(report.checkedConnections).toBe(6)
  })

  it('親bridgeから解いた本物の子機構でも、描画後に子だけ動かすと接着分離になる', () => {
    const book = createBook()
    const spread = book.spreads[0]
    const root = createStageElement('assembly') as AssemblyElement
    root.mechanism = makeMechanism('platform')
    const child = createStageElement('assembly', { type: 'element', elementId: root.id }) as AssemblyElement
    child.mechanism = makeMechanism('box', { parameters: { width: 1, height: .5, depth: 1 },
      mount: { type: 'bridge', elementId: root.id, bridgeId: 'deck', v: .5 } })
    spread.elements = [root, child]
    const input = { open: .35, leftAngle: Math.PI, rightAngle: .65 * Math.PI, spreadTime: 0, clock: 0 }
    const scene = evaluateAssemblyScene(book, spread, input)
    const baseline = inspectAssemblyScene(spread, input, scene)
    expect(baseline.checkedConnections).toBe(12)
    expect(baseline.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    for (const entry of scene.structuralSurfaces.filter((surface) => surface.elementId === child.id)) entry.matrix.makeTranslation(0, 1, 0)
    expect(inspectAssemblyScene(spread, input, scene).issues).toContainEqual(
      expect.objectContaining({ elementId: child.id, code: 'detached-parent-anchor' }))
    scene.bridges = []
    expect(inspectAssemblyScene(spread, input, scene).issues).toContainEqual(
      expect.objectContaining({ elementId: child.id, code: 'missing-scene-bridge' }))
  })
})

function fixture() {
  const book = createBook()
  const root = createStageElement('assembly') as AssemblyElement
  root.mechanism = makeMechanism('platform', { parameters: { height: .1 } })
  const spread = book.spreads[0]
  spread.elements = [root]
  return { book, spread, root }
}

describe('実ページまで続く駆動契約の検査', () => {
  it('旧space rootを自動退避で救済せず、未対応の駆動として拒否する', () => {
    const { book, spread, root } = fixture()
    root.mechanism.mount = { type: 'space' } as never
    const report = auditAssemblies(book, spread)
    expect(report.issues).toContainEqual(expect.objectContaining({ elementId: root.id, code: 'invalid-drive-contract' }))
    expect(report.undrivenAssemblies).toBe(1)
    expect(report.samples).toBe(0)
  })

  it('旧ローカル開始終了の指定を、ページから駆動した結果へ黙って読み替えない', () => {
    const { book, spread, root } = fixture()
    Object.assign(root.mechanism.deployment, { start: .2, end: .7 })
    expect(auditAssemblies(book, spread).issues).toContainEqual(
      expect.objectContaining({ elementId: root.id, code: 'invalid-drive-contract' }))
  })

  it('単一パネルには存在しないbridgeを駆動元にした子は拒否する', () => {
    const { book, spread, root } = fixture()
    root.mechanism = makeMechanism('panel')
    const child = createStageElement('assembly', { type: 'element', elementId: root.id }) as AssemblyElement
    child.mechanism = makeMechanism('box', { mount: { type: 'bridge', elementId: root.id, bridgeId: 'deck', v: .5 } })
    spread.elements.push(child)
    const report = auditAssemblies(book, spread)
    expect(report.issues).toContainEqual(expect.objectContaining({ elementId: child.id, code: 'missing-drive-chain' }))
    expect(report.drivenAssemblies).toBe(1)
    expect(report.undrivenAssemblies).toBe(1)
  })

  it('親IDとbridge駆動元を別の部品にした接続は拒否する', () => {
    const { book, spread, root } = fixture()
    const child = createStageElement('assembly', { type: 'element', elementId: root.id }) as AssemblyElement
    child.mechanism = makeMechanism('box', { mount: { type: 'bridge', elementId: 'other-parent', bridgeId: 'deck', v: .5 } })
    spread.elements.push(child)
    expect(auditAssemblies(book, spread).issues).toContainEqual(
      expect.objectContaining({ elementId: child.id, code: 'missing-drive-chain' }))
  })
})

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
    root.mechanism.deployment.mode = 'virtual'
    root.mechanism.staging.floatAmplitude = [0, 2, 0]
    root.mechanism.staging.floatPeriod = 5
    const before = structuredClone(book)
    const errors = auditAssemblies(book, spread).issues.filter((issue) => issue.severity === 'error')
    expect(errors).toEqual([expect.objectContaining({ elementId: root.id, code: 'page-penetration' })])
    expect(errors[0].message).toContain('clock')
    const full = evaluateAssemblyScene(book, spread, { open: 1, leftAngle: Math.PI, rightAngle: 0, spreadTime: 0, clock: 5 * 7 / 12 })
    expect(Math.min(...full.surfaces.flatMap((entry) => entry.surface.positions.filter((_, i) => i % 3 === 1)))).toBeLessThan(-1.9)
    expect(book).toEqual(before)
  })

  it('紙面外へ巨大に広がる安全な浮遊は許容し、全開形状を補正しない', () => {
    const { book, spread, root } = fixture()
    root.mechanism.deployment.mode = 'virtual'
    root.mechanism.staging.openScale = 10
    root.mechanism.staging.openPosition = [0, 3, 0]
    root.mechanism.staging.floatAmplitude = [0, 2, 0]
    root.mechanism.staging.floatPhase = .4
    const before = structuredClone(book)
    const report = auditAssemblies(book, spread)
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(report.maxExtent).toBeGreaterThan(30)
    expect(book).toEqual(before)
  })

  it('保持区間の短い下降キーで実接着を動かす指定も拒否する', () => {
    const { book, spread, root } = fixture()
    spread.timeline.tracks = [{
      id: 'dip', target: { type: 'element', elementId: root.id }, property: 'position.y',
      keys: [{ id: 'start', time: 0, value: 0, ease: 'linear' },
        { id: 'dip', time: .017, value: -.6, ease: 'linear' },
        { id: 'end', time: .025, value: 0, ease: 'linear' }],
    }]
    const issue = auditAssemblies(book, spread).issues.find((entry) => entry.code === 'invalid-drive-transform')
    expect(issue?.elementId).toBe(root.id)
    expect(assemblyAuditSampleTimes(spread).holdTimes).toContain(.0085)
  })

  it('明示的な浮遊を設定しても、追加の全体位置トラックは許可しない', () => {
    const { book, spread, root } = fixture()
    root.mechanism.deployment.mode = 'virtual'
    root.mechanism.staging.openPosition = [0, 2.5, 0]
    root.mechanism.staging.floatAmplitude = [0, 1, 0]
    spread.timeline.tracks = [{
      id: 'lower', target: { type: 'element', elementId: root.id }, property: 'position.y',
      keys: [{ id: 'a', time: 0, value: 2.5, ease: 'linear' },
        { id: 'b', time: .2, value: .5, ease: 'linear' },
        { id: 'c', time: .4, value: 2.5, ease: 'linear' }],
    }]
    const issue = auditAssemblies(book, spread).issues.find((entry) => entry.elementId === root.id && entry.code === 'invalid-drive-transform')
    expect(issue).toBeDefined()
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
    expect(issue).toBeDefined()
    expect(assemblyAuditSampleTimes(spread).holdTimes).toContain(.005)
  })

  it('位相がずれた短周期のわずかな沈み込みを、波の極値で検出する', () => {
    const { book, spread, root } = fixture()
    const child = createStageElement('visual', { type: 'element', elementId: root.id }) as VisualElement
    child.surfaceAttachment = { surfaceId: 'top', u: .5, v: .5, offset: 0 }
    child.baseTransform.position = [0, 1.899, 0]
    child.motion = [{ type: 'bob', amplitude: 2, period: .013, phase: .19 }]
    spread.elements.push(child)
    const minimum = Math.min(...assemblyAuditSampleTimes(spread).clocks.map((clock) => evaluateContentMotion(child.motion, clock).position[1]))
    expect(minimum).toBeCloseTo(-2, 10)
    expect(auditAssemblies(book, spread).issues).toContainEqual(expect.objectContaining({ elementId: child.id, code: 'page-penetration' }))
  })

  it('driftのY方向の0.83倍の周期を使って最大下降を検出する', () => {
    const { book, spread, root } = fixture()
    const child = createStageElement('visual', { type: 'element', elementId: root.id }) as VisualElement
    child.surfaceAttachment = { surfaceId: 'top', u: .5, v: .5, offset: 0 }
    child.baseTransform.position = [0, 1.899, 0]
    child.motion = [{ type: 'drift', amplitude: [0, 2, 0], period: 1, phase: .73 }]
    spread.elements.push(child)
    const minimum = Math.min(...assemblyAuditSampleTimes(spread).clocks.map((clock) => evaluateContentMotion(child.motion, clock).position[1]))
    expect(minimum).toBeCloseTo(-2, 10)
    expect(auditAssemblies(book, spread).issues).toContainEqual(expect.objectContaining({ elementId: child.id, code: 'page-penetration' }))
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
    const unrelated = createStageElement('visual')
    unrelated.motion = [{ type: 'bob', amplitude: 100, period: 99, phase: 0 }]
    spread.elements.push(unrelated)
    const report = auditAssemblies(book, spread)
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(report.samples).toBe(82)
  })
})
