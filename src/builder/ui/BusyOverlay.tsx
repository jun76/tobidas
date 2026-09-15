import { useEffect } from 'react'
import { useBusyStore } from './busy'
import st from '../builder.module.css'

/** 読み込み中の全画面表示。ポインタとキー操作を止め、進み具合を見せる。 */
export function BusyOverlay() {
  const task = useBusyStore((state) => state.task)
  useEffect(() => {
    if (!task) return
    const block = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation() }
    window.addEventListener('keydown', block, true)
    return () => window.removeEventListener('keydown', block, true)
  }, [task])
  if (!task) return null
  const percent = task.progress === undefined ? undefined : Math.round(Math.max(0, Math.min(1, task.progress)) * 100)
  return (
    <div className={`${st.modalOverlay} ${st.busyOverlay}`} role="status" aria-live="polite" aria-busy="true">
      <div className={st.busyCard}>
        <div className={st.busySpinner} aria-hidden="true" />
        <div className={st.busyTitle}>{task.title}</div>
        {task.detail && <div className={st.busyDetail}>{task.detail}</div>}
        {percent !== undefined && <div className={st.busyBar}><div className={st.busyBarFill} style={{ width: `${percent}%` }} /></div>}
      </div>
    </div>
  )
}
