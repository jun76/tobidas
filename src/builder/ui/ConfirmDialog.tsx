import { useEffect } from 'react'
import st from '../builder.module.css'

/** ブラウザの confirm() の代替。破壊的操作の確認に使う */
export function ConfirmDialog({
  title,
  body,
  okLabel,
  onOk,
  onClose,
}: {
  title: string
  body: string
  okLabel: string
  onOk: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={st.modalOverlay} onClick={onClose}>
      <div className={st.modal} onClick={(e) => e.stopPropagation()}>
        <div className={st.modalTitle}>{title}</div>
        <div className={st.modalBody}>{body}</div>
        <div className={st.modalActions}>
          <button autoFocus onClick={onClose}>
            キャンセル
          </button>
          <button
            className={st.modalDanger}
            onClick={() => {
              onOk()
              onClose()
            }}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
