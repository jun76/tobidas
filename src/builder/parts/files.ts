import { importPartFiles, importPartZip, exportPartZip, partBundleFiles } from '../../parts/package'
import type { PartBundle } from '../../parts/schema'
import { saveBlobAs, safeFileName, type PickerWindow } from '../io/browserFiles'
import { registerLibraryPart } from './repository'
import { usePartEditorStore } from './store'
import { t } from '../i18n'

export async function importPartSelection(files: FileList | File[], open = false): Promise<void> {
  const items = Array.from(files)
  if (!items.length) return
  let bundle: PartBundle
  if (items.length === 1 && items[0].name.endsWith('.zip')) bundle = await importPartZip(await items[0].arrayBuffer())
  else {
    const manifest = items.find((file) => file.name === 'part.json')
    if (!manifest) throw new Error('part.json is missing')
    const relative = manifest.webkitRelativePath || manifest.name, prefix = relative.slice(0, -'part.json'.length)
    const entries = await Promise.all(items.map(async (file): Promise<[string, Uint8Array]> => [
      (file.webkitRelativePath || file.name).slice(prefix.length), new Uint8Array(await file.arrayBuffer()),
    ]))
    bundle = await importPartFiles(new Map(entries))
  }
  const entry = await registerLibraryPart(bundle)
  await usePartEditorStore.getState().refreshLibrary()
  if (open) usePartEditorStore.getState().open(entry.bundle)
}
export async function savePartZipFile(bundle: PartBundle): Promise<void> {
  await saveBlobAs(await exportPartZip(bundle), `${safeFileName(bundle.definition.name)}.tobidas-part.zip`, t().parts.custom)
}
export async function savePartFolder(bundle: PartBundle): Promise<void> {
  const picker = (window as PickerWindow).showDirectoryPicker
  if (!picker) { await savePartZipFile(bundle); return }
  const directory = await picker({ mode: 'readwrite' })
  for (const [path, bytes] of await partBundleFiles(bundle)) {
    const segments = path.split('/'), name = segments.pop()!
    let parent = directory
    for (const segment of segments) parent = await parent.getDirectoryHandle(segment, { create: true })
    const handle = await parent.getFileHandle(name, { create: true }), writable = await handle.createWritable()
    await writable.write(Uint8Array.from(bytes)); await writable.close()
  }
}
