import { create } from 'zustand'

export interface BusyTask { title: string; detail?: string; progress?: number }
interface BusyState { task: BusyTask | null; set: (task: BusyTask | null) => void }

/** 読み込みなど画面を占有する処理の状態。オーバーレイが購読し、操作を止める。 */
export const useBusyStore = create<BusyState>((set) => ({ task: null, set: (task) => set({ task }) }))

/** 直前の状態変更が画面に描かれるまで待つ。同期の重い処理へ入る前に挟む。 */
export const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

export type BusyReporter = (detail: string, progress?: number) => void

/** 全画面のオーバーレイで操作を止めて work を走らせる。表示を描いてから始め、結果の描画後に消す。 */
export async function runBusy<T>(title: string, work: (report: BusyReporter) => Promise<T>): Promise<T> {
  const { set } = useBusyStore.getState()
  set({ title })
  await nextPaint()
  try {
    return await work((detail, progress) => set({ title, detail, progress }))
  } finally {
    await nextPaint()
    set(null)
  }
}
