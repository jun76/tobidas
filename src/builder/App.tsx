import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { CircleAlert, TriangleAlert } from 'lucide-react'
import { Icon } from '../ui/Icon'
import packageJson from '../../package.json'
import { useT } from './i18n'
import { useBuilderStore } from './store'
import { loadCurrentProject } from './persistence/projectRepository'
import { CONTAINER_ELEMENTS_DELETE_REQUEST_EVENT, ELEMENT_DELETE_REQUEST_EVENT, SPREAD_DELETE_REQUEST_EVENT, type ContainerElementsDeleteRequest, type ElementDeleteRequest } from './elementDelete'
import { containerElementIds, elementRemovalIds, type RootParentType } from './hierarchy'
import { saveViewportImage } from './capture/saveViewportImage'
import { clampPanelWidth, loadPanelWidth, savePanelWidth } from './layout/panelSizing'
import { Toolbar } from './panels/Toolbar'
import { BookNavigator } from './panels/Hierarchy'
import { SidebarTabs } from './panels/SidebarTabs'
import { Viewport, viewportGlRef } from './Viewport'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { SplitStack } from './ui/SplitStack'
import { Splitter } from './ui/Menu'
import { WebMcpBridge } from './webmcp/WebMcpBridge'
import { useOperationResultStore } from './operations/result'
import type { BookSelection } from './state/editorState'
import st from './builder.module.css'

// 右のインスペクターを左へ統合したので、旧来の細い左幅は引き継がず別の名前で覚える。
const SIDEBAR_DEFAULT = 380
let projectRestored = false

export default function App() {
  const t = useT()
  const setProject = useBuilderStore((state) => state.setProject)
  const projectSession = useBuilderStore((state) => state.projectSession)
  const mode = useBuilderStore((state) => state.mode)
  const projectId = useBuilderStore((state) => state.project.id)
  const activeSpreadId = useBuilderStore((state) => state.activeSpreadId)
  const selection = useBuilderStore((state) => state.selection)
  const previewProgress = useBuilderStore((state) => state.previewProgress)
  const operationResult = useOperationResultStore((state) => state.result)
  const [booted, setBooted] = useState(projectRestored)
  const [stateVersion, setStateVersion] = useState(0)
  const [pendingElementDelete, setPendingElementDelete] = useState<{
    spreadId: string
    elementId: string
    name: string
    descendantCount: number
  } | null>(null)
  const [pendingSpreadDelete, setPendingSpreadDelete] = useState<{
    spreadId: string
    name: string
    elementCount: number
  } | null>(null)
  const [pendingContainerDelete, setPendingContainerDelete] = useState<{
    spreadId: string
    parentType: RootParentType
    elementCount: number
  } | null>(null)
  const [leftWidth, setLeftWidth] = useState(() => loadPanelWidth('sidebar', SIDEBAR_DEFAULT))
  useEffect(() => { savePanelWidth('sidebar', leftWidth) }, [leftWidth])
  useEffect(() => useBuilderStore.subscribe(() => setStateVersion((value) => value + 1)), [])
  useEffect(() => {
    setPendingElementDelete(null)
    setPendingSpreadDelete(null)
    setPendingContainerDelete(null)
  }, [projectSession])
  useEffect(() => {
    if (projectRestored) return
    let alive = true
    void loadCurrentProject().then((project) => {
      if (alive && project) setProject(project, 'idb')
      if (alive) { projectRestored = true; setBooted(true) }
    })
    return () => { alive = false }
  }, [setProject])
  useEffect(() => {
    const requestDelete = (event: Event) => {
      const { spreadId, elementId } = (event as CustomEvent<ElementDeleteRequest>).detail
      const store = useBuilderStore.getState()
      const spread = store.project.book.spreads.find((item) => item.id === spreadId)
      const element = spread?.elements.find((item) => item.id === elementId)
      if (!spread || !element) return
      const descendantCount = elementRemovalIds(spread, elementId).size - 1
      if (!descendantCount) {
        store.removeElement(spreadId, elementId)
        return
      }
      setPendingElementDelete({ spreadId, elementId, name: element.name, descendantCount })
    }
    const requestSpreadDelete = (event: Event) => {
      const spreadId = (event as CustomEvent<string>).detail
      const store = useBuilderStore.getState()
      const spread = store.project.book.spreads.find((item) => item.id === spreadId)
      if (!spread || store.project.book.spreads.length < 2) return
      if (!spread.elements.length) {
        store.removeSpread(spreadId)
        return
      }
      setPendingSpreadDelete({ spreadId, name: spread.name, elementCount: spread.elements.length })
    }
    const requestContainerDelete = (event: Event) => {
      const { spreadId, parentType } = (event as CustomEvent<ContainerElementsDeleteRequest>).detail
      const spread = useBuilderStore.getState().project.book.spreads.find((item) => item.id === spreadId)
      if (!spread) return
      const elementCount = containerElementIds(spread, parentType).size
      if (elementCount) setPendingContainerDelete({ spreadId, parentType, elementCount })
    }
    window.addEventListener(ELEMENT_DELETE_REQUEST_EVENT, requestDelete)
    window.addEventListener(SPREAD_DELETE_REQUEST_EVENT, requestSpreadDelete)
    window.addEventListener(CONTAINER_ELEMENTS_DELETE_REQUEST_EVENT, requestContainerDelete)
    return () => {
      window.removeEventListener(ELEMENT_DELETE_REQUEST_EVENT, requestDelete)
      window.removeEventListener(SPREAD_DELETE_REQUEST_EVENT, requestSpreadDelete)
      window.removeEventListener(CONTAINER_ELEMENTS_DELETE_REQUEST_EVENT, requestContainerDelete)
    }
  }, [])

  const screenshot = () => saveViewportImage(
    viewportGlRef.current?.domElement
      ?? document.querySelector<HTMLCanvasElement>('[data-viewport-root] canvas'),
  )

  if (!booted) return <div className={st.app} style={{ alignItems: 'center', justifyContent: 'center' }}>{t.app.loading}</div>
  return <div className={st.app}>
    <output className={st.visuallyHidden} data-tobidas-kind="operation-result"
      aria-live="polite" aria-atomic="true">{operationResult ? JSON.stringify(operationResult) : ''}</output>
    {pendingElementDelete && <ConfirmDialog
      title={t.app.deleteElementTitle}
      body={t.app.deleteElementBody(pendingElementDelete.name, pendingElementDelete.descendantCount)}
      okLabel={t.app.deleteOk}
      onOk={() => useBuilderStore.getState().removeElement(pendingElementDelete.spreadId, pendingElementDelete.elementId)}
      onClose={() => setPendingElementDelete(null)}
    />}
    {pendingSpreadDelete && <ConfirmDialog
      title={t.app.deleteSpreadTitle}
      body={t.app.deleteSpreadBody(pendingSpreadDelete.name, pendingSpreadDelete.elementCount)}
      okLabel={t.app.deleteOk}
      onOk={() => useBuilderStore.getState().removeSpread(pendingSpreadDelete.spreadId)}
      onClose={() => setPendingSpreadDelete(null)}
    />}
    {pendingContainerDelete && <ConfirmDialog
      title={t.app.deleteContainerTitle(pendingContainerDelete.parentType === 'left-page' ? t.properties.leftPage : t.properties.rightPage)}
      body={t.app.deleteContainerBody(pendingContainerDelete.elementCount, true)}
      okLabel={t.app.deleteAllOk}
      onOk={() => useBuilderStore.getState().clearContainerElements(pendingContainerDelete.spreadId, pendingContainerDelete.parentType)}
      onClose={() => setPendingContainerDelete(null)}
    />}
    <Toolbar key={`toolbar-${projectSession}`} />
    <div className={`${st.main} ${mode === 'edit' ? st.mainEdit : st.mainPlay}`} key={`workspace-${projectSession}`}
      data-tobidas-kind="builder-workspace"
      data-tobidas-project-id={projectId}
      data-tobidas-mode={mode}
      data-tobidas-active-spread-id={activeSpreadId}
      data-tobidas-selection-kind={selection.type}
      data-tobidas-selection-id={selectionId(selection, projectId)}
      data-tobidas-preview-progress={String(previewProgress)}
      data-tobidas-state-version={String(stateVersion)}>
      {mode === 'edit' && <aside className={st.left} style={{ '--panel-width': `${leftWidth}px` } as CSSProperties}>
        <SplitStack storageKey="sidebar" initial={[260]} mobileAccordion panes={[
          { key: 'navigator', label: t.app.panelNavigator, node: <BookNavigator /> },
          { key: 'tabs', label: t.app.panelSidebar, node: <SidebarTabs /> },
        ]} />
      </aside>}
      {mode === 'edit' && <Splitter onDelta={(delta) => setLeftWidth((value) => clampPanelWidth(value + delta))} />}
      <Viewport onScreenshot={screenshot} />
    </div>
    <StatusBar key={`status-${projectSession}`} />
  </div>
}

