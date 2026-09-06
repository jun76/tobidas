import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createBookProject, createStageElement } from '../schema/bookDefaults'
import type { AssemblyElement } from '../schema/stageElement'
import { validateBookProject } from '../schema/bookValidate'
import { auditAssemblies } from '../runtime/mechanisms/audit'
import { evaluateAssemblyScene } from '../runtime/mechanisms/scene'
import { buildMechanismComposition, compositionKinds, compositionRootMechanism, type CompositionKind } from './mechanismPresets'

function fixture(kind: CompositionKind, count = 3) {
  const project = createBookProject('初期状態の接続')
  const root = createStageElement('assembly') as AssemblyElement
  root.mechanism = compositionRootMechanism(kind, 6, 4)
  root.baseTransform.position = [0, 0, 0]
  root.composition = { kind, count, spacing: 1.2 }
  const children = buildMechanismComposition(root, root.composition)
  const spread = project.book.spreads[0]
  spread.elements = [root, ...children]
  return { project, root, children, spread }
}

describe('複合プリセットの初期接続', () => {
  it.each(compositionKinds)('%sは実際の谷間につながり、開閉途中も支点を保持する', (kind) => {
    const { project, root, children, spread } = fixture(kind)
    expect(validateBookProject(project).errors).toEqual([])
    expect(root.mechanism.mount.type).toBe('gutter')
    for (const part of [root, ...children]) {
      expect(part.mechanism.deployment.mode).toBe('page-constrained')
      expect(part.mechanism.staging.openScale).toBe(1)
      expect(part.mechanism.staging.closedScale).toBe(1)
      expect(part.mechanism.staging.closedPosition).toEqual([0, 0, 0])
      expect(part.mechanism.staging.openPosition).toEqual([0, 0, 0])
      expect(part.mechanism.staging.floatAmplitude).toEqual([0, 0, 0])
      if (part !== root) expect(part.mechanism.mount.type).toBe(part.mechanism.kind === 'panel' ? 'surface' : 'bridge')
    }
    const report = auditAssemblies(project.book, spread)
    expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(report.checkedConnections).toBeGreaterThan(0)
    expect(report.maxConnectionError).toBeLessThan(1e-6)
    expect(report.drivenAssemblies).toBe(children.length + 1)
    expect(report.undrivenAssemblies).toBe(0)
    expect(report.unauthorizedTransforms).toBe(0)
    for (const open of [.15, .35, .5, .75, 1]) {
      const scene = evaluateAssemblyScene(project.book, spread, { open, leftAngle: Math.PI, rightAngle: (1 - open) * Math.PI, spreadTime: 0, clock: 0 })
      const rootSurfaces = scene.surfaces.filter((entry) => entry.elementId === root.id)
      expect(rootSurfaces.length).toBeGreaterThan(0)
      for (const part of rootSurfaces) {
        // 形状は紙の角度から折る。全体を移動・縮小して検査を通していない。
        expect(new THREE.Vector3().setFromMatrixPosition(part.matrix).length()).toBeLessThan(1e-8)
        expect(new THREE.Vector3().setFromMatrixScale(part.matrix).toArray()).toEqual([1, 1, 1])
      }
    }
  })

  it('家・木・ケーキはそれぞれ箱・V折り・曲面胴を根元の形にする', () => {
    expect(fixture('house').root.mechanism.kind).toBe('box')
    expect(fixture('tree').root.mechanism.kind).toBe('v-fold')
    expect(fixture('cake').root.mechanism.kind).toBe('curved-shell')
    expect(fixture('meadow').root.mechanism.kind).toBe('accordion')
  })

  it('多段ケーキの子は実際の親のブリッジへつながる', () => {
    const { root, children } = fixture('cake')
    let parent = root
    for (const tier of children) {
      expect(tier.mechanism.mount).toMatchObject({ type: 'bridge', elementId: parent.id, bridgeId: 'deck' })
      expect(tier.mechanism.parameters.width).toBeLessThanOrEqual(parent.mechanism.parameters.width * .64)
      expect(tier.mechanism.parameters.depth).toBeLessThanOrEqual(parent.mechanism.parameters.depth * .64)
      parent = tier
    }
  })

  it.each(['house', 'room', 'bridge'] as const)('%sの反復数1〜3で片面のヒンジが面の端や折り線を越えない', (kind) => {
    for (const count of [1, 2, 3]) {
      const { project, spread } = fixture(kind, count)
      expect(validateBookProject(project).errors).toEqual([])
      expect(auditAssemblies(project.book, spread).issues.filter((issue) => issue.severity === 'error')).toEqual([])
    }
  })
})
