import type { Asset, AssetMeta } from '../schema/assets'
import { bookProjectSchema } from '../schema/bookPackage'
import { assetKindForFile, normalizeAssetPath, type AssembleResult, type AssetSource } from './model'

export async function assemblePackage(
  projectJsonText: string,
  files: Map<string, AssetSource>,
): Promise<AssembleResult> {
  const normalizedFiles = new Map<string, AssetSource>()
  for (const [path, source] of files) {
    const normalized = normalizeAssetPath(path)
    if (normalizedFiles.has(normalized)) throw new Error(`duplicate asset path: assets/${normalized}`)
    normalizedFiles.set(normalized, source)
  }
  let raw: unknown
  try {
    raw = JSON.parse(projectJsonText)
  } catch (error) {
    throw new Error(`project.json is not valid JSON: ${String(error)}`)
  }
  const parsed = bookProjectSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 5).map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
    throw new Error('project.json failed validation:\n' + issues.join('\n'))
  }

  const file = parsed.data
  const notices: string[] = []
  const missing: string[] = []
  const assets: Asset[] = []
  for (const meta of file.assets) {
    const source = normalizedFiles.get(normalizeAssetPath(meta.id))
    if (!source) {
      missing.push(meta.id)
      continue
    }
    assets.push({ ...meta, data: await readAsset(source, meta.type, meta.mime) })
  }
  if (missing.length) {
    throw new Error('declared assets are missing from assets/:\n'
      + missing.map((id) => `  assets/${id}`).join('\n'))
  }

  const declared = new Set(file.assets.map((asset) => asset.id))
  for (const [relativePath, source] of normalizedFiles) {
    if (declared.has(relativePath)) continue
    const kind = assetKindForFile(relativePath)
    if (!kind) {
      notices.push(`ignored, unsupported format: assets/${relativePath}`)
      continue
    }
    const base = relativePath.split('/').pop() ?? relativePath
    assets.push({
      id: relativePath,
      name: base.replace(/\.[^.]+$/, ''),
      type: kind.type,
      mime: kind.mime,
      data: await readAsset(source, kind.type, kind.mime),
    })
  }

  return { project: { ...file, assets }, notices }
}

async function readAsset(source: AssetSource, type: AssetMeta['type'], mime: string): Promise<string> {
  return type === 'svg' ? source.text() : source.dataUrl(mime)
}