function selectionId(selection: BookSelection, projectId: string): string {
  if (selection.type === 'book') return projectId
  if (selection.type === 'light') return 'directional-light'
  if (selection.type === 'cover') return selection.side
  if (selection.type === 'spread') return selection.spreadId
  if (selection.type === 'page') return `${selection.spreadId}:${selection.side}`
  return selection.elementId
}

function StatusBar() {
  const t = useT()
  const { project, source, issues } = useBuilderStore()
  const [open, setOpen] = useState(false)
  const issueListRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const timeout = window.setTimeout(() => setOpen(false), 4000)
    const closeOutside = (event: PointerEvent) => {
      if (!issueListRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside, true)
    return () => {
      window.clearTimeout(timeout)
      document.removeEventListener('pointerdown', closeOutside, true)
    }
  }, [open])
  return <>
    {open && <div ref={issueListRef} className={st.issueList} data-tobidas-kind="validation-issues">
      {issues.errors.map((issue, index) => <div className={st.err} key={`e${index}`}><Icon as={CircleAlert} />{issue}</div>)}
      {issues.warnings.map((issue, index) => <div className={st.warn} key={`w${index}`}><Icon as={TriangleAlert} />{issue}</div>)}
      {!issues.errors.length && !issues.warnings.length && <div className={st.ok}>{t.app.noIssues}</div>}
    </div>}
    <div className={st.status}>
      <span>{project.name}</span><span>tobidas v{packageJson.version}</span>
      <span>{source === 'import' ? t.app.sourceImport : source === 'idb' ? t.app.sourceRestored : t.app.sourceNew}</span>
      <span className={st.spacer} />
      <button type="button" className={`${st.statusIssueButton} ${issues.errors.length ? st.err : issues.warnings.length ? st.warn : st.ok}`}
        aria-expanded={open} onClick={() => setOpen(!open)}>
        {issues.errors.length ? t.app.errorCount(issues.errors.length)
          : issues.warnings.length ? t.app.warningCount(issues.warnings.length) : t.app.validationOk}
      </button>
    </div>
  </>
}
