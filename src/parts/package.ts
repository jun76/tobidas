import JSZip from 'jszip'
import type { Asset } from '../schema/assets'
import { bytesToDataUrl } from '../package/serialize'
import { partDefinitionSchema, type PartBundle, type PartDefinition, type PartDefinitions, type PartMaterial } from './schema'
import { syncDefinitionRequirements } from './validate'

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  return JSON.stringify(value)
}
export async function contentHash(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : Uint8Array.from(value)
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((n) => n.toString(16).padStart(2, '0')).join('')
}
export const definitionHash = (definition: PartDefinition) => contentHash(canonicalJson(definition))

/** 絵本へ同梱された改訂も、部品ファイルと同じ内容ハッシュで照合する。 */
export async function verifyEmbeddedParts(definitions: PartDefinitions, assets: Asset[]): Promise<void> {
  const byId = new Map(assets.map((asset) => [asset.id, asset])), checkedAssets = new Map<string, { hash: string; bytes: number }>()
  for (const [hash, definition] of Object.entries(definitions)) {
    if (await definitionHash(definition) !== hash) throw new Error(`Part definition hash mismatch: ${hash}`)
    for (const dependency of definition.dependencies) if (!definitions[dependency]) throw new Error(`Missing part dependency: ${dependency}`)
    for (const node of definition.nodes) if ('custom' in node.definition && !definition.dependencies.includes(node.definition.custom)) throw new Error('Undeclared custom dependency')
    for (const meta of definition.assets) {
      const asset = byId.get(meta.id)
      if (!asset || asset.type !== meta.type || asset.mime !== meta.mime) throw new Error(`Missing or mismatched part asset: ${meta.id}`)
      let checked = checkedAssets.get(meta.id)
      if (!checked) {
        const bytes = await assetBytes(asset)
        checked = { hash: await contentHash(bytes), bytes: bytes.length }; checkedAssets.set(meta.id, checked)
      }
      if (checked.hash !== meta.hash || checked.bytes !== meta.bytes) throw new Error(`Part asset hash or size mismatch: ${meta.id}`)
    }
    for (const id of materialAssetIds(definition)) if (!definition.assets.some((asset) => asset.id === id)) throw new Error(`Undeclared part asset: ${id}`)
  }
}

export async function assetBytes(asset: Asset): Promise<Uint8Array> {
  if (asset.data instanceof Blob) return new Uint8Array(await asset.data.arrayBuffer())
  if (asset.type === 'svg') return new TextEncoder().encode(asset.data)
  const match = /^data:[^,]*;base64,(.*)$/s.exec(asset.data)
  if (!match) throw new Error(`Part asset body is missing: ${asset.id}`)
  return Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0))
}
function materialAssetIds(definition: PartDefinition): Set<string> {
  const ids = new Set<string>()
  const add = (material: PartMaterial) => { if (material.image) ids.add(material.image); if (material.backImage) ids.add(material.backImage) }
  Object.values(definition.materialSlots).forEach(add)
  for (const node of definition.nodes) for (const material of Object.values(node.materials)) if (!('slot' in material)) add(material)
  for (const { element, tracks } of definition.contents ?? []) {
    if (element.type === 'visual') { if (element.image) ids.add(element.image); if (element.backImage) ids.add(element.backImage) }
    for (const track of tracks) if (track.property === 'visual.image') for (const key of track.keys) if (typeof key.value === 'string') ids.add(key.value)
  }
  return ids
}
function remapMaterials(definition: PartDefinition, aliases: Map<string, string>): void {
  const remap = (material: PartMaterial) => {
    if (material.image) material.image = aliases.get(material.image) ?? material.image
    if (material.backImage) material.backImage = aliases.get(material.backImage) ?? material.backImage
  }
  for (const { element, tracks } of definition.contents ?? []) {
    if (element.type === 'visual') { if (element.image) element.image = aliases.get(element.image) ?? element.image; if (element.backImage) element.backImage = aliases.get(element.backImage) ?? element.backImage }
    for (const track of tracks) if (track.property === 'visual.image') for (const key of track.keys) if (typeof key.value === 'string') key.value = aliases.get(key.value) ?? key.value
  }
  Object.values(definition.materialSlots).forEach(remap)
  for (const node of definition.nodes) Object.values(node.materials).forEach((material) => { if (!('slot' in material)) remap(material) })
}

