import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Bot, Check, ChevronDown, Copy as CopyIcon, Pencil, Play, Redo2, Undo2 } from 'lucide-react'
import { LOCALES, useLocaleStore, useT, type Locale } from '../i18n'
import { Icon, ICON } from '../../ui/Icon'
import { createLocalizedBookProject, useBuilderStore } from '../store'
import { supportsDirectoryPicker } from '../io/browserFiles'
import type { ImportResult } from '../io/packageImport'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useDialogs } from '../ui/DialogProvider'
import { requestElementDelete } from '../elementDelete'
import st from '../builder.module.css'
import { unlockVideoAudio } from '../../runtime/videoAudio'
import { getWebMcpModelContext } from '../ai/webmcpTypes'

export function Toolbar({ aiMode, onAiModeChange }: {
  aiMode: boolean
  onAiModeChange: (enabled: boolean) => void
}) {
  const t = useT()
  const store = useBuilderStore()
  const [confirmNew, setConfirmNew] = useState(false)

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

  return <>
    <div className={st.toolbar}>
      <div className={st.toolbarDesktop}>
        <button onClick={() => setConfirmNew(true)}>{t.toolbar.new}</button>
        <OpenButton />
        <SaveButton />
        <ExportMenu />
        <button aria-label={t.toolbar.undo} title={t.toolbar.undoHint}
          onClick={store.undo} disabled={!store.undoStack.length}><Icon as={Undo2} size={ICON.bar} /></button>
        <button aria-label={t.toolbar.redo} title={t.toolbar.redoHint}
          onClick={store.redo} disabled={!store.redoStack.length}><Icon as={Redo2} size={ICON.bar} /></button>
        <span className={st.spacer} />
        <WebMcpHint />
        <AiModeButton aiMode={aiMode} onAiModeChange={onAiModeChange} />
        <LocalePicker />
        <ModeButton />
      </div>

      <div className={st.toolbarMobile}>
        <Dropdown label={t.toolbar.mobileMenu} title={t.toolbar.mobileMenuHint}>{(close) => <div className={st.toolbarMobileMenu}>
          <section className={st.toolbarMenuSection}>
            <h2>{t.toolbar.fileActions}</h2>
            <button onClick={() => { close(); setConfirmNew(true) }}>{t.toolbar.new}</button>
            <OpenButton onInvoke={close} />
            <SaveButton onInvoke={close} />
            <ExportMenu inline onClose={close} />
          </section>
          <section className={st.toolbarMenuSection}>
            <h2>{t.toolbar.editActions}</h2>
            <button onClick={() => { close(); store.undo() }} disabled={!store.undoStack.length}>
              <Icon as={Undo2} size={ICON.bar} />{t.toolbar.undo}
            </button>
            <button onClick={() => { close(); store.redo() }} disabled={!store.redoStack.length}>
              <Icon as={Redo2} size={ICON.bar} />{t.toolbar.redo}
            </button>
          </section>
          <section className={st.toolbarMenuSection}>
            <h2>{t.toolbar.viewActions}</h2>
            <LocalePicker />
          </section>
        </div>}</Dropdown>
        <WebMcpHint />
        <AiModeButton aiMode={aiMode} onAiModeChange={onAiModeChange} />
        <ModeButton />
      </div>
    </div>
    {confirmNew && (
      <ConfirmDialog
        title={t.toolbar.newTitle}
        body={t.toolbar.newBody}
        okLabel={t.toolbar.newOk}
        onOk={() => store.setProject(createLocalizedBookProject(), 'new')}
        onClose={() => setConfirmNew(false)}
      />
    )}
  </>
}

function AiModeButton({ aiMode, onAiModeChange }: { aiMode: boolean; onAiModeChange: (enabled: boolean) => void }) {
  const t = useT()
  return <button type="button" className={aiMode ? st.active : ''} aria-pressed={aiMode}
    aria-label={aiMode ? t.toolbar.aiModeExit : t.toolbar.aiMode}
    title={aiMode ? t.toolbar.aiModeExit : t.toolbar.aiModeHint} onClick={() => onAiModeChange(!aiMode)}>
    <Icon as={Bot} size={ICON.bar} />{aiMode ? t.toolbar.aiModeExit : t.toolbar.aiMode}
  </button>
}

