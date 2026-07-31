import { stripAssetData } from '../../package/serialize'
import { bookProjectSchema, type BookProject } from '../../schema/bookPackage'

export interface StoredProjectRecord {
  json: string
  files: Record<string, string>
}

export function encodeProject(project: BookProject): StoredProjectRecord {
  return {
    json: JSON.stringify(stripAssetData(project)),
    files: Object.fromEntries(project.assets.map((asset) => [asset.id, asset.data])),
  }
}

export function decodeProject(record: StoredProjectRecord): BookProject | null {
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
    .filter((asset) => record.files[asset.id] !== undefined)
    .map((asset) => ({ ...asset, data: record.files[asset.id] }))
  return { ...file, assets }
}