/** 素材名と依存参照を内容ハッシュへ固定し、他の作品へ独立して持ち運べる形にする。 */
export async function snapshotPartBundle(source: PartBundle): Promise<PartBundle & { hash: string }> {
  const aliases = new Map<string, string>(), assets = new Map<string, Asset>(), hashes = new Map<string, string>()
  // 作品全体から渡された素材のうち、この部品と依存部品が実際に使うものだけを同梱する。
  const neededAssets = new Set<string>(), visited = new Set<PartDefinition>()
  const collect = (definition: PartDefinition) => {
    if (visited.has(definition)) return
    visited.add(definition)
    materialAssetIds(definition).forEach((id) => neededAssets.add(id))
    for (const node of definition.nodes) if ('custom' in node.definition) {
      const dependency = source.definitions[node.definition.custom]
      if (!dependency) throw new Error(`Missing dependency: ${node.definition.custom}`)
      collect(dependency)
    }
  }
  collect(source.definition)
  let totalBytes = 0
  for (const asset of source.assets.filter((asset) => neededAssets.has(asset.id))) {
    if (!['image', 'svg', 'video'].includes(asset.type)) throw new Error('Part contents support image, SVG and video assets')
    const bytes = await assetBytes(asset), hash = await contentHash(bytes)
    const extension = asset.type === 'video' ? asset.mime === 'video/webm' ? 'webm' : 'mp4' : asset.type === 'svg' ? 'svg' : asset.mime === 'image/webp' ? 'webp' : asset.mime === 'image/jpeg' ? 'jpg' : 'png'
    const id = `part-${hash}.${extension}`
    if (aliases.has(asset.id) && aliases.get(asset.id) !== id) throw new Error(`Conflicting asset id: ${asset.id}`)
    aliases.set(asset.id, id); hashes.set(id, hash)
    if (!assets.has(id)) totalBytes += bytes.length
    assets.set(id, { ...asset, id, bytes: bytes.length })
  }
  if (totalBytes >= 12 * 1024 * 1024) throw new Error('Part assets must total less than 12MB')
  const definitions: PartDefinitions = {}, remapped = new Map<string, string>(), visiting = new Set<string>()
  const normalize = async (original: PartDefinition): Promise<PartDefinition> => {
    const definition = structuredClone(original)
    remapMaterials(definition, aliases)
    for (const node of definition.nodes) if ('custom' in node.definition) {
      const oldHash = node.definition.custom
      if (visiting.has(oldHash)) throw new Error('Cyclic part dependencies')
      if (!remapped.has(oldHash)) {
        const dependency = source.definitions[oldHash]
        if (!dependency) throw new Error(`Missing dependency: ${oldHash}`)
        visiting.add(oldHash)
        const normalized = await normalize(dependency), hash = await definitionHash(normalized)
        visiting.delete(oldHash); definitions[hash] = normalized; remapped.set(oldHash, hash)
      }
      node.definition.custom = remapped.get(oldHash)!
    }
    syncDefinitionRequirements(definition)
    definition.assets = [...materialAssetIds(definition)].map((id) => {
      const asset = assets.get(id)
      if (!asset) throw new Error(`Missing part asset: ${id}`)
      const { data: _data, ...meta } = asset
      return { ...meta, hash: hashes.get(id)! }
    })
    return partDefinitionSchema.parse(definition)
  }
  const definition = await normalize(source.definition)
  const used = new Set([definition, ...Object.values(definitions)].flatMap((item) => item.assets.map((asset) => asset.id)))
  return { definition, definitions, assets: [...assets.values()].filter((asset) => used.has(asset.id)), hash: await definitionHash(definition) }
}

