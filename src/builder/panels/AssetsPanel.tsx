import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, RefreshCw, Square, Trash2, Volume2 } from 'lucide-react'
import { Icon } from '../../ui/Icon'
import type { Asset } from '../../schema/assets'
import { useT, t } from '../i18n'
import { notifyAssetPointerDrag } from '../assetPointerDrag'
import { builderBank } from '../audio'
import { assetAccept } from '../../package/model'
import { assetKindForMode } from '../presets'
import { useBuilderStore } from '../store'
import { fileToAsset } from '../assets/ingest'
import { useDialogs } from '../ui/DialogProvider'
import st from '../builder.module.css'

export function AssetsPanel() {
  const t = useT()
  const store = useBuilderStore()
  const dialogs = useDialogs()
  const addRef = useRef<HTMLInputElement>(null)
  const [replacing, setReplacing] = useState<Asset | null>(null)
  const [dragging, setDragging] = useState(false)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const existing = () => new Set(store.project.assets.map((asset) => asset.id))

  const addFiles = async (files: FileList | null) => {
    if (!files) return
    for (const file of files) {
      try { store.addAsset(await fileToAsset(file, existing())) }
      catch (error) { dialogs.showMessage(t.dialog.errorTitle, String(error)) }
    }
  }
  const replace = async (file: File | undefined) => {
    if (!file || !replacing) return
    try {
      const asset = await fileToAsset(file, new Set())
      store.replaceAsset(replacing.id, { ...asset, id: replacing.id, name: replacing.name })
    } catch (error) { dialogs.showMessage(t.dialog.errorTitle, String(error)) }
    setReplacing(null)
  }
  /**
   * 選択中のプリセットが、掴めるものだけを残す。
   * 掴んでも落とせないものが並んでいると、置けない理由が操作から読めない。
   */
  const kind = assetKindForMode(store.placement)
  const visualAssets = kind === 'audio' ? [] : store.project.assets.filter((asset) => asset.type === 'image' || asset.type === 'svg')
  const audioAssets = kind === 'image' ? [] : store.project.assets.filter((asset) => asset.type === 'audio')
  const moveAsset = (assetId: string, clientX: number, clientY: number) => {
    notifyAssetPointerDrag({ assetId, clientX, clientY, phase: 'move' })
  }
  const finishAsset = (assetId: string, clientX: number, clientY: number) => {
    setDragging(false)
    notifyAssetPointerDrag({ assetId, clientX, clientY, phase: 'drop' })
  }
  const cancelAsset = (assetId: string, clientX: number, clientY: number) => {
    setDragging(false)
    notifyAssetPointerDrag({ assetId, clientX, clientY, phase: 'cancel' })
  }
  const assetRow = (asset: Asset) => {
    // 掴めるのは、いま選んでいるプリセットが受け取れる種類だけ
    const draggable = asset.type === 'audio' ? kind === 'audio' : kind === 'image'
    return <div key={asset.id} className={`${st.assetRow} ${draggable ? st.assetDraggable : ''} ${dragging && draggable ? st.assetDragging : ''}`}
      onPointerDown={(event) => {
        if (!draggable || event.button !== 0 || (event.target as Element).closest('button')) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
        moveAsset(asset.id, event.clientX, event.clientY)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) moveAsset(asset.id, event.clientX, event.clientY)
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        event.currentTarget.releasePointerCapture(event.pointerId)
        finishAsset(asset.id, event.clientX, event.clientY)
      }}
      onPointerCancel={(event) => cancelAsset(asset.id, event.clientX, event.clientY)}>
      {asset.type !== 'audio'
        ? <img className={st.assetThumb} draggable={false} src={asset.type === 'svg' ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.data)}` : asset.data} />
        : <button className={`${st.assetThumb} ${st.assetThumbButton}`}
          aria-label={previewing === asset.id ? t.assets.stopPreview(asset.name) : t.assets.preview(asset.name)}
          title={t.assets.previewHint}
          onClick={() => {
            setPreviewing(asset.id)
            void builderBank.togglePreview(asset, () => setPreviewing(builderBank.previewingId))
              .then(() => setPreviewing(builderBank.previewingId))
          }}>
          <Icon as={previewing === asset.id ? Square : Volume2} size={18} /></button>}
      <div className={st.assetName}>
        <div>{asset.name}</div>
        <div className={st.hintSmall}>{asset.type} · {metadata(asset)}</div>
      </div>
      <button className={`${st.ghostBtn} ${st.ghostOn}`}
        aria-label={t.assets.replace(asset.name)} title={t.assets.replaceHint}
        onClick={() => { setReplacing(asset); setTimeout(() => replaceRef.current?.click()) }}><Icon as={RefreshCw} /></button>
      <button className={`${st.ghostBtn} ${st.ghostDanger}`}
        aria-label={t.assets.remove(asset.name)} title={t.assets.removeHint}
        onClick={() => store.removeAsset(asset.id)}><Icon as={Trash2} /></button>
    </div>
  }

  return <>
    <section className={st.panel} style={{ flex: 1 }}>
    <div className={st.panelTitle}>{t.app.panelAssets} <button onClick={() => addRef.current?.click()}><Icon as={Plus} />{t.assets.load}</button></div>
    {kind !== 'audio' && <>
      <div className={st.assetSectionTitle}>{t.assets.images}</div>
      <div className={st.hintSmall}>{t.assets.dragHint}</div>
      {visualAssets.map(assetRow)}
      {!visualAssets.length && <div className={st.assetEmpty}>{t.assets.noImages}</div>}
    </>}
    {kind !== 'image' && <>
      <div className={st.assetSectionTitle}>{t.assets.audio}</div>
      {audioAssets.map(assetRow)}
      {!audioAssets.length && <div className={st.assetEmpty}>{t.assets.noAudio}</div>}
    </>}
    {!store.project.assets.length && <div className={st.hintSmall}>{t.assets.formats}</div>}
    <input ref={addRef} hidden multiple type="file" accept={assetAccept('svg', 'image', 'audio')}
      onChange={(event) => { void addFiles(event.target.files); event.target.value = '' }} />
    <input ref={replaceRef} hidden type="file"
      accept={replacing?.type === 'audio' ? assetAccept('audio') : assetAccept('svg', 'image')}
      onChange={(event) => { void replace(event.target.files?.[0]); event.target.value = '' }} />
    </section>
    {dragging && createPortal(<div className={st.assetDragShield} aria-hidden="true" />, document.body)}
  </>
}

function metadata(asset: Asset) {
  if (asset.width && asset.height) return `${asset.width}×${asset.height}px`
  if (asset.duration !== undefined) return t().assets.seconds(asset.duration.toFixed(2))
  if (asset.bytes !== undefined) return `${Math.round(asset.bytes / 1024)}KB`
  return asset.mime
}
