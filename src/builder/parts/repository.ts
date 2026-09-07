import type { PartBundle } from '../../parts/schema'
import { definitionHash, snapshotPartBundle } from '../../parts/package'

export interface LibraryPart { hash: string; bundle: PartBundle; savedAt: string }
export interface PartDraft { documentId: string; bundle: PartBundle }
// 絵本のDBと独立させ、画面切り替えや遅延保存で別種の作品を上書きしない。
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tobidas-parts', 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('library'); request.result.createObjectStore('drafts') }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function read<T>(store: string, key?: string): Promise<T> {
  const db = await database()
  try {
    return await new Promise<T>((resolve, reject) => {
      const target = db.transaction(store).objectStore(store), request = key === undefined ? target.getAll() : target.get(key)
      request.onsuccess = () => resolve(request.result as T)
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}
async function write(store: string, entries: [string, unknown][]): Promise<void> {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(store, 'readwrite'), target = transaction.objectStore(store)
      for (const [key, value] of entries) target.put(value, key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { db.close() }
}
export const listLibraryParts = () => read<LibraryPart[]>('library')
export async function registerLibraryPart(bundle: PartBundle): Promise<LibraryPart> {
  const snapshot = await snapshotPartBundle(bundle), key = `${snapshot.definition.id}@${snapshot.definition.revision}`
  const entry = { hash: snapshot.hash, bundle: { definition: snapshot.definition, definitions: snapshot.definitions, assets: snapshot.assets }, savedAt: new Date().toISOString() }
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('library', 'readwrite'), target = transaction.objectStore('library'), request = target.get(key)
      let conflict = false
      request.onsuccess = () => {
        const existing = request.result as LibraryPart | undefined
        if (existing && existing.hash !== snapshot.hash) { conflict = true; transaction.abort() }
        else target.put(entry, key)
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(conflict ? new Error('This part ID and revision already contain different content; save a new revision or a copy') : transaction.error)
    })
  } finally { db.close() }
  return entry
}
export async function savePartDraft(draft: PartDraft): Promise<void> {
  await write('drafts', [[draft.documentId, draft], ['__current', draft.documentId]])
}
export async function loadPartDraft(): Promise<PartDraft | undefined> {
  const id = await read<string | undefined>('drafts', '__current')
  return id ? read<PartDraft | undefined>('drafts', id) : undefined
}
export async function forkPartBundle(bundle: PartBundle): Promise<PartBundle> {
  const copy = structuredClone(bundle), previous = copy.definition
  copy.definition = { ...previous, id: crypto.randomUUID(), revision: 1,
    derivedFrom: { id: previous.id, revision: previous.revision, hash: await definitionHash(previous) } }
  return copy
}