function WebMcpHint() {
  const t = useT()
  const available = getWebMcpModelContext() !== null
  const [open, setOpen] = useState(false)
  const hideTimer = useRef<number | undefined>(undefined)
  const show = () => {
    if (hideTimer.current !== undefined) window.clearTimeout(hideTimer.current)
    setOpen(true)
  }
  const hideLater = () => {
    if (hideTimer.current !== undefined) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setOpen(false), 300)
  }
  useEffect(() => () => {
    if (hideTimer.current !== undefined) window.clearTimeout(hideTimer.current)
  }, [])
  return <div className={`${st.webMcpHint} ${available ? st.webMcpAvailable : st.webMcpUnavailable}`}
    data-tobidas-kind="webmcp-hint" data-tobidas-webmcp={available ? 'available' : 'unavailable'}
    onMouseEnter={show} onMouseLeave={hideLater}
    onFocus={(event) => { if (event.currentTarget === event.target) show() }}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hideLater()
    }}>
    <span className={st.webMcpLabel} tabIndex={0} aria-label={t.toolbar.webMcpHint} title={t.toolbar.webMcpHint}>
      {available ? t.toolbar.webMcpAvailable : t.toolbar.webMcpUnavailable}
    </span>
    <div className={`${st.webMcpPopover} ${open ? st.webMcpPopoverOpen : ''}`} role="dialog"
      aria-label={t.toolbar.webMcpHint} onMouseEnter={show} onMouseLeave={hideLater}>
      <p>{available ? t.toolbar.webMcpAvailableHint : t.toolbar.webMcpUnavailableHint}</p>
      {!available && <>
        <p>{t.toolbar.webMcpSetupHint}</p>
        <dl>
          <dt>{t.toolbar.webMcpChromium}</dt>
          <dd><WebMcpCommand command={t.toolbar.webMcpChromiumOption} /></dd>
          <dt>{t.toolbar.webMcpFirefox}</dt>
          <dd><WebMcpCommand command={t.toolbar.webMcpFirefoxOption} /></dd>
        </dl>
      </>}
    </div>
  </div>
}

function WebMcpCommand({ command }: { command: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => {
    if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current)
  }, [])
  const copy = async () => {
    if (!navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // 権限やブラウザ実装の都合でコピーできない場合は表示を変えない。
    }
  }
  return <div className={st.webMcpCommand}>
    <code>{command}</code>
    <button type="button" className={st.webMcpCopyButton} onClick={() => void copy()}
      aria-label={copied ? t.toolbar.webMcpCopied : t.toolbar.webMcpCopy}
      title={copied ? t.toolbar.webMcpCopied : t.toolbar.webMcpCopy}>
      <Icon as={copied ? Check : CopyIcon} size={ICON.row} />
    </button>
  </div>
}

