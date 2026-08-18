import { stripAssetData } from '../../package/serialize'
import type { AssetData } from '../../schema/assets'
import { bookProjectSchema, type BookProject } from '../../schema/bookPackage'

export interface StoredProjectRecord {
  json: string
  /** IndexedDB v1との互換用。v2では素材ストアへ分離する。 */
  files?: Record<string, AssetData>
}

export function encodeProject(project: BookProject): StoredProjectRecord {
  return {
    json: JSON.stringify(stripAssetData(project)),
    files: Object.fromEntries(project.assets.map((asset) => [asset.id, asset.data])),
  }
}

export function decodeProject(
  record: StoredProjectRecord,
  separatedFiles: Record<string, AssetData> = record.files ?? {},
): BookProject | null {
  let raw: unknown
  try {
    raw = JSON.parse(record.json)
  } catch {
    return null
  }
  const parsed = bookProjectSchema.safeParse(raw)
  if (!parsed.success) return null
  const file = parsed.data
  const assets = file.assets
    .filter((asset) => separatedFiles[asset.id] !== undefined)
    .map((asset) => ({ ...asset, data: separatedFiles[asset.id] }))
  return { ...file, assets }
}
