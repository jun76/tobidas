import { create } from 'zustand'

/** ビルダーの配色。ライトは紙の工作机、ダークは従来の暗い編集画面と夜のホーム。 */
export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

// 表示言語と同じく利用者の環境設定なので、作品データや書き出しには含めない。
const STORAGE_KEY = 'tobidas.theme'

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && (THEMES as readonly string[]).includes(saved)) return saved as Theme
  } catch { /* localStorage が使えない環境では既定へ倒す */ }
  return 'light'
}

/** 色の変数は theme.css が <html data-theme> で切り替える。ダイアログも同じ配色になる */
function applyTheme(theme: Theme) {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme
}

interface ThemeState {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialTheme(),
  setTheme: (theme) => {
    try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* 覚えられなくても切り替えは通す */ }
    applyTheme(theme)
    set({ theme })
  },
}))

// 最初の描画より前に属性を付け、ライトの画面が一瞬映らないようにする。
applyTheme(useThemeStore.getState().theme)
