import { t } from '../i18n'
import { assemblePackage } from '../../package/assemble'
import { normalizeAssetPath, type AssembleResult, type AssetSource } from '../../package/model'
import { bytesToDataUrl } from '../../package/serialize'
import { validateBookProject } from '../../schema/bookValidate'
import type { PickerWindow } from './browserFiles'

const MAX_IMPORT_BYTES = 100 * 1024 * 1024
const MAX_IMPORT_FILES = 2000

export type ImportResult = AssembleResult

/** ピッカーを持たないブラウザ向けの経路。フォルダ選択の input が渡すファイル一覧から組む */
export async function importPackageFileList(list: FileList | File[]): Promise<ImportResult> {
  const selected = Array.from(list)
  if (selected.length > MAX_IMPORT_FILES) throw new Error(t().io.tooManyFiles)
  if (selected.reduce((total, file) => total + file.size, 0) > MAX_IMPORT_BYTES) {
    throw new Error(t().io.packageTooLarge)
  }
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
  return finishImport(await projectEntry.file.text(), files)
}

interface DirectoryHandleWithEntries extends FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>
}

export async function importPackageViaDirectoryPicker(): Promise<ImportResult | 'aborted' | null> {
  const picker = (window as PickerWindow).showDirectoryPicker
  if (!picker) return null
  try {
    const directory = await picker.call(window, { mode: 'read' })
    return await importPackageDirectory(directory)
  } catch (error) {
    if ((error as DOMException).name === 'AbortError') return 'aborted'
    throw error
  }
}

async function importPackageDirectory(directory: FileSystemDirectoryHandle): Promise<ImportResult> {
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
  return finishImport(projectText, files)
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
    text: () => file.text(),
    dataUrl: async (mime) => bytesToDataUrl(await file.arrayBuffer(), mime),
  }
}

async function finishImport(projectJsonText: string, files: Map<string, AssetSource>): Promise<ImportResult> {
  const result = await assemblePackage(projectJsonText, files)
  const validation = validateBookProject(result.project)
  if (!validation.ok) throw new Error(t().io.validationFailed(validation.errors.slice(0, 8).join('\n')))
  return result
}