function ModeButton() {
  const t = useT()
  const store = useBuilderStore()
  return <button className={store.mode === 'play' ? st.active : ''} onClick={() => {
    if (store.mode === 'edit') unlockVideoAudio()
    store.setMode(store.mode === 'edit' ? 'play' : 'edit')
  }}>
    {store.mode === 'edit'
      ? <><Icon as={Play} size={ICON.bar} />{t.toolbar.play}</>
      : <><Icon as={Pencil} size={ICON.bar} />{t.toolbar.edit}</>}
  </button>
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

function Dropdown({ label, title, children }: { label: string; title?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => !ref.current?.contains(event.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return <span ref={ref} className={st.dropdown}>
    <button title={title} onClick={() => setOpen(!open)} aria-expanded={open}>{label}<Icon as={ChevronDown} size={ICON.bar} /></button>
    {open && <div className={st.dropdownMenu}>{children(() => setOpen(false))}</div>}
  </span>
}

/**
 * 作業フォルダを開く。作品はフォルダ (`project.json` + `assets/`) の一形式だけ。
 * ピッカーを持たないブラウザだけ、フォルダ選択の input へ落とす。
 */
function OpenButton({ onInvoke }: { onInvoke?: () => void } = {}) {
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
    <button title={t.toolbar.openHint} onClick={() => {
      onInvoke?.()
      void run(async () => (await import('../io/packageImport')).importPackageViaDirectoryPicker())
    }}>
      {t.toolbar.open}
    </button>
    <input ref={dirRef} hidden type="file" aria-label={t.toolbar.open} {...({ webkitdirectory: '' } as object)} onChange={(event) => {
      const files = event.target.files
      if (files?.length) {
        void run(async () => (await import('../io/packageImport')).importPackageFileList(files))
      }
      event.target.value = ''
    }} />
  </>
}

/** 保存先フォルダへ `project.json` + `assets/` を書く。書ける口を持たないブラウザでは断る */
function SaveButton({ onInvoke }: { onInvoke?: () => void } = {}) {
  const t = useT()
  const dialogs = useDialogs()
  const project = useBuilderStore((state) => state.project)
  return <button title={t.toolbar.saveHint} onClick={() => {
    onInvoke?.()
    if (!supportsDirectoryPicker()) {
      dialogs.showMessage(t.dialog.unsupportedTitle, t.io.folderSaveUnsupported)
      return
    }
    void (async () => (await import('../io/packageExport')).exportPackageToDirectory(project))()
      .catch((error) => dialogs.showMessage(t.dialog.errorTitle, String(error)))
  }}>{t.toolbar.save}</button>
}

function ExportMenu({ inline = false, onClose }: { inline?: boolean; onClose?: () => void } = {}) {
  const t = useT()
  const dialogs = useDialogs()
  const project = useBuilderStore((state) => state.project)
  const [confirmVideoHtml, setConfirmVideoHtml] = useState(false)
  const run = (work: () => Promise<unknown>) => {
    void work().catch((error) => dialogs.showMessage(t.dialog.errorTitle, String(error)))
  }
  const videoBytes = project.assets
    .filter((asset) => asset.type === 'video')
    .reduce((total, asset) => total + (asset.bytes ?? (asset.data instanceof Blob ? asset.data.size : 0)), 0)
  const estimatedMegabytes = Math.ceil((videoBytes * 4 / 3 + 1_500_000) / 1024 / 1024)
  const actions = (close: () => void) => {
    const runAndClose = (work: () => Promise<unknown>) => {
      close()
      run(work)
    }
    return <>
        <button onClick={() => {
          if (videoBytes) {
            close()
            setConfirmVideoHtml(true)
          } else {
            runAndClose(async () => (await import('../io/siteExport')).exportSiteHtml(project))
          }
        }}>
          {t.toolbar.exportSiteHtml}
        </button>
        <button onClick={() => runAndClose(async () => (await import('../io/siteExport')).exportSiteZip(project))}>
          {t.toolbar.exportSiteZip}
        </button>
    </>
  }
  return <>
    {inline
      ? <div className={st.toolbarMenuSubgroup}>
        <h3>{t.toolbar.export}</h3>
        {actions(onClose ?? (() => {}))}
      </div>
      : <Dropdown label={t.toolbar.export}>{actions}</Dropdown>}
    {confirmVideoHtml && <ConfirmDialog
      title={t.toolbar.videoHtmlTitle}
      body={t.toolbar.videoHtmlBody(estimatedMegabytes)}
      okLabel={t.toolbar.videoHtmlOk}
      onOk={() => {
        setConfirmVideoHtml(false)
        run(async () => (await import('../io/siteExport')).exportSiteHtml(project))
      }}
      onClose={() => setConfirmVideoHtml(false)}
    />}
  </>
}
