import { useEffect, useRef, useState } from 'react'
import { CircleAlert, TriangleAlert } from 'lucide-react'
import { Icon } from '../ui/Icon'
import packageJson from '../../package.json'
import { useT } from './i18n'
import { useBuilderStore } from './store'
import { loadCurrentProject } from './persistence/projectRepository'
import { CONTAINER_ELEMENTS_DELETE_REQUEST_EVENT, ELEMENT_DELETE_REQUEST_EVENT, SPREAD_DELETE_REQUEST_EVENT, type ContainerElementsDeleteRequest, type ElementDeleteRequest } from './elementDelete'
import { containerElementIds, elementDescendantIds, type RootParentType } from './hierarchy'
import { saveViewportImage } from './capture/saveViewportImage'
import { clampPanelWidth, loadPanelWidth, savePanelWidth } from './layout/panelSizing'
import { Toolbar } from './panels/Toolbar'
import { BookNavigator, PartPresets } from './panels/Hierarchy'
import { AssetsPanel } from './panels/AssetsPanel'
import { BookProperties, SelectionDetails } from './panels/Properties'
import { Viewport, viewportGlRef } from './Viewport'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { SplitStack } from './ui/SplitStack'
import { AiWorkspace } from './ai/AiWorkspace'
import { readAiMode, writeAiMode } from './ai/session'
import st from './builder.module.css'

function Splitter({ onDelta }: { onDelta: (delta: number) => void }) {
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

export default function App() {
  const t = useT()
  const setProject = useBuilderStore((state) => state.setProject)
  const projectSession = useBuilderStore((state) => state.projectSession)
  const mode = useBuilderStore((state) => state.mode)
  const [booted, setBooted] = useState(false)
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
  const [leftWidth, setLeftWidth] = useState(() => loadPanelWidth('left', 280))
  const [rightWidth, setRightWidth] = useState(() => loadPanelWidth('right', 320))
  const [aiMode, setAiModeState] = useState(readAiMode)

  const setAiMode = (enabled: boolean) => {
    setAiModeState(enabled)
    writeAiMode(enabled)
  }

  useEffect(() => { savePanelWidth('left', leftWidth) }, [leftWidth])
  useEffect(() => { savePanelWidth('right', rightWidth) }, [rightWidth])
  useEffect(() => {
    setPendingElementDelete(null)
    setPendingSpreadDelete(null)
    setPendingContainerDelete(null)
  }, [projectSession])
  useEffect(() => {
    let alive = true
    void loadCurrentProject().then((project) => {
      if (alive && project) setProject(project, 'idb')
      if (alive) setBooted(true)
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
      const descendantCount = elementDescendantIds(spread, elementId).size
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
    <Toolbar key={`toolbar-${projectSession}`} onScreenshot={screenshot} aiMode={aiMode} onAiModeChange={setAiMode} />
    {aiMode ? <AiWorkspace key={`ai-workspace-${projectSession}`} /> : <div className={st.main} key={`workspace-${projectSession}`}>
      {mode === 'edit' && <aside className={st.left} style={{ width: leftWidth, minWidth: leftWidth }}>
        <SplitStack storageKey="left" initial={[280, 210]} panes={[
          { key: 'navigator', label: t.app.panelNavigator, node: <BookNavigator /> },
          { key: 'presets', label: t.app.panelPresets, node: <PartPresets /> },
          { key: 'assets', label: t.app.panelAssets, node: <AssetsPanel /> },
        ]} />
      </aside>}
      {mode === 'edit' && <Splitter onDelta={(delta) => setLeftWidth((value) => clampPanelWidth(value + delta))} />}
      <Viewport />
      {mode === 'edit' && <Splitter onDelta={(delta) => setRightWidth((value) => clampPanelWidth(value - delta))} />}
      {mode === 'edit' && <aside className={st.right} style={{ width: rightWidth, minWidth: rightWidth }}>
        <SplitStack storageKey="right" initial={[300]} panes={[
          { key: 'book', label: 'BOOK', node: <BookProperties /> },
          { key: 'detail', label: t.app.panelDetail, node: <SelectionDetails /> },
        ]} />
      </aside>}
    </div>}
    <StatusBar key={`status-${projectSession}`} />
  </div>
}

function StatusBar() {
  const t = useT()
  const { project, source, issues } = useBuilderStore()
  const [open, setOpen] = useState(false)
  return <>
    {open && <div className={st.issueList} onClick={() => setOpen(false)}>
      {issues.errors.map((issue, index) => <div className={st.err} key={`e${index}`}><Icon as={CircleAlert} />{issue}</div>)}
      {issues.warnings.map((issue, index) => <div className={st.warn} key={`w${index}`}><Icon as={TriangleAlert} />{issue}</div>)}
      {!issues.errors.length && !issues.warnings.length && <div className={st.ok}>{t.app.noIssues}</div>}
    </div>}
    <div className={st.status}>
      <span>{project.name}</span><span>tobidas v{packageJson.version}</span>
      <span>{source === 'import' ? t.app.sourceImport : source === 'idb' ? t.app.sourceRestored : t.app.sourceNew}</span>
      <span className={st.spacer} />
      <span className={issues.errors.length ? st.err : issues.warnings.length ? st.warn : st.ok} onClick={() => setOpen(!open)}>
        {issues.errors.length ? t.app.errorCount(issues.errors.length)
          : issues.warnings.length ? t.app.warningCount(issues.warnings.length) : t.app.validationOk}
      </span>
    </div>
  </>
}
