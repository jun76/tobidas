import { useEffect, useId, type ReactNode } from 'react'
import { useT } from '../i18n'
import st from '../builder.module.css'

export function DetailsDialog({ title, kind, children, onClose }: {
  title: string
  kind: string
  children: ReactNode
  onClose: () => void
}) {
  const t = useT()
  const titleId = useId()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Enter') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return <div className={st.modalOverlay} onClick={onClose}>
    <div className={st.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}
      data-tobidas-kind={kind} onClick={(event) => event.stopPropagation()}>
      <div id={titleId} className={st.modalTitle}>{title}</div>
      <div className={st.modalBody}>{children}</div>
      <div className={st.modalActions}><button autoFocus onClick={onClose}>{t.dialog.ok}</button></div>
    </div>
  </div>
}
