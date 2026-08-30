const STORAGE_KEY = 'tobidas.aiMode'

export function readAiMode(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}
export function writeAiMode(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // sessionStorageを使えない環境でも、現在のタブ内のReact状態は利用できる。
  }
}
