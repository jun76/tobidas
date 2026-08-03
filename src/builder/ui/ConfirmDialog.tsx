import { useEffect, useId } from 'react'
import { useT } from '../i18n'
import st from '../builder.module.css'

/** ブラウザ組み込み確認を使わず、破壊的操作をアプリ内で確認する */
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
  const t = useT()
  const titleId = useId()
  const bodyId = useId()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className={st.modalOverlay} onClick={onClose}>
      <div className={st.modal} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}
        onClick={(e) => e.stopPropagation()}>
        <div id={titleId} className={st.modalTitle}>{title}</div>
        <div id={bodyId} className={st.modalBody}>{body}</div>
        <div className={st.modalActions}>
          <button autoFocus onClick={onClose}>
            {t.dialog.cancel}
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
