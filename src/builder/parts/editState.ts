import { create } from 'zustand'
import type { BookProject } from '../../schema/bookPackage'
import type { PartEditIntent } from '../../parts/edit'
import { useBuilderStore } from '../store'
import { editPlacedPartCommand } from './commands'
import { previewPartEdit, sketchPartEdit, withPreviewSpread, type PartEditPreview } from './editPreview'
import type { PartEditWorkerRequest, PartEditWorkerResponse } from './partEditWorker'

interface PartEditSession {
  source: BookProject; spreadId: string; elementId: string; preview: BookProject
  intent?: PartEditIntent; last?: PartEditIntent; error: string
}
interface EditState {
  session: PartEditSession | null; angleId: string; error: string
  begin: (spreadId: string, elementId: string) => void
  preview: (intent: PartEditIntent) => void
  finish: () => void; cancel: () => void; chooseAngle: (id: string) => void
}
export const usePartEditStore = create<EditState>((set, get) => ({
  session: null, angleId: '', error: '', chooseAngle: (angleId) => set({ angleId, session: null, error: '' }),
  begin: (spreadId, elementId) => {
    const source = useBuilderStore.getState().project
    set({ error: '', session: { source, spreadId, elementId, preview: source, error: '' } })
  },
  preview: (intent) => {
    const s = get().session
    if (!s || s.source !== useBuilderStore.getState().project) { set({ session: null }); return }
    // 紙はギズモと同じフレームで幾何だけ動かす。衝突と演出の検査はWorkerで続け、結果を後から反映する
    const sketch = sketchPartEdit(s.source, s.spreadId, s.elementId, intent)
    if (!sketch.ok) { set({ session: { ...s, intent, error: sketch.detail } }); return }
    set({ session: { ...s, intent, preview: withPreviewSpread(s.source, s.spreadId, sketch) } })
    if (!requestPreview(s, intent)) receive(s, intent, previewPartEdit(s.source, s.spreadId, s.elementId, intent))
  },
  finish: () => {
    const s = get().session
    queued = undefined; set({ session: null })
    if (!s || !s.intent || s.source !== useBuilderStore.getState().project) return
    // 確定の共通コマンドが全角度の検査を行う。同じ検査を事前に重ねず、通らなければ最後に成立した姿勢で確定する
    const command = (intent: PartEditIntent) => editPlacedPartCommand({ spreadId: s.spreadId, elementId: s.elementId, intent })
    const result = command(s.intent)
    if (result.ok) { set({ error: '' }); return }
    const fallback = s.last && s.last !== s.intent ? command(s.last) : undefined
    set({ error: fallback && !fallback.ok ? fallback.message : result.message })
  },
  cancel: () => { queued = undefined; set({ session: null, error: '' }) },
}))
/**
 * 検査の結果を同じ操作中なら反映する。確定や中止の後に届いた結果は捨てる。
 * 成否は直近に検査できた姿勢のものを示し、検査済みの支持と押しのけた演出は、まだ同じ姿勢を指しているときだけ表示へ移す。
 */
function receive(sent: PartEditSession, intent: PartEditIntent, result: PartEditPreview) {
  const s = usePartEditStore.getState().session
  if (!s || s.source !== sent.source || s.elementId !== sent.elementId) return
  usePartEditStore.setState({ session: !result.ok ? { ...s, error: result.detail }
    : { ...s, last: intent, error: '', preview: s.intent === intent ? withPreviewSpread(s.source, s.spreadId, result) : s.preview } })
}

// 検査つきの候補計算は数十〜数百ミリ秒かかる。Workerへ渡して描画を止めず、計算中に届いた操作は最新の一件だけを残す。
// Workerを持たない環境 (単体テスト) では同じ計算を同期で行う。
let worker: Worker | null | undefined, version = 0, posted: BookProject | undefined, nextId = 0
let inflight: { id: number; session: PartEditSession; intent: PartEditIntent } | undefined
let queued: { session: PartEditSession; intent: PartEditIntent } | undefined
function previewWorker(): Worker | null {
  if (worker !== undefined) return worker
  if (typeof Worker === 'undefined') return worker = null
  worker = new Worker(new URL('./partEditWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }: MessageEvent<PartEditWorkerResponse>) => {
    if (inflight?.id !== data.id) return
    const done = inflight; inflight = undefined
    receive(done.session, done.intent, data.result)
    const next = queued; queued = undefined
    if (next) send(next.session, next.intent)
  }
  worker.onerror = () => { worker?.terminate(); worker = null; inflight = queued = undefined; posted = undefined }
  return worker
}
function send(session: PartEditSession, intent: PartEditIntent) {
  const target = previewWorker()!
  if (posted !== session.source) {
    // 素材の実体は候補計算に要らない。IDと種類だけを渡して転送を軽くする。
    posted = session.source; version++
    const project = { ...session.source, assets: session.source.assets.map(({ data: _data, ...meta }) => meta) } as unknown as BookProject
    target.postMessage({ type: 'source', version, project } satisfies PartEditWorkerRequest)
  }
  inflight = { id: ++nextId, session, intent }
  target.postMessage({ type: 'preview', id: inflight.id, version, spreadId: session.spreadId, elementId: session.elementId, intent } satisfies PartEditWorkerRequest)
}
function requestPreview(session: PartEditSession, intent: PartEditIntent): boolean {
  if (!previewWorker()) return false
  if (inflight) queued = { session, intent }
  else send(session, intent)
  return true
}

const unsubscribe = useBuilderStore.subscribe((state, previous) => {
  if (state.project !== previous.project || state.selection !== previous.selection || state.mode !== previous.mode
    || state.previewProgress !== previous.previewProgress || state.gizmo !== previous.gizmo) usePartEditStore.getState().cancel()
})
if (import.meta.hot) import.meta.hot.dispose(unsubscribe)
