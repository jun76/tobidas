import { useEffect } from 'react'
import App from './App'
import { HomeScreen, SettingsScreen } from './home/HomeScreens'
import { PartEditor } from './parts/PartEditor'
import { usePartEditorStore, useWorkspaceStore } from './parts/store'
import { WebMcpBridge } from './webmcp/WebMcpBridge'

export default function Workspace() {
  const workspace = useWorkspaceStore(), boot = usePartEditorStore((state) => state.boot)
  useEffect(() => { void boot() }, [boot])
  return <><WebMcpBridge />{workspace.screen === 'book' ? <App /> : workspace.screen === 'part' ? <PartEditor />
    : workspace.screen === 'settings' ? <SettingsScreen /> : <HomeScreen />}</>
}
