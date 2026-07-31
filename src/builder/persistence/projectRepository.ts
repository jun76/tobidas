import type { BookProject } from '../../schema/bookPackage'
import { decodeProject, encodeProject, type StoredProjectRecord } from './projectCodec'

const DATABASE_NAME = 'tobidas'
const STORE_NAME = 'projects'
const CURRENT_PROJECT_KEY = '__current'

export async function saveProject(project: BookProject): Promise<void> {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).clear()
    transaction.objectStore(STORE_NAME).put(encodeProject(project), CURRENT_PROJECT_KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

export async function loadCurrentProject(): Promise<BookProject | null> {
  const database = await openDatabase()
  try {
    const record = await getRecord(database)
    return record ? decodeProject(record) : null
  } catch {
    return null
  } finally {
    database.close()
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function getRecord(database: IDBDatabase): Promise<StoredProjectRecord | undefined> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(CURRENT_PROJECT_KEY)
    request.onsuccess = () => resolve(request.result as StoredProjectRecord | undefined)
    request.onerror = () => reject(request.error)
  })
}
