import { t } from '../i18n'
import { assemblePackage, type AssembleProgress } from '../../package/assemble'
import { normalizeAssetPath, type AssembleResult, type AssetSource } from '../../package/model'
import { validateBookProject } from '../../schema/bookValidate'
import { seedSpreadInspection, validateBookParts } from '../../parts/book'
import type { SpreadInspectionRequest } from './spreadInspectionWorker'
import type { BookProject } from '../../schema/bookPackage'
import type { PickerWindow } from './browserFiles'
import { readMediaMetadata } from '../assets/ingest'
import { readProjectArchive } from './projectArchive'

/** 読み込みの段階を画面へ伝える。実体の展開は素材ごとに進み、その後に検証が続く。 */
export type ImportProgress = AssembleProgress

export async function importProjectZip(file: File): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error(t().io.packageTooLarge)
  // ZIP は Worker で一括展開するので、段階の通知はない。
  const result = await readProjectArchive(await file.arrayBuffer())
  await assertStorageCapacity(result.project.assets.reduce((sum, asset) => sum + (asset.bytes ?? 0), 0))
  return result
}

const MAX_IMPORT_BYTES = 512 * 1024 * 1024
const MAX_IMPORT_FILES = 2000

export type ImportResult = AssembleResult

/** ピッカーを持たないブラウザ向けの経路。フォルダ選択の input が渡すファイル一覧から組む */
export async function importPackageFileList(list: FileList | File[], progress?: ImportProgress): Promise<ImportResult> {
  const selected = Array.from(list)
  if (selected.length > MAX_IMPORT_FILES) throw new Error(t().io.tooManyFiles)
  if (selected.reduce((total, file) => total + file.size, 0) > MAX_IMPORT_BYTES) {
    throw new Error(t().io.packageTooLarge)
  }
  await assertStorageCapacity(selected.reduce((total, file) => total + file.size, 0))
  const entries = selected.map((file) => ({
    relativePath: (file.webkitRelativePath || file.name).split('/').slice(1).join('/'),
    file,
  }))
  const projectEntry = entries.find((entry) => entry.relativePath === 'project.json')
  if (!projectEntry) throw new Error(t().io.noProjectJsonFolder)

  const files = new Map<string, AssetSource>()
  for (const { relativePath, file } of entries) {
    if (!relativePath.startsWith('assets/')) continue
    const assetPath = normalizeAssetPath(relativePath.slice('assets/'.length))
    if (files.has(assetPath)) throw new Error(t().io.duplicateAssetPath(assetPath))
    files.set(assetPath, fileAssetSource(file))
  }
  return finishImport(await projectEntry.file.text(), files, progress)
}

interface DirectoryHandleWithEntries extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>
}

export async function importPackageViaDirectoryPicker(progress?: ImportProgress, onChosen?: () => void): Promise<ImportResult | 'aborted' | null> {
  const picker = (window as PickerWindow).showDirectoryPicker
  if (!picker) return null
  try {
    const directory = await picker.call(window, { mode: 'read' })
    onChosen?.()
    return await importPackageDirectory(directory, progress)
  } catch (error) {
    if ((error as DOMException).name === 'AbortError') return 'aborted'
    throw error
  }
}

async function importPackageDirectory(directory: FileSystemDirectoryHandle, progress?: ImportProgress): Promise<ImportResult> {
  let projectText: string | null = null
  const files = new Map<string, AssetSource>()
  let totalBytes = 0
  for await (const [name, handle] of (directory as DirectoryHandleWithEntries).entries()) {
    if (handle.kind === 'file' && name === 'project.json') {
      const file = await handle.getFile()
      totalBytes += file.size
      projectText = await file.text()
    } else if (handle.kind === 'directory' && name === 'assets') {
      totalBytes += await collectDirectory(handle, '', files)
    }
  }
  if (projectText === null) throw new Error(t().io.noProjectJsonFolder)
  if (files.size > MAX_IMPORT_FILES) throw new Error(t().io.tooManyFiles)
  if (totalBytes > MAX_IMPORT_BYTES) throw new Error(t().io.packageTooLarge)
  await assertStorageCapacity(totalBytes)
  return finishImport(projectText, files, progress)
}