export async function partBundleFiles(bundle: PartBundle): Promise<Map<string, Uint8Array>> {
  const snapshot = await snapshotPartBundle(bundle), encoder = new TextEncoder()
  const files = new Map<string, Uint8Array>([['part.json', encoder.encode(JSON.stringify(snapshot.definition, null, 2))]])
  for (const [hash, definition] of Object.entries(snapshot.definitions)) files.set(`definitions/${hash}.json`, encoder.encode(JSON.stringify(definition, null, 2)))
  for (const asset of snapshot.assets) files.set(`assets/${asset.id}`, await assetBytes(asset))
  return files
}
export async function exportPartZip(bundle: PartBundle): Promise<Blob> {
  const zip = new JSZip()
  for (const [path, bytes] of await partBundleFiles(bundle)) zip.file(path, bytes)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}
function checkedPath(path: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((segment) => ['..', '.'].includes(segment)) || path.includes(':')) throw new Error(`Invalid part path: ${path}`)
  return path
}
export async function importPartFiles(files: Map<string, Uint8Array>): Promise<PartBundle> {
  if (files.size > 1024 || [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0) > 24 * 1024 * 1024) throw new Error('Part package is too large')
  const decoder = new TextDecoder()
  for (const path of files.keys()) checkedPath(path)
  if (!files.has('part.json')) throw new Error('part.json is missing')
  const parse = (path: string) => partDefinitionSchema.parse(JSON.parse(decoder.decode(files.get(path)!)))
  const definition = parse('part.json'), definitions: PartDefinitions = {}, assets = new Map<string, Asset>(), visiting = new Set<string>(), read = new Set<string>()
  const inspect = async (def: PartDefinition): Promise<void> => {
    for (const hash of def.dependencies) {
      if (visiting.has(hash)) throw new Error('Cyclic part dependencies')
      if (read.has(hash)) continue
      const path = `definitions/${hash}.json`
      if (!files.has(path)) throw new Error(`Missing dependency: ${hash}`)
      const child = parse(path)
      if (await definitionHash(child) !== hash) throw new Error(`Dependency hash mismatch: ${hash}`)
      visiting.add(hash); definitions[hash] = child; await inspect(child); visiting.delete(hash); read.add(hash)
    }
    for (const node of def.nodes) if ('custom' in node.definition && !def.dependencies.includes(node.definition.custom)) throw new Error('Undeclared custom dependency')
    for (const meta of def.assets) {
      const bytes = files.get(checkedPath(`assets/${meta.id}`))
      if (!bytes || await contentHash(bytes) !== meta.hash) throw new Error(`Asset hash mismatch: ${meta.id}`)
      if (!['image', 'svg', 'video'].includes(meta.type)) throw new Error('Unsupported part asset type')
      const existing = assets.get(meta.id)
      if (existing && await contentHash(await assetBytes(existing)) !== meta.hash) throw new Error(`Asset id conflict: ${meta.id}`)
      const { hash: _hash, ...assetMeta } = meta
      if (meta.bytes !== bytes.length) throw new Error(`Asset size mismatch: ${meta.id}`)
      assets.set(meta.id, { ...assetMeta, bytes: bytes.length, data: meta.type === 'svg' ? decoder.decode(bytes) : bytesToDataUrl(Uint8Array.from(bytes).buffer, meta.mime) })
    }
    for (const id of materialAssetIds(def)) if (!def.assets.some((asset) => asset.id === id)) throw new Error(`Undeclared asset: ${id}`)
  }
  await inspect(definition)
  if ([...assets.values()].reduce((sum, asset) => sum + (asset.bytes ?? 0), 0) >= 12 * 1024 * 1024) throw new Error('Part assets must total less than 12MB')
  return { definition, definitions, assets: [...assets.values()] }
}
export async function importPartZip(bytes: ArrayBuffer): Promise<PartBundle> {
  if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('Part archive is too large')
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true }), files = new Map<string, Uint8Array>()
  let total = 0
  if (Object.keys(zip.files).length > 1024) throw new Error('Part archive has too many files')
  for (const entry of Object.values(zip.files)) {
    checkedPath((entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name)
    if (entry.dir) continue
    const data = await entry.async('uint8array'); total += data.length
    if (total > 24 * 1024 * 1024) throw new Error('Expanded part archive is too large')
    files.set(entry.name, data)
  }
  return importPartFiles(files)
}
