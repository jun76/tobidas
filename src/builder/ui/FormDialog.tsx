import { useEffect, useId, type FormEvent, type ReactNode } from 'react'
import { useT } from '../i18n'
import st from '../builder.module.css'

export function FormDialog({
  title,
  submitLabel,
  children,
  error,
  kind,
  toolName,
  toolDescription,
  onSubmit,
  onClose,
}: {
  title: string
  submitLabel: string
  children: ReactNode
  error?: string
  kind: string
  toolName?: string
  toolDescription?: string
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}) {
  const t = useT()
  const titleId = useId()
  const errorId = useId()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return <div className={st.modalOverlay} onClick={onClose}>
    <form className={st.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}
      aria-describedby={error ? errorId : undefined} data-tobidas-kind={kind}
      {...(toolName ? { toolname: toolName, tooldescription: toolDescription ?? title } : {})}
      onSubmit={onSubmit} onClick={(event) => event.stopPropagation()}>
      <div id={titleId} className={st.modalTitle}>{title}</div>
      <div className={st.modalBody}>{children}</div>
      {error && <div id={errorId} className={st.formError} role="alert">{error}</div>}
      <div className={st.modalActions}>
        <button type="button" onClick={onClose}>{t.dialog.cancel}</button>
        <button type="submit">{submitLabel}</button>
      </div>
    </form>
  </div>
}
