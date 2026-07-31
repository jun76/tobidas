import { create } from 'zustand'
import { en } from './en'
import { ja, type Dict } from './ja'

/**
 * ビルダーUIの表示言語。
 *
 * 作品データではなく編集セッションの設定なので、作品パッケージにも書き出しにも入らない。
 * 端末ごとの好みとして localStorage に覚え、既定は日本語。
 *
 * 対象はビルダーの画面だけ。検証・収納診断のメッセージ (schema / runtime / package) は
 * 英語で固定してあり、書き出した再生画面も同じく英語のまま切り替えない。
 */
export const LOCALES = [
  { id: 'ja', label: '日本語' },
  { id: 'en', label: 'English' },
] as const

export type Locale = (typeof LOCALES)[number]['id']

const DICTS: Record<Locale, Dict> = { ja, en }
const STORAGE_KEY = 'tobidas.locale'

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && saved in DICTS) return saved as Locale
  } catch { /* localStorage が使えない環境では既定へ倒す */ }
  return 'ja'
}

interface LocaleState {
  locale: Locale
  setLocale: (locale: Locale) => void
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: initialLocale(),
  setLocale: (locale) => {
    try { localStorage.setItem(STORAGE_KEY, locale) } catch { /* 覚えられなくても切り替えは通す */ }
    set({ locale })
  },
}))

/** 部品から辞書を引く。言語を変えると購読しているところだけ描き直される */
export function useT(): Dict {
  return DICTS[useLocaleStore((state) => state.locale)]
}

/** 部品の外 (store の操作や io の例外) から引く。購読しないので、呼んだ時点の言語で確定する */
export function t(): Dict {
  return DICTS[useLocaleStore.getState().locale]
}
