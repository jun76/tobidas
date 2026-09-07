import { describe, expect, it } from 'vitest'
import { newPartDefinition, type PartBundle } from './schema'
import { definitionHash, importPartFiles, partBundleFiles, snapshotPartBundle } from './package'
import { syncDefinitionRequirements, validatePartDefinition } from './validate'

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
})
