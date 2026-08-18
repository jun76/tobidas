import type { BookProject } from '../../schema/bookPackage'
import type { AssetData } from '../../schema/assets'
import { decodeProject, encodeProject, type StoredProjectRecord } from './projectCodec'

const DATABASE_NAME = 'tobidas'
const STORE_NAME = 'projects'
const ASSET_BODY_STORE_NAME = 'asset-bodies'
const CURRENT_PROJECT_KEY = '__current'
const DATABASE_VERSION = 2
let persistedProjectId: string | undefined
let persistedBodies = new Map<string, AssetData>()

export async function saveProject(project: BookProject): Promise<void> {
  const database = await openDatabase()
  const encoded = encodeProject(project)
  const desired = new Map(project.assets.map((asset) => [bodyKey(project.id, asset.id), asset.data]))
  const changed = [...desired].filter(([key, data]) => persistedBodies.get(key) !== data)
  const stale = [...persistedBodies.keys()].filter((key) => !desired.has(key))
  const writeBodies = changed.length > 0 || stale.length > 0 || persistedProjectId !== project.id
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        writeBodies ? [STORE_NAME, ASSET_BODY_STORE_NAME] : STORE_NAME,
        'readwrite',
      )
      transaction.objectStore(STORE_NAME).put({ json: encoded.json }, CURRENT_PROJECT_KEY)
      if (writeBodies) {
        const bodies = transaction.objectStore(ASSET_BODY_STORE_NAME)
        for (const [key, data] of changed) bodies.put(data, key)
        for (const key of stale) bodies.delete(key)
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    persistedProjectId = project.id
    persistedBodies = desired
  } finally {
    database.close()
  }
}

export async function loadCurrentProject(): Promise<BookProject | null> {
  const database = await openDatabase()
  try {
    const record = await getRecord(database)
    if (!record) return null
    const projectId = projectIdFromRecord(record)
    const stored = projectId ? await getAssetBodies(database, projectId) : new Map<string, AssetData>()
    const prefix = projectId ? projectId + '/' : ''
    const files = Object.fromEntries([...stored].map(([key, data]) => [key.slice(prefix.length), data]))
    const project = decodeProject(record, Object.keys(files).length ? files : record.files)
    if (project) {
      persistedProjectId = project.id
      persistedBodies = stored.size
        ? stored
        : new Map(project.assets.map((asset) => [bodyKey(project.id, asset.id), asset.data]))
    }
    return project
  } catch {
    return null
  } finally {
    database.close()
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = (event) => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
      const transaction = request.transaction
      if (!transaction) return
      const bodies = request.result.objectStoreNames.contains(ASSET_BODY_STORE_NAME)
        ? transaction.objectStore(ASSET_BODY_STORE_NAME)
        : request.result.createObjectStore(ASSET_BODY_STORE_NAME)
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion
      if (oldVersion < 2 && oldVersion > 0) {
        const projects = transaction.objectStore(STORE_NAME)
        const legacy = projects.get(CURRENT_PROJECT_KEY)
        legacy.onsuccess = () => {
          const record = legacy.result as StoredProjectRecord | undefined
          if (!record?.files) return
          const projectId = projectIdFromRecord(record) ?? '__legacy'
          for (const [id, data] of Object.entries(record.files)) bodies.put(data, bodyKey(projectId, id))
          projects.put({ json: record.json }, CURRENT_PROJECT_KEY)
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function getAssetBodies(database: IDBDatabase, projectId: string): Promise<Map<string, AssetData>> {
  return new Promise((resolve, reject) => {
    const output = new Map<string, AssetData>()
    const prefix = projectId + '/'
    const request = database.transaction(ASSET_BODY_STORE_NAME).objectStore(ASSET_BODY_STORE_NAME).openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve(output)
        return
      }
      const key = String(cursor.key)
      if (key.startsWith(prefix)) output.set(key, cursor.value as AssetData)
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
  })
}

function bodyKey(projectId: string, assetId: string): string {
  return projectId + '/' + assetId
}

function projectIdFromRecord(record: StoredProjectRecord): string | undefined {
  try {
    const parsed = JSON.parse(record.json) as { id?: unknown }
    return typeof parsed.id === 'string' ? parsed.id : undefined
  } catch {
    return undefined
  }
}

function getRecord(database: IDBDatabase): Promise<StoredProjectRecord | undefined> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(CURRENT_PROJECT_KEY)
    request.onsuccess = () => resolve(request.result as StoredProjectRecord | undefined)
    request.onerror = () => reject(request.error)
  })
}
