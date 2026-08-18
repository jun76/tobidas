import { VIDEO_BYTE_LIMIT, type Asset, type AssetData, type AssetMeta } from '../schema/assets'
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
    if (meta.type === 'video') assertVideoDeclaration(meta.id, meta.mime, source.mime)
    const data = await readAsset(source, meta.type, meta.mime)
    assertAssetSize(meta.id, meta.type, data, source.size)
    const inferred = await source.metadata?.(meta.type, data)
    assets.push({ ...inferred, ...meta, bytes: meta.bytes ?? source.size, data })
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
    const data = await readAsset(source, kind.type, kind.mime)
    assertAssetSize(relativePath, kind.type, data, source.size)
    const inferred = await source.metadata?.(kind.type, data)
    assets.push({
      ...inferred,
      id: relativePath,
      name: base.replace(/\.[^.]+$/, ''),
      type: kind.type,
      mime: kind.mime,
      bytes: source.size,
      data,
    })
  }

  return { project: { ...file, assets }, notices }
}

async function readAsset(source: AssetSource, type: AssetMeta['type'], mime: string): Promise<AssetData> {
  if (type === 'svg') return source.text()
  if (type === 'video') return source.blob(mime)
  return source.dataUrl(mime)
}

function assertAssetSize(id: string, type: AssetMeta['type'], data: AssetData, sourceSize?: number): void {
  if (type !== 'video') return
  const bytes = sourceSize ?? (data instanceof Blob ? data.size : 0)
  if (bytes > VIDEO_BYTE_LIMIT) {
    throw new Error(`video asset exceeds 100 MiB: assets/${id}`)
  }
}

function assertVideoDeclaration(id: string, declaredMime: string, actualMime?: string): void {
  const kind = assetKindForFile(id)
  if (kind?.type !== 'video' || kind.mime !== declaredMime) {
    throw new Error(`video declaration does not match its file extension: assets/${id}`)
  }
  if (actualMime && actualMime !== 'application/octet-stream' && actualMime !== declaredMime) {
    throw new Error(`video MIME does not match project.json: assets/${id}`)
  }
}
