import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Camera, Check, ChevronDown, LoaderCircle, Pencil, Play, Redo2, Undo2 } from 'lucide-react'
import { LOCALES, useLocaleStore, useT, type Locale } from '../i18n'
import { Icon, ICON } from '../../ui/Icon'
import { createLocalizedBookProject, useBuilderStore } from '../store'
import { supportsDirectoryPicker } from '../io/browserFiles'
import type { ImportResult } from '../io/packageImport'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useDialogs } from '../ui/DialogProvider'
import { requestElementDelete } from '../elementDelete'
import st from '../builder.module.css'

export function Toolbar({ onScreenshot }: { onScreenshot: () => Promise<void> }) {
  const t = useT()
  const store = useBuilderStore()
  const dialogs = useDialogs()
  const [confirmNew, setConfirmNew] = useState(false)
  const [screenshotState, setScreenshotState] = useState<'idle' | 'saving' | 'saved'>('idle')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement).tagName)) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        event.shiftKey ? store.redo() : store.undo()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') store.redo()
      else if (event.key.toLowerCase() === 'w') store.setGizmo('translate')
      else if (event.key.toLowerCase() === 'e') store.setGizmo('rotate')
      else if (event.key.toLowerCase() === 'r') store.setGizmo('scale')
      else if (event.key === 'Escape') store.select({ type: 'book' })
      else if (event.key === 'Delete') {
        // 直近に選んだものを消す。キーを選んだ状態で部品が消えると事故になる
        const key = store.selectedKey
        if (key) {
          event.preventDefault()
          store.removeTimelineKey(key.spreadId, key.trackId, key.keyId)
        } else if (store.selection.type === 'element') {
          event.preventDefault()
          requestElementDelete({ spreadId: store.selection.spreadId, elementId: store.selection.elementId })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  return (
    <div className={st.toolbar}>
      <button onClick={() => setConfirmNew(true)}>{t.toolbar.new}</button>
      {confirmNew && (
        <ConfirmDialog
          title={t.toolbar.newTitle}
          body={t.toolbar.newBody}
          okLabel={t.toolbar.newOk}
          onOk={() => store.setProject(createLocalizedBookProject(), 'new')}
          onClose={() => setConfirmNew(false)}
        />
      )}
      <OpenButton />
      <SaveButton />
      <ExportMenu />
      <button aria-label={t.toolbar.undo} title={t.toolbar.undoHint}
        onClick={store.undo} disabled={!store.undoStack.length}><Icon as={Undo2} size={ICON.bar} /></button>
      <button aria-label={t.toolbar.redo} title={t.toolbar.redoHint}
        onClick={store.redo} disabled={!store.redoStack.length}><Icon as={Redo2} size={ICON.bar} /></button>
      <span className={st.spacer} />
      <LocalePicker />
      <button
        aria-label={t.toolbar.screenshot}
        title={t.toolbar.screenshot}
        disabled={screenshotState === 'saving'}
        onClick={() => {
          setScreenshotState('saving')
          void onScreenshot()
            .then(() => {
              setScreenshotState('saved')
              window.setTimeout(() => setScreenshotState('idle'), 1400)
            })
            .catch((error) => {
              setScreenshotState('idle')
              dialogs.showMessage(t.toolbar.screenshotFailed, String(error))
            })
        }}
      >
        {screenshotState === 'saving' ? <Icon as={LoaderCircle} size={ICON.bar} className={st.spin} />
          : screenshotState === 'saved' ? <Icon as={Check} size={ICON.bar} />
            : <Icon as={Camera} size={ICON.bar} />}
      </button>
      <button className={store.mode === 'play' ? st.active : ''} onClick={() => store.setMode(store.mode === 'edit' ? 'play' : 'edit')}>
        {store.mode === 'edit'
          ? <><Icon as={Play} size={ICON.bar} />{t.toolbar.play}</>
          : <><Icon as={Pencil} size={ICON.bar} />{t.toolbar.edit}</>}
      </button>
    </div>
  )
}

/** 表示言語の切り替え。作品データではなく編集セッションの設定なので、書き出しには入らない */
function LocalePicker() {
  const t = useT()
  const { locale, setLocale } = useLocaleStore()
  return <select className={st.localePicker} aria-label={t.toolbar.language} title={t.toolbar.language}
    value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
    {LOCALES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
  </select>
}

function Dropdown({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => !ref.current?.contains(event.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return <span ref={ref} className={st.dropdown}>
    <button onClick={() => setOpen(!open)} aria-expanded={open}>{label}<Icon as={ChevronDown} size={ICON.bar} /></button>
    {open && <div className={st.dropdownMenu}>{children(() => setOpen(false))}</div>}
  </span>
}

/**
 * 作業フォルダを開く。作品はフォルダ (`project.json` + `assets/`) の一形式だけ。
 * ピッカーを持たないブラウザだけ、フォルダ選択の input へ落とす。
 */
function OpenButton() {
  const t = useT()
  const dialogs = useDialogs()
  const setProject = useBuilderStore((state) => state.setProject)
  const dirRef = useRef<HTMLInputElement>(null)
  const apply = (result: ImportResult) => {
    setProject(result.project, 'import')
    if (result.notices.length) dialogs.showMessage(t.dialog.importNoticeTitle, result.notices.join('\n'))
  }
  const run = async (work: () => Promise<ImportResult | 'aborted' | null>) => {
    try {
      const result = await work()
      if (result === null) dirRef.current?.click()
      else if (result !== 'aborted') apply(result)
    } catch (error) { dialogs.showMessage(t.dialog.errorTitle, String(error)) }
  }
  return <>
    <button title={t.toolbar.openHint} onClick={() =>
      void run(async () => (await import('../io/packageImport')).importPackageViaDirectoryPicker())}>
      {t.toolbar.open}
    </button>
    <input ref={dirRef} hidden type="file" {...({ webkitdirectory: '' } as object)} onChange={(event) => {
      const files = event.target.files
      if (files?.length) {
        void run(async () => (await import('../io/packageImport')).importPackageFileList(files))
      }
      event.target.value = ''
    }} />
  </>
}

/** 保存先フォルダへ `project.json` + `assets/` を書く。書ける口を持たないブラウザでは断る */
function SaveButton() {
  const t = useT()
  const dialogs = useDialogs()
  const project = useBuilderStore((state) => state.project)
  return <button title={t.toolbar.saveHint} onClick={() => {
    if (!supportsDirectoryPicker()) {
      dialogs.showMessage(t.dialog.unsupportedTitle, t.io.folderSaveUnsupported)
      return
    }
    void (async () => (await import('../io/packageExport')).exportPackageToDirectory(project))()
      .catch((error) => dialogs.showMessage(t.dialog.errorTitle, String(error)))
  }}>{t.toolbar.save}</button>
}

function ExportMenu() {
  const t = useT()
  const dialogs = useDialogs()
  const project = useBuilderStore((state) => state.project)
  return <Dropdown label={t.toolbar.export}>{(close) => {
    const run = (work: () => Promise<unknown>) => {
      close()
      void work().catch((error) => dialogs.showMessage(t.dialog.errorTitle, String(error)))
    }
    return <>
      <button onClick={() => run(async () => (await import('../io/siteExport')).exportSiteHtml(project))}>
        {t.toolbar.exportSiteHtml}
      </button>
      <button onClick={() => run(async () => (await import('../io/siteExport')).exportSiteZip(project))}>
        {t.toolbar.exportSiteZip}
      </button>
    </>
  }}</Dropdown>
}
