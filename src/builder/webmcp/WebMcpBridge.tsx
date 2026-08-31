import { useEffect } from 'react'
import { getWebMcpModelContext } from './types'
import { registerTobidasWebMcpTools } from './tools'

/** アプリ起動中はWebMCPを有効にする。非対応環境では標準UIをそのまま使う。 */
export function WebMcpBridge() {
  useEffect(() => {
    const controller = new AbortController()
    void registerTobidasWebMcpTools(getWebMcpModelContext(), controller.signal).catch(() => {
      // API未実装、権限ポリシー拒否、登録競合のいずれでも標準UIを使い続ける。
      controller.abort()
    })
    return () => controller.abort()
  }, [])
  return null
}
