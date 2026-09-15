import { validateBookParts } from '../../parts/book'
import type { BookProject } from '../../schema/bookPackage'

/** 素材の実体を除いた作品と、検査する見開きの番号。 */
export interface SpreadInspectionRequest { project: BookProject; index: number }
const worker = globalThis as unknown as {
  onmessage: (event: MessageEvent<SpreadInspectionRequest>) => void
  postMessage: (value: unknown) => void
}

// 見開きごとの紙の検査を描画スレッドから外す。検査器そのものは通常の検証と共有する。
worker.onmessage = ({ data }) => {
  try {
    const spread = data.project.book.spreads[data.index]
    const errors = validateBookParts({ ...data.project, book: { ...data.project.book, spreads: [spread] } })
    worker.postMessage({ ok: true, errors })
  } catch (error) { worker.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) }) }
}
