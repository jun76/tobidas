import { describe, expect, it } from 'vitest'
import { evaluateBuiltin } from './builtins'
import { faceCorners, openingAngle, pagePorts } from './geometry'
import { inspectPaper } from './validate'
import { facesCross } from './intersections'
import { describePartEdit, evaluateEditScene, planPartEdit, type PartEditScene } from './edit'

describe('配置角を設計できる剛体紙機構', () => {
  it('60°の接続先でも、傾きの目標は見えている地面からの実角度を指す', () => {
    const scene: PartEditScene = { maxAngle: 60, definitions: {}, nodes: [{ id: 'panel', name: '小物', definition: { builtin: 'upright', version: 1 },
      mount: { type: 'input' }, parameters: { width: 1, height: .7, distance: 1, supportHeight: .5 }, materials: {} }],
      at: (angle) => ({ input: pagePorts(20, 20, angle * Math.PI / 180, 0).gutter }) }
    const before = describePartEdit(scene, 'panel')
    expect(before.angles[0].value).toBeCloseTo(60)
    const plan = planPartEdit(scene, 'panel', { type: 'rotate', handle: 'tiltAngle', value: 75 })
    expect(plan.ok, plan.ok ? '' : plan.detail).toBe(true)
    if (!plan.ok) return
    const pair = evaluateEditScene(scene, plan.nodes).nodes.panel.ports['ground-panel']
    expect(pair.kind === 'fold-pair' && openingAngle(pair)).toBeCloseTo(75)
    expect(plan.nodes[0].parameters.tiltAngle).not.toBe(75)
    expect(describePartEdit({ ...scene, nodes: plan.nodes }, 'panel').pivot.distanceTo(before.pivot)).toBeLessThan(1e-6)
    expect(scene.maxAngle).toBe(60)
  })
  it('縦置きの傾きを固定長の支持で実現し、閉状態へ平らに戻る', () => {
    for (const tiltAngle of [60, 75, 90, 105, 120]) {
      let lengths: number[] = []
      for (const angle of [0, .001, 5, 15, 30, 45, 60, 75, 90]) {
        const input = pagePorts(20, 20, angle * Math.PI / 180, 0).gutter
        const result = evaluateBuiltin('upright', input, { width: 1, height: 2, distance: 1, supportHeight: 1, tiltAngle })
        expect(inspectPaper(result)).toEqual([])
        const next = result.faces.flatMap((face) => [face.width, face.height])
        if (!lengths.length) lengths = next
        expect(next).toEqual(lengths)
        if (angle === 0) expect(result.faces.flatMap(faceCorners).every((p) => Math.abs(p.y) < 1e-6)).toBe(true)
        if (angle === 90 && result.ports['ground-panel'].kind === 'fold-pair') expect(openingAngle(result.ports['ground-panel'])).toBeCloseTo(tiltAngle)
      }
    }
  })
  it('斜め縦置きは向きを変えても二面と三角支持の接続を保つ', () => {
    for (const yawAngle of [5, 15, 30, 45, 60, 70]) {
      for (const angle of [0, .001, 5, 15, 30, 45, 60, 75, 90]) {
        const input = pagePorts(20, 20, angle * Math.PI / 180, 0).gutter
        const result = evaluateBuiltin('angled-upright', input, { width: 2, height: 1.5, yawAngle })
        expect(inspectPaper(result), `${yawAngle}/${angle}`).toEqual([])
        expect(facesCross(result.faces[0], result.faces[1])).toBe(false)
        expect(result.faces[0].width).toBe(2); expect(result.faces[0].height).toBe(1.5)
        if (angle === 0) expect(result.faces.flatMap(faceCorners).every((p) => Math.abs(p.y) < 1e-6)).toBe(true)
        if (angle === 90) expect(result.faces[0].v.y).toBeCloseTo(1)
      }
    }
  })
})
