import { useEffect } from 'react'
import { getWebMcpModelContext } from './types'
import { registerTobidasWebMcpTools } from './tools'
import { useWorkspaceStore } from '../parts/store'

// HMRでも旧storeを閉じ込めたツールを残さず、更新後の共通操作へ登録し直す。
let registration: AbortController | undefined
if (import.meta.hot) import.meta.hot.dispose(() => registration?.abort())

/** アプリ起動中はWebMCPを有効にする。非対応環境では標準UIをそのまま使う。 */
export function WebMcpBridge() {
  const screen = useWorkspaceStore((state) => state.screen)
  useEffect(() => {
    registration?.abort()
    const controller = new AbortController()
    registration = controller
    void registerTobidasWebMcpTools(getWebMcpModelContext(), controller.signal, screen).catch(() => {
      // API未実装、権限ポリシー拒否、登録競合のいずれでも標準UIを使い続ける。
      controller.abort()
    })
    return () => { controller.abort(); if (registration === controller) registration = undefined }
  }, [registerTobidasWebMcpTools, screen])
  return null
}