async function collectDirectory(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  output: Map<string, AssetSource>,
): Promise<number> {
  let bytes = 0
  for await (const [name, handle] of (directory as DirectoryHandleWithEntries).entries()) {
    if (handle.kind === 'file') {
      const file = await handle.getFile()
      const path = normalizeAssetPath(prefix + name)
      if (output.has(path)) throw new Error(t().io.duplicateAssetPath(path))
      output.set(path, fileAssetSource(file))
      bytes += file.size
    } else {
      bytes += await collectDirectory(handle, `${prefix}${name}/`, output)
    }
  }
  return bytes
}

function fileAssetSource(file: File): AssetSource {
  return {
    size: file.size,
    mime: file.type,
    text: () => file.text(),
    // base64 化はブラウザ組み込みに任せる。JS で文字列を組むより大きな画像で桁違いに速い。
    dataUrl: (mime) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error ?? new Error('Could not read the asset'))
      reader.readAsDataURL(new Blob([file], { type: mime }))
    }),
    blob: async (mime) => new Blob([file], { type: mime }),
    metadata: (type, data) => readMediaMetadata(file, type, data),
  }
}

async function assertStorageCapacity(bytes: number): Promise<void> {
  let estimate: StorageEstimate | undefined
  try {
    estimate = await navigator.storage?.estimate?.()
  } catch {
    return
  }
  if (!estimate?.quota) return
  const available = estimate.quota - (estimate.usage ?? 0)
  // IndexedDBの管理領域とundo用の複製を見込み、素材実体の1.2倍を確保する。
  if (available < bytes * 1.2) throw new Error(t().io.storageTooSmall)
}

async function finishImport(projectJsonText: string, files: Map<string, AssetSource>, progress?: ImportProgress): Promise<ImportResult> {
  const result = await assemblePackage(projectJsonText, files, progress)
  await inspectSpreads(result.project, progress)
  const validation = validateBookProject(result.project)
  if (!validation.ok) throw new Error(t().io.validationFailed(validation.errors.slice(0, 8).join('\n')))
  return result
}


/**
 * 紙の検査は見開きごとに 1〜2 秒かかる。Worker があれば数見開きを並列に検査して結果を検査キャッシュへ入れ、
 * 続く全体検証では同じ設計内容の再計算を省く。Worker がなければ見開きごとに区切って描画を挟む。
 */
async function inspectSpreads(project: BookProject, progress?: ImportProgress): Promise<void> {
  const { spreads } = project.book
  await progress?.('validating', 0, spreads.length)
  if (typeof Worker === 'undefined') {
    for (const [index, spread] of spreads.entries()) {
      validateBookParts({ ...project, book: { ...project.book, spreads: [spread] } })
      await progress?.('validating', index + 1, spreads.length)
    }
    return
  }
  // 素材の実体は検査に要らない。ID と種類だけを渡して転送を軽くする。
  const light = { ...project, assets: project.assets.map(({ data: _data, ...meta }) => meta) } as unknown as BookProject
  let done = 0, next = 0
  const lanes = Math.max(1, Math.min(6, (navigator.hardwareConcurrency ?? 2) - 1, spreads.length))
  // Worker の起動とモジュール読み込みは見開き 1 つ分の検査に匹敵する。レーンごとに 1 つを使い回す。
  const inspectWith = (worker: Worker, index: number) => new Promise<string[]>((resolve, reject) => {
    worker.onmessage = ({ data }) => { if (data.ok) resolve(data.errors as string[]); else reject(new Error(data.message)) }
    worker.onerror = (event) => reject(new Error(event.message))
    worker.postMessage({ project: light, index } satisfies SpreadInspectionRequest)
  })
  await Promise.all(Array.from({ length: lanes }, async () => {
    const worker = new Worker(new URL('./spreadInspectionWorker.ts', import.meta.url), { type: 'module' })
    try {
      while (next < spreads.length) {
        const index = next++
        seedSpreadInspection(project, spreads[index], await inspectWith(worker, index))
        await progress?.('validating', ++done, spreads.length)
      }
    } finally { worker.terminate() }
  }))
}
