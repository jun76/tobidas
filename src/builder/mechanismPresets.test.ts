import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createBookProject, createStageElement } from '../schema/bookDefaults'
import { makeMechanism } from '../schema/mechanism'
import type { AssemblyElement } from '../schema/stageElement'
import { evaluateAssemblyScene } from '../runtime/mechanisms/scene'
import { buildMechanismComposition } from './mechanismPresets'

function scene(kind: 'house' | 'tree') {
  const project = createBookProject('複合接続')
  const root = createStageElement('assembly') as AssemblyElement
  root.mechanism = makeMechanism('platform', { parameters: { width: 6, height: .25, depth: 4 } })
  const children = buildMechanismComposition(root, { kind, count: 1, spacing: 1 })
  const spread = project.book.spreads[0]
  spread.elements = [root, ...children]
  const result = evaluateAssemblyScene(project.book, spread, { open: 1, leftAngle: Math.PI, rightAngle: 0, spreadTime: 0, clock: 0 })
  const bounds = (role: string) => {
    const box = new THREE.Box3()
    for (const instance of result.surfaces.filter((surface) => surface.elementId === `${root.id}/${role}`)) {
      const positions = instance.surface.positions
      for (let i = 0; i < positions.length; i += 3) box.expandByPoint(new THREE.Vector3(...positions.slice(i, i + 3) as [number, number, number]).applyMatrix4(instance.matrix))
    }
    return box
  }
  return { bounds, result }
}

describe('複合プリセットの全開構図', () => {
  it('屋根の軒は箱の天面上に接続し、棟は上へ伸びる', () => {
    const { bounds, result } = scene('house')
    const body = bounds('house-0'), roof = bounds('roof-0')
    expect(result.diagnostics).toEqual([])
    expect(roof.min.y).toBeCloseTo(body.max.y, 8)
    expect(roof.max.y).toBeGreaterThan(body.max.y)
    expect(roof.getCenter(new THREE.Vector3()).x).toBeCloseTo(body.getCenter(new THREE.Vector3()).x, 8)
  })
  it('樹冠は幹の先端に接続し、幹の法線方向へ寝ない', () => {
    const { bounds, result } = scene('tree')
    const trunk = bounds('trunk-0'), crown = bounds('crown-0')
    expect(result.diagnostics).toEqual([])
    expect(crown.min.y).toBeCloseTo(trunk.max.y, 8)
    expect(crown.max.y).toBeGreaterThan(trunk.max.y + 1)
    expect(crown.max.z - crown.min.z).toBeLessThan(crown.max.y - crown.min.y)
  })
})
