import type { BookProject } from '../../schema/bookPackage'
import type { AssembleResult } from '../../package/model'
import type { ArchiveRequest } from './projectArchiveWorker'

function runArchive<T>(request: ArchiveRequest, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./projectArchiveWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => { worker.terminate(); if (data.ok) resolve(data.result as T); else reject(new Error(data.message)) }
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message)) }
    worker.onmessageerror = () => { worker.terminate(); reject(new Error('Could not read the archive result')) }
    worker.postMessage(request, transfer)
  })
}
export async function writeProjectArchive(project: BookProject): Promise<Uint8Array> {
  if (typeof Worker === 'undefined') return (await import('../../package/zip')).buildProjectZip(project)
  return runArchive({ type: 'write', project })
}
export async function readProjectArchive(bytes: ArrayBuffer): Promise<AssembleResult> {
  if (typeof Worker === 'undefined') return (await import('../../package/zip')).readProjectZip(bytes)
  return runArchive({ type: 'read', bytes }, [bytes])
}
