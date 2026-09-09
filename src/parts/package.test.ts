import { describe, expect, it } from 'vitest'
import { newPartDefinition, type PartBundle } from './schema'
import { definitionHash, importPartFiles, partBundleFiles, snapshotPartBundle } from './package'
import { syncDefinitionRequirements, validatePartDefinition } from './validate'
import { createBookProject } from '../schema/bookDefaults'
import { assemblePackage } from '../package/assemble'
import { projectFileJson } from '../package/serialize'
import { describePartEdit, evaluateEditScene, planPartEdit, type PartEditScene } from './edit'
import { pagePorts } from './geometry'

async function example(): Promise<PartBundle> {
  const child = newPartDefinition('Child', { kind: 'fold-pair', maxOpeningAngleDeg: 90 })
  child.materialSlots.paper = { image: 'flower.svg' }
  child.nodes.push({ id: 'person', name: 'Person', definition: { builtin: 'upright', version: 1 }, mount: { type: 'input' }, parameters: {}, materials: { panel: { slot: 'paper' } } })
  syncDefinitionRequirements(child)
  const hash = await definitionHash(child), definition = newPartDefinition('Garden')
  definition.nodes.push(
    { id: 'background', name: 'Background', definition: { builtin: 'backdrop', version: 1 }, mount: { type: 'input' }, parameters: {}, materials: {} },
    { id: 'child', name: 'Child', definition: { custom: hash }, mount: { type: 'output', nodeId: 'background', portId: 'ground-backdrop' }, parameters: {}, materials: {} },
  )
  syncDefinitionRequirements(definition)
  return { definition, definitions: { [hash]: child }, assets: [{ id: 'flower.svg', name: 'flower', type: 'svg', mime: 'image/svg+xml', width: 1, height: 1, data: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' }] }
}
describe('portable part definitions', () => {
  it('入れ子の角度ハンドルと倍率を交換し、内部の実回転軸へ解決する', async () => {
    const inner = newPartDefinition('傾く小物', { kind: 'fold-pair', maxOpeningAngleDeg: 90 })
    inner.parameters.lean = { type: 'angle', label: '傾き', default: 90, min: 30, max: 150 }
    inner.nodes = [{ id: 'panel', name: '小物', definition: { builtin: 'upright', version: 1 }, mount: { type: 'input' },
      parameters: { width: 1, height: 1, supportHeight: .6, distance: 1, tiltAngle: { parameter: 'lean' } }, materials: {} }]
    inner.editHandles = [{ id: 'leaning', kind: 'angle', parameter: 'lean', nodeId: 'panel', operation: 'tiltAngle', label: '傾き' }]
    const child = await snapshotPartBundle({ definition: inner, definitions: {}, assets: [] })
    const outer = newPartDefinition('入れ子', inner.input)
    outer.parameters.angle = inner.parameters.lean
    outer.nodes = [{ id: 'child', name: '中の小物', definition: { custom: child.hash }, mount: { type: 'input' },
      uniformScale: .5, parameters: { lean: { parameter: 'angle' } }, materials: {} }]
    outer.editHandles = [{ id: 'nested-angle', kind: 'angle', parameter: 'angle', nodeId: 'child', operation: 'leaning', label: '傾き' }]
    const frozen = await snapshotPartBundle({ definition: outer, definitions: { [child.hash]: child.definition }, assets: [] })
    const restored = await importPartFiles(await partBundleFiles(frozen))
    expect(restored.definition.editHandles).toEqual(outer.editHandles)
    const scene: PartEditScene = { maxAngle: 60, definitions: { ...restored.definitions, [frozen.hash]: restored.definition },
      nodes: [{ id: 'placed', name: '配置', definition: { custom: frozen.hash }, mount: { type: 'input' }, uniformScale: 1.5, parameters: {}, materials: {} }],
      at: (angle) => ({ input: pagePorts(20, 20, angle * Math.PI / 180, 0).gutter }) }
    const description = describePartEdit(scene, 'placed')
    expect(description.angles[0].value).toBeCloseTo(60)
    const panel = evaluateEditScene(scene).faces.find((face) => face.id.endsWith('/panel/panel'))!
    expect(description.angles[0].pivot!.distanceTo(panel.origin.clone().addScaledVector(panel.u, panel.width / 2))).toBeLessThan(1e-7)
    const plan = planPartEdit(scene, 'placed', { type: 'rotate', handle: 'nested-angle', value: 75 })
    expect(plan.ok, plan.ok ? '' : plan.detail).toBe(true)
    if (plan.ok) {
      const edited = evaluateEditScene(scene, plan.nodes).faces.find((face) => face.id === panel.id)!
      expect(edited.width).toBeCloseTo(.75)
      expect(edited.v.y).toBeCloseTo(Math.sin(75 * Math.PI / 180))
    }
    expect(restored.definition).toEqual(frozen.definition)
    // 複数改訂のハッシュ計算を待つため、全体テストのワーカー競合に余裕を持たせる。
  }, 15000)
  it('round trips nested parts and assets without the original library', async () => {
    const source = await example(), frozen = await snapshotPartBundle(source)
    const imported = await importPartFiles(await partBundleFiles(frozen))
    expect(imported.definition).toEqual(frozen.definition)
    expect(imported.definitions).toEqual(frozen.definitions)
    expect(imported.assets).toEqual(frozen.assets)
    expect(validatePartDefinition(imported.definition, imported.definitions).errors).toEqual([])
    expect(await definitionHash(imported.definition)).toBe(frozen.hash)
    source.definition.name = 'Changed original'
    expect(imported.definition.name).toBe('Garden')
  })
  it('detects tampered dependencies, missing assets and traversal paths', async () => {
    const files = await partBundleFiles(await example())
    const dependencyPath = [...files.keys()].find((path) => path.startsWith('definitions/'))!
    const damaged = new Map(files), body = JSON.parse(new TextDecoder().decode(files.get(dependencyPath)))
    body.name = 'Tampered'; damaged.set(dependencyPath, new TextEncoder().encode(JSON.stringify(body)))
    await expect(importPartFiles(damaged)).rejects.toThrow('hash mismatch')
    const missing = new Map(files)
    missing.delete([...files.keys()].find((path) => path.startsWith('assets/'))!)
    await expect(importPartFiles(missing)).rejects.toThrow('Asset hash mismatch')
    await expect(importPartFiles(new Map([...files, ['../part.json', new Uint8Array()]]))).rejects.toThrow('Invalid part path')
  })
  it('preserves unknown builtin versions for inspection but does not mark them placeable', async () => {
    const source = await example()
    source.definition.nodes = [{ id: 'future', name: 'Future', definition: { builtin: 'future-fold', version: 7 }, mount: { type: 'input' }, parameters: {}, materials: {} }]
    syncDefinitionRequirements(source.definition)
    const restored = await importPartFiles(await partBundleFiles(source))
    expect(restored.definition.nodes[0].definition).toEqual({ builtin: 'future-fold', version: 7 })
    expect(validatePartDefinition(restored.definition).ok).toBe(false)
  })
  it('絵本の再読み込みでも、同梱した改訂と素材の変更を検出する', async () => {
    const snapshot = await snapshotPartBundle(await example()), project = createBookProject('同梱部品の検査')
    project.partDefinitions = { ...snapshot.definitions, [snapshot.hash]: snapshot.definition }; project.assets = snapshot.assets
    const files = new Map(project.assets.map((asset) => [asset.id, {
      text: async () => String(asset.data), dataUrl: async () => String(asset.data), blob: async () => new Blob([asset.data]),
    }]))
    expect((await assemblePackage(projectFileJson(project), files)).project.partDefinitions).toEqual(project.partDefinitions)
    const changed = structuredClone(project)
    changed.partDefinitions![snapshot.hash].name = '内容を変更'
    await expect(assemblePackage(projectFileJson(changed), files)).rejects.toThrow('definition hash mismatch')
    const assetId = snapshot.assets[0].id
    files.set(assetId, { text: async () => '<svg/>', dataUrl: async () => '', blob: async () => new Blob() })
    await expect(assemblePackage(projectFileJson(project), files)).rejects.toThrow('asset hash or size mismatch')
  })
})
