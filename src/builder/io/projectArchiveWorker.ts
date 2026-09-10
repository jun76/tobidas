import { buildProjectZip, readProjectZip } from '../../package/zip'
import type { BookProject } from '../../schema/bookPackage'

export type ArchiveRequest = { type: 'write'; project: BookProject } | { type: 'read'; bytes: ArrayBuffer }
const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<ArchiveRequest>) => void
  postMessage: (value: unknown, transfer?: Transferable[]) => void
}

// ZIPの展開・圧縮と検証を描画スレッドから外す。保存形式や検証器は通常の入出力と共有する。
worker.onmessage = async ({ data }) => {
  try {
    const result = data.type === 'write' ? await buildProjectZip(data.project) : await readProjectZip(data.bytes)
    worker.postMessage({ ok: true, result }, result instanceof Uint8Array ? [result.buffer] : [])
  } catch (error) { worker.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) }) }
}
