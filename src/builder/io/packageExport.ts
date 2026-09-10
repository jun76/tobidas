import { assetDataToBytes, projectFileJson } from '../../package/serialize'
import type { BookProject } from '../../schema/bookPackage'
import { base64ToBlob, safeFileName, saveBlobAs, type PickerWindow } from './browserFiles'
import { writeProjectArchive } from './projectArchive'
import { t } from '../i18n'

export async function exportProjectZip(project: BookProject): Promise<void> {
  const bytes = await writeProjectArchive(project)
  await saveBlobAs(new Blob([bytes.slice().buffer], { type: 'application/zip' }), safeFileName(project.name) + '.tobidas.zip', t().toolbar.projectZip)
}

/**
 * 保存先フォルダへ `project.json` + `assets/` を書く。作品はこの一形式だけで、
 * 編集用ZIPも同じ project.json と assets の構造を使う。
 */
export async function exportPackageToDirectory(project: BookProject): Promise<boolean> {
  const picker = (window as PickerWindow).showDirectoryPicker
  if (!picker) return false
  let directory: FileSystemDirectoryHandle
  try {
    directory = await picker.call(window, { mode: 'readwrite' })
  } catch (error) {
    if ((error as DOMException).name === 'AbortError') return true
    throw error
  }
  await writeFile(directory, 'project.json', new Blob([projectFileJson(project)], { type: 'application/json' }))
  const assetsDirectory = await directory.getDirectoryHandle('assets', { create: true })
  for (const asset of project.assets) {
    const bytes = assetDataToBytes(asset)
    const blob = 'text' in bytes
      ? new Blob([bytes.text], { type: asset.mime })
      : 'blob' in bytes
        ? bytes.blob
      : base64ToBlob(bytes.base64, asset.mime)
    await writeFile(assetsDirectory, asset.id, blob)
  }
  return true
}

async function writeFile(directory: FileSystemDirectoryHandle, relativePath: string, blob: Blob): Promise<void> {
  const parts = relativePath.split('/')
  let current = directory
  for (const part of parts.slice(0, -1)) current = await current.getDirectoryHandle(part, { create: true })
  const handle = await current.getFileHandle(parts.at(-1)!, { create: true })
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
}

