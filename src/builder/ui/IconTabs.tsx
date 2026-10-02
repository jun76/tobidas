import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Icon } from '../../ui/Icon'
import st from '../builder.module.css'

export interface IconTab<T extends string> { id: T; icon: LucideIcon; label: string; node: ReactNode }

/**
 * 縦並びのアイコンで切り替えるタブ。絵本と部品の編集画面のサイドバーで共有する。
 * 中身は切り替えても作り直さず、隠すだけにする。入力途中の値や自動検査が参照する項目を保つため。
 */
export function IconTabs<T extends string>({ tabs, active, onChange, label, idPrefix, kind }: {
  tabs: IconTab<T>[]; active: T; onChange: (id: T) => void; label: string; idPrefix: string; kind: string
}) {
  const buttons = useRef(new Map<T, HTMLButtonElement>())
  // 上下の矢印キーとHome・Endでタブを移る。WAI-ARIAの縦向きタブリストの操作に合わせる。
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const ids = tabs.map((tab) => tab.id)
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    const edge = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : -1
    if (!step && edge < 0) return
    event.preventDefault()
    const next = edge >= 0 ? ids[edge] : ids[(ids.indexOf(active) + step + ids.length) % ids.length]
    onChange(next)
    buttons.current.get(next)?.focus()
  }
  return <div className={st.sidebarTabs} data-tobidas-kind={kind} data-tobidas-sidebar-tab={active}>
    <div className={st.sidebarTabList} role="tablist" aria-label={label} aria-orientation="vertical" onKeyDown={onKeyDown}>
      {tabs.map((tab) => <button key={tab.id} type="button" role="tab" id={`${idPrefix}-tab-${tab.id}`}
        ref={(element) => { if (element) buttons.current.set(tab.id, element); else buttons.current.delete(tab.id) }}
        className={st.sidebarTab} aria-selected={active === tab.id} aria-controls={`${idPrefix}-panel-${tab.id}`}
        tabIndex={active === tab.id ? 0 : -1} aria-label={tab.label} title={tab.label} onClick={() => onChange(tab.id)}>
        <Icon as={tab.icon} size={18} />
      </button>)}
    </div>
    {tabs.map((tab) => <div key={tab.id} role="tabpanel" id={`${idPrefix}-panel-${tab.id}`} aria-labelledby={`${idPrefix}-tab-${tab.id}`}
      className={st.sidebarTabPanel} hidden={active !== tab.id}>
      {tab.node}
    </div>)}
  </div>
}

/** 開いていたタブをブラウザに覚える。作品データには含めない */
export function storedTab<T extends string>(key: string, ids: readonly T[], fallback: T): T {
  try {
    const saved = localStorage.getItem(key)
    if (saved && ids.includes(saved as T)) return saved as T
  } catch { /* 覚えられない環境では既定から始める */ }
  return fallback
}

export function storeTab(key: string, id: string) {
  try { localStorage.setItem(key, id) } catch { /* 覚えられなくても切り替えは通す */ }
}
