import type { BookProject } from '../../schema/bookPackage'
import type { PartEditIntent } from '../../parts/edit'
import { previewPartEdit } from './editPreview'

/** 操作開始時に素材の実体を除いた作品を一度だけ送り、以後は操作量だけを送る。 */
export type PartEditWorkerRequest =
  | { type: 'source'; version: number; project: BookProject }
  | { type: 'preview'; id: number; version: number; spreadId: string; elementId: string; intent: PartEditIntent }
export type PartEditWorkerResponse = { id: number; result: ReturnType<typeof previewPartEdit> }

const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<PartEditWorkerRequest>) => void
  postMessage: (value: PartEditWorkerResponse) => void
}
let source: { version: number; project: BookProject } | undefined

// ギズモの候補計算を描画スレッドから外し、計算中もギズモとカメラを滑らかに動かす。
worker.onmessage = ({ data }) => {
  if (data.type === 'source') { source = { version: data.version, project: data.project }; return }
  let result: ReturnType<typeof previewPartEdit>
  try {
    if (source?.version !== data.version) throw new Error('Edited project is out of date')
    result = previewPartEdit(source.project, data.spreadId, data.elementId, data.intent)
  } catch (error) { result = { ok: false, detail: error instanceof Error ? error.message : String(error) } }
  worker.postMessage({ id: data.id, result })
}
