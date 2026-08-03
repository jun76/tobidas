import { useEffect, useId } from 'react'
import { useT } from '../i18n'
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
  const t = useT()
  const titleId = useId()
  const bodyId = useId()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault()
        event.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className={st.modalOverlay} onClick={onClose}>
      <div className={st.modal} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}
        onClick={(event) => event.stopPropagation()}>
        <div id={titleId} className={st.modalTitle}>{title}</div>
        <div id={bodyId} className={st.modalBody}>{body}</div>
        <div className={st.modalActions}>
          <button autoFocus onClick={onClose}>{t.dialog.ok}</button>
        </div>
      </div>
    </div>
  )
}
