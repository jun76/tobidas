import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { MessageDialog } from './MessageDialog'

interface MessageRequest {
  id: number
  title: string
  body: string
}

interface DialogContextValue {
  showMessage: (title: string, body: string) => void
}

const DialogContext = createContext<DialogContextValue | null>(null)

/**
 * アプリ全体の通知ダイアログ。
 *
 * ブラウザ組み込み通知と違って非同期処理を止めないので、複数の失敗が続いた場合も消えないよう
 * 到着順にキューへ積む。各パネルは表示場所を意識せず showMessage() だけを呼ぶ。
 */
export function DialogProvider({ children }: { children: ReactNode }) {
  const nextId = useRef(0)
  const [messages, setMessages] = useState<MessageRequest[]>([])
  const showMessage = useCallback((title: string, body: string) => {
    setMessages((current) => [...current, { id: ++nextId.current, title, body }])
  }, [])
  const closeCurrent = useCallback(() => setMessages((current) => current.slice(1)), [])
  const value = useMemo(() => ({ showMessage }), [showMessage])
  const current = messages[0]

  return <DialogContext.Provider value={value}>
    {children}
    {current && <MessageDialog key={current.id} title={current.title} body={current.body} onClose={closeCurrent} />}
  </DialogContext.Provider>
}

export function useDialogs(): DialogContextValue {
  const value = useContext(DialogContext)
  if (!value) throw new Error('useDialogs must be used inside DialogProvider')
  return value
}
