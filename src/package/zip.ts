import JSZip from 'jszip'
import type { BookProject } from '../schema/bookPackage'
import { validateBookProject } from '../schema/bookValidate'
import { assetDataToBytes, bytesToDataUrl, projectFileJson } from './serialize'
import { assemblePackage } from './assemble'
import { normalizeAssetPath, type AssetSource } from './model'

/** 編集用フォルダーと同じファイルだけをZIPへ束ねる。別の作品スキーマは設けない。 */
export async function buildProjectZip(project: BookProject): Promise<Uint8Array> {
  const validation = validateBookProject(project)
  if (!validation.ok) throw new Error(validation.errors.join('\n'))
  const zip = new JSZip(); zip.file('project.json', projectFileJson(project))
  for (const asset of project.assets) {
    const bytes = assetDataToBytes(asset), path = 'assets/' + normalizeAssetPath(asset.id)
    if ('text' in bytes) zip.file(path, bytes.text)
    else if ('blob' in bytes) zip.file(path, await bytes.blob.arrayBuffer(), { compression: 'STORE' })
    else zip.file(path, bytes.base64, { base64: true, compression: 'STORE' })
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
export async function readProjectZip(bytes: Uint8Array | ArrayBuffer) {
  const zip = await JSZip.loadAsync(bytes), entries = Object.values(zip.files).filter((entry) => !entry.dir)
  if (entries.length > 2000) throw new Error('Project archive has too many files')
  const files = new Map<string, AssetSource>(); let text: string | undefined, total = 0
  for (const entry of entries) {
    const original = (entry as typeof entry & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name
    if (normalizeAssetPath(original) !== entry.name || /^[a-zA-Z]:/.test(original)) throw new Error('Invalid project archive path')
    if (entry.name !== 'project.json' && !entry.name.startsWith('assets/')) continue
    const data = await entry.async('uint8array'); total += data.byteLength
    if (total > 512 * 1024 * 1024) throw new Error('Project archive exceeds 512 MiB')
    if (entry.name === 'project.json') text = new TextDecoder().decode(data)
    else files.set(entry.name.slice(7), { size: data.byteLength, text: async () => new TextDecoder().decode(data),
      dataUrl: async (mime) => bytesToDataUrl(data.slice().buffer, mime), blob: async (mime) => new Blob([data.slice().buffer], { type: mime }) })
  }
  if (!text) throw new Error('Project archive has no project.json')
  const result = await assemblePackage(text, files), validation = validateBookProject(result.project)
  if (!validation.ok) throw new Error(validation.errors.join('\n'))
  return result
}
