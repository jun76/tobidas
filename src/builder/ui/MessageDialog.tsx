import { useEffect } from 'react'
import st from '../builder.module.css'

export function MessageDialog({
  title,
  body,
  onClose,
}: {
  title: string
  body: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={st.modalOverlay} onClick={onClose}>
      <div className={st.modal} role="alertdialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className={st.modalTitle}>{title}</div>
        <div className={st.modalBody}>{body}</div>
        <div className={st.modalActions}>
          <button autoFocus onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  )
}
