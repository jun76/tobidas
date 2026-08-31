import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info, Plus, RefreshCw, Square, Trash2, Volume2 } from 'lucide-react'
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
import { DetailsDialog } from '../ui/DetailsDialog'
import { countAssetReferences } from '../operations/stateSummary'
import st from '../builder.module.css'

export function AssetsPanel() {
  const t = useT()
  const store = useBuilderStore()
  const dialogs = useDialogs()
  const addRef = useRef<HTMLInputElement>(null)
  const [replacing, setReplacing] = useState<Asset | null>(null)
  const [dragging, setDragging] = useState(false)
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [details, setDetails] = useState<Asset | null>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const existing = () => new Set(store.project.assets.map((asset) => asset.id))

  const addFiles = async (files: readonly File[]) => {
    for (const file of files) {
      try { store.addAsset(await fileToAsset(file, existing())) }
      catch (error) { dialogs.showMessage(t.dialog.errorTitle, String(error)) }
    }
  }
  const replace = async (file: File | undefined) => {
    if (!file || !replacing) return
    try {
      const asset = await fileToAsset(file, new Set())
      const sameFamily = replacing.type === 'video'
        ? asset.type === 'video'
        : replacing.type === 'audio'
          ? asset.type === 'audio'
          : asset.type === 'image' || asset.type === 'svg'
      if (!sameFamily) throw new Error(t.assets.unsupported(file.name))
      store.replaceAsset(replacing.id, { ...asset, id: replacing.id, name: replacing.name })
    } catch (error) { dialogs.showMessage(t.dialog.errorTitle, String(error)) }
    setReplacing(null)
  }
  /**
   * 選択中のプリセットが、掴めるものだけを残す。
   * 掴んでも落とせないものが並んでいると、置けない理由が操作から読めない。
   */
  const kind = assetKindForMode(store.placement)
  const visualAssets = kind === 'audio' ? [] : store.project.assets
    .filter((asset) => asset.type === 'image' || asset.type === 'svg' || asset.type === 'video')
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
      data-tobidas-kind="asset" data-tobidas-id={asset.id}
      onPointerDown={(event) => {
        if (!draggable || event.button !== 0 || (event.target as Element).closest('button,video')) return
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
        ? <AssetThumbnail asset={asset} />
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
      <button className={st.ghostBtn} data-tobidas-action="show-asset-details"
        aria-label={t.assets.details(asset.name)} title={t.assets.detailsHint}
        onClick={() => setDetails(asset)}><Icon as={Info} /></button>
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
    <input ref={addRef} hidden multiple type="file" aria-label={t.assets.load} accept={assetAccept('svg', 'image', 'audio', 'video')}
      onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? [])
        event.currentTarget.value = ''
        void addFiles(files)
      }} />
    <input ref={replaceRef} hidden type="file" aria-label={replacing ? t.assets.replace(replacing.name) : t.assets.replaceHint}
      accept={replacing?.type === 'audio'
        ? assetAccept('audio')
        : replacing?.type === 'video'
          ? assetAccept('video')
          : assetAccept('svg', 'image')}
      onChange={(event) => { void replace(event.target.files?.[0]); event.target.value = '' }} />
    </section>
    {details && <AssetDetails asset={details}
      references={countAssetReferences(store.project).get(details.id) ?? 0}
      onClose={() => setDetails(null)} />}
    {dragging && createPortal(<div className={st.assetDragShield} aria-hidden="true" />, document.body)}
  </>
}

function AssetDetails({ asset, references, onClose }: { asset: Asset; references: number; onClose: () => void }) {
  const t = useT()
  const [duration, setDuration] = useState(asset.duration)
  useEffect(() => {
    if (duration !== undefined || (asset.type !== 'audio' && asset.type !== 'video')) return
    const media = document.createElement(asset.type === 'audio' ? 'audio' : 'video')
    const src = asset.data instanceof Blob ? URL.createObjectURL(asset.data) : asset.data
    media.preload = 'metadata'
    media.src = src
    const loaded = () => { if (Number.isFinite(media.duration)) setDuration(media.duration) }
    media.addEventListener('loadedmetadata', loaded)
    return () => {
      media.removeEventListener('loadedmetadata', loaded)
      media.src = ''
      if (asset.data instanceof Blob) URL.revokeObjectURL(src)
    }
  }, [asset, duration])
  const bytes = asset.bytes ?? (asset.data instanceof Blob ? asset.data.size : undefined)
  return <DetailsDialog title={t.assets.details(asset.name)} kind="asset-details" onClose={onClose}>
    <dl className={st.detailsList} data-tobidas-id={asset.id}>
      <dt>{t.assets.assetId}</dt><dd>{asset.id}</dd>
      <dt>{t.assets.mime}</dt><dd>{asset.mime}</dd>
      <dt>{t.assets.bytes}</dt><dd>{bytes ?? '—'}</dd>
      <dt>{t.assets.references}</dt><dd>{references}</dd>
      <dt>{t.assets.duration}</dt><dd>{duration === undefined ? '—' : t.assets.seconds(duration.toFixed(2))}</dd>
    </dl>
  </DetailsDialog>
}

function AssetThumbnail({ asset }: { asset: Asset }) {
  const src = useMemo(() => {
    if (asset.data instanceof Blob) return URL.createObjectURL(asset.data)
    if (asset.type === 'svg') return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.data)}`
    return asset.data
  }, [asset.data, asset.type])
  useEffect(() => () => {
    if (asset.data instanceof Blob) window.setTimeout(() => URL.revokeObjectURL(src), 1000)
  }, [asset.data, src])
  if (asset.type === 'video') {
    return <video className={st.assetThumb} aria-label={asset.name} src={src}
      controls playsInline preload="metadata" />
  }
  return <img className={st.assetThumb} draggable={false} alt={asset.name} src={src} />
}

function metadata(asset: Asset) {
  const values: string[] = []
  if (asset.width && asset.height) values.push(`${asset.width}×${asset.height}px`)
  if (asset.duration !== undefined) values.push(t().assets.seconds(asset.duration.toFixed(2)))
  if (asset.bytes !== undefined) values.push(`${Math.round(asset.bytes / 1024)}KB`)
  return values.length ? values.join(' · ') : asset.mime
}
