import { useEffect, useRef, useState } from 'react'
import { Blocks, BookOpen, Images, Lightbulb, MousePointerClick, Music, NotebookPen, Video } from 'lucide-react'
import { useT } from '../i18n'
import { useBuilderStore } from '../store'
import { IconTabs, storedTab, storeTab, type IconTab } from '../ui/IconTabs'
import { PartPresets } from './Hierarchy'
import { AssetsPanel } from './AssetsPanel'
import { AuthoringGuide, BookPanel, CameraPanel, LightingPanel, SelectionPanel, SoundPanel } from './Properties'

export type SidebarTab = 'parts' | 'assets' | 'selection' | 'book' | 'sound' | 'camera' | 'lighting' | 'guide'

const STORAGE_KEY = 'tobidas.sidebarTab'
const TAB_IDS: SidebarTab[] = ['book', 'parts', 'assets', 'selection', 'sound', 'camera', 'lighting', 'guide']

/** 絵本の編集画面のサイドバー下段。部品、アセット、選択中の対象、作品の設定、制作ガイドを切り替える */
export function SidebarTabs() {
  const t = useT()
  const [tab, setTab] = useState<SidebarTab>(() => storedTab(STORAGE_KEY, TAB_IDS, 'parts'))
  const selection = useBuilderStore((state) => state.selection)
  const choose = (next: SidebarTab) => { setTab(next); storeTab(STORAGE_KEY, next) }

  // 部品・ページ・表紙・光源を選んだら、その設定を見せる。見開きの移動では切り替えない。
  // 部品パレットを開いている間は、続けて配置できるよう切り替えない。
  const previous = useRef(selection)
  useEffect(() => {
    if (previous.current === selection) return
    previous.current = selection
    if (['element', 'page', 'cover', 'light'].includes(selection.type)) setTab((current) => current === 'parts' ? current : 'selection')
  }, [selection])

  const tabs: IconTab<SidebarTab>[] = [
    { id: 'book', icon: BookOpen, label: t.app.inspectorProject, node: <BookPanel /> },
    { id: 'parts', icon: Blocks, label: t.app.panelPresets, node: <PartPresets /> },
    { id: 'assets', icon: Images, label: t.app.panelAssets, node: <AssetsPanel /> },
    { id: 'selection', icon: MousePointerClick, label: t.app.panelSelection, node: <SelectionPanel /> },
    { id: 'sound', icon: Music, label: t.app.inspectorSound, node: <SoundPanel /> },
    { id: 'camera', icon: Video, label: t.app.inspectorCamera, node: <CameraPanel /> },
    { id: 'lighting', icon: Lightbulb, label: t.app.inspectorLighting, node: <LightingPanel /> },
    { id: 'guide', icon: NotebookPen, label: t.authoringGuide.title, node: <AuthoringGuide /> },
  ]
  return <IconTabs tabs={tabs} active={tab} onChange={choose} label={t.app.panelSidebar} idPrefix="sidebar" kind="sidebar" />
}
