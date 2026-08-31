import { useState, type FormEvent } from 'react'
import { placeAssetCommand } from '../operations/commands'
import { publishOperationResult } from '../operations/result'
import type { VisualPresetId } from '../presets'
import { useBuilderStore } from '../store'
import { useT } from '../i18n'
import { FormDialog } from '../ui/FormDialog'
import st from '../builder.module.css'

type AssetPreset = Extract<VisualPresetId, 'paper-stack' | 'bottom-upright' | 'depth-layer'>

export function PrecisionPlacement({ onClose }: { onClose: () => void }) {
  const t = useT()
  const store = useBuilderStore()
  const visualAssets = store.project.assets.filter((asset) => ['image', 'svg', 'video'].includes(asset.type))
  const selectedSide = store.selection.type === 'page' ? store.selection.side : 'right'
  const [spreadId, setSpreadId] = useState(store.activeSpreadId)
  const [side, setSide] = useState<'left' | 'right'>(selectedSide)
  const [assetId, setAssetId] = useState(visualAssets[0]?.id ?? '')
  const [presetId, setPresetId] = useState<AssetPreset>('paper-stack')
  const [u, setU] = useState(.5)
  const [v, setV] = useState(.5)
  const [error, setError] = useState<string>()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = publishOperationResult(placeAssetCommand({ spreadId, side, assetId, presetId, u, v }))
    if (!result.ok) {
      setError([result.message, ...Object.entries(result.fieldErrors).map(([field, message]) => `${field}: ${message}`)].join(' '))
      return
    }
    onClose()
  }

  return <FormDialog title={t.presets.precisionPlacement} submitLabel={t.presets.place}
    kind="precision-placement-form" toolName="tobidas-place-asset-form" toolDescription={t.presets.precisionPlacementHint}
    error={error} onSubmit={submit} onClose={onClose}>
    <div>
      <label className={st.dialogField}>{t.operations.spread}<select autoFocus value={spreadId} onChange={(event) => setSpreadId(event.target.value)}>
        {store.project.book.spreads.map((spread) => <option key={spread.id} value={spread.id}>{spread.name}</option>)}
      </select></label>
      <label className={st.dialogField}>{t.operations.side}<select value={side} onChange={(event) => setSide(event.target.value as 'left' | 'right')}>
        <option value="left">{t.operations.leftPage}</option><option value="right">{t.operations.rightPage}</option>
      </select></label>
      <label className={st.dialogField}>{t.operations.preset}<select value={presetId} onChange={(event) => setPresetId(event.target.value as AssetPreset)}>
        {(['paper-stack', 'bottom-upright', 'depth-layer'] as const).map((id) => <option key={id} value={id}>{t.presets[id]}</option>)}
      </select></label>
      <label className={st.dialogField}>{t.operations.asset}<select value={assetId} onChange={(event) => setAssetId(event.target.value)}>
        {!visualAssets.length && <option value="">{t.assets.noImages}</option>}
        {visualAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
      </select></label>
      <label className={st.dialogField}>{t.operations.normalizedU}<input type="number" min="0" max="1" step="0.01" value={u} onChange={(event) => setU(Number(event.target.value))} /></label>
      <label className={st.dialogField}>{t.operations.normalizedV}<input type="number" min="0" max="1" step="0.01" value={v} onChange={(event) => setV(Number(event.target.value))} /></label>
    </div>
  </FormDialog>
}
