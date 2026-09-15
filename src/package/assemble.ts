import { VIDEO_BYTE_LIMIT, type Asset, type AssetData, type AssetMeta } from '../schema/assets'
import { bookProjectSchema } from '../schema/bookPackage'
import { assetKindForFile, normalizeAssetPath, type AssembleResult, type AssetSource } from './model'
import { verifyEmbeddedParts } from '../parts/package'

/** 段階の通知。検証は同期で長いので、呼び手が描画を挟めるよう待てるようにしておく。 */
export type AssembleProgress = (stage: 'assets' | 'validating', done: number, total: number) => void | Promise<void>

export async function assemblePackage(
  projectJsonText: string,
  files: Map<string, AssetSource>,
  progress?: AssembleProgress,
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
  const total = file.assets.length + Math.max(0, normalizedFiles.size - file.assets.length)
  let done = 0
  // 実体の読み取りはブラウザ側で待つだけなので、数本まとめて進める。順序は宣言どおりに保つ。
  const loaded = await mapConcurrently(file.assets, 4, async (meta): Promise<Asset | undefined> => {
    const source = normalizedFiles.get(normalizeAssetPath(meta.id))
    if (!source) {
      missing.push(meta.id)
      return undefined
    }
    if (meta.type === 'video') assertVideoDeclaration(meta.id, meta.mime, source.mime)
    const data = await readAsset(source, meta.type, meta.mime)
    assertAssetSize(meta.id, meta.type, data, source.size)
    // 寸法や長さが project.json にある素材は復号して測り直さない。動画だけは再生できるかを毎回確かめる。
    const declared = meta.type === 'audio' ? meta.duration !== undefined
      : meta.type === 'video' ? false : meta.width !== undefined && meta.height !== undefined
    const inferred = declared ? undefined : await source.metadata?.(meta.type, data)
    await progress?.('assets', ++done, total)
    return { ...inferred, ...meta, bytes: meta.bytes ?? source.size, data }
  })
  assets.push(...loaded.filter((asset): asset is Asset => asset !== undefined))
  if (missing.length) {
    throw new Error('declared assets are missing from assets/:\n'
      + missing.map((id) => `  assets/${id}`).join('\n'))
  }

  const declaredIds = new Set(file.assets.map((asset) => asset.id))
  const extras = [...normalizedFiles].filter(([relativePath]) => !declaredIds.has(relativePath))
  const extraAssets = await mapConcurrently(extras, 4, async ([relativePath, source]): Promise<Asset | undefined> => {
    const kind = assetKindForFile(relativePath)
    if (!kind) {
      notices.push(`ignored, unsupported format: assets/${relativePath}`)
      return undefined
    }
    const base = relativePath.split('/').pop() ?? relativePath
    const data = await readAsset(source, kind.type, kind.mime)
    assertAssetSize(relativePath, kind.type, data, source.size)
    const inferred = await source.metadata?.(kind.type, data)
    await progress?.('assets', ++done, total)
    return {
      ...inferred,
      id: relativePath,
      name: base.replace(/\.[^.]+$/, ''),
      type: kind.type,
      mime: kind.mime,
      bytes: source.size,
      data,
    }
  })
  assets.push(...extraAssets.filter((asset): asset is Asset => asset !== undefined))

  await progress?.('validating', 0, 0)
  await verifyEmbeddedParts(file.partDefinitions ?? {}, assets)
  return { project: { ...file, assets }, notices }
}

async function mapConcurrently<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await work(items[index]) }
  })
  await Promise.all(workers)
  return results
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
