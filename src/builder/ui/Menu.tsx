import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Icon, ICON } from '../../ui/Icon'
import st from '../builder.module.css'

/** ヘッダーのプルダウン。外を押すと閉じる。項目は close を受け取り、実行前に閉じる */
export function Dropdown({ label, title, children }: { label: string; title?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => !ref.current?.contains(event.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return <span ref={ref} className={st.dropdown}>
    <button title={title} onClick={() => setOpen(!open)} aria-expanded={open}>{label}<Icon as={ChevronDown} size={ICON.bar} /></button>
    {open && <div className={st.dropdownMenu}>{children(() => setOpen(false))}</div>}
  </span>
}

/** ヘッダーのメニュー。狭幅では見出し付きの項目群として、メニューの中へ並べる */
export function MenuGroup({ label, title, inline, onClose, children }: {
  label: string; title?: string; inline: boolean; onClose?: () => void; children: (close: () => void) => ReactNode
}) {
  return inline
    ? <div className={st.toolbarMenuSubgroup}><h3>{label}</h3>{children(onClose ?? (() => {}))}</div>
    : <Dropdown label={label} title={title}>{children}</Dropdown>
}

/** 左右の領域の境界。横へ引いた量を返す */
export function Splitter({ onDelta }: { onDelta: (delta: number) => void }) {
  const last = useRef(0)
  return <div className={st.splitter} onPointerDown={(event) => {
    last.current = event.clientX
    event.currentTarget.setPointerCapture(event.pointerId)
  }} onPointerMove={(event) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    onDelta(event.clientX - last.current)
    last.current = event.clientX
  }} />
}
