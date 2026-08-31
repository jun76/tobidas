import { useMemo, useState, type FormEvent } from 'react'
import {
  COLOR_PROPERTIES,
  DISCRETE_PROPERTIES,
  NUMBER_PROPERTIES,
  VEC3_PROPERTIES,
  type TimelineProperty,
  type TimelineTarget,
  type TimelineValue,
} from '../../schema/timeline'
import {
  addTimelineKeyCommand,
  timelinePropertiesForTarget,
} from '../operations/commands'
import { publishOperationResult } from '../operations/result'
import { useBuilderStore } from '../store'
import { useT } from '../i18n'
import { FormDialog } from '../ui/FormDialog'
import st from '../builder.module.css'

type TargetOption = { value: string; label: string; target: TimelineTarget }

export function TimelineKeyDialog({ spreadId, initialTime, onClose }: {
  spreadId: string
  initialTime: number
  onClose: () => void
}) {
  const t = useT()
  const store = useBuilderStore()
  const spread = store.project.book.spreads.find((item) => item.id === spreadId)!
  const targets = useMemo<TargetOption[]>(() => [
    { value: 'environment', label: t.timeline.environmentTarget, target: { type: 'environment' } },
    { value: 'camera', label: t.timeline.cameraTarget, target: { type: 'camera' } },
    ...spread.elements.map((element) => ({
      value: `element:${element.id}`,
      label: `${t.timeline.elementTarget}: ${element.name}`,
      target: { type: 'element' as const, elementId: element.id },
    })),
    ...store.project.assets.filter((asset) => asset.type === 'audio').map((asset) => ({
      value: `sound:${asset.id}`,
      label: `${t.timeline.soundTarget}: ${asset.name}`,
      target: { type: 'sound' as const, assetId: asset.id },
    })),
  ], [spread.elements, store.project.assets, t])
  const selectedElement = store.selection.type === 'element' && store.selection.spreadId === spreadId
    ? `element:${store.selection.elementId}`
    : 'environment'
  const [targetValue, setTargetValue] = useState(targets.some((item) => item.value === selectedElement) ? selectedElement : targets[0].value)
  const target = targets.find((item) => item.value === targetValue)?.target ?? targets[0].target
  const properties = timelinePropertiesForTarget(target)
  const [property, setProperty] = useState<TimelineProperty>(properties[0])
  const activeProperty = properties.includes(property) ? property : properties[0]
  const [time, setTime] = useState(initialTime)
  const [valueText, setValueText] = useState(defaultValueText(activeProperty, store.project.assets))
  const [ease, setEase] = useState<'linear' | 'easeInOut' | 'hold'>('linear')
  const [error, setError] = useState<string>()

  const chooseTarget = (value: string) => {
    const next = targets.find((item) => item.value === value)?.target ?? targets[0].target
    const nextProperty = timelinePropertiesForTarget(next)[0]
    setTargetValue(value)
    setProperty(nextProperty)
    setValueText(defaultValueText(nextProperty, store.project.assets))
  }
  const chooseProperty = (value: TimelineProperty) => {
    setProperty(value)
    setValueText(defaultValueText(value, store.project.assets))
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = parseTimelineValue(activeProperty, valueText)
    const result = publishOperationResult(addTimelineKeyCommand({
      spreadId,
      target,
      property: activeProperty,
      time,
      value,
      ease: DISCRETE_PROPERTIES.has(activeProperty) ? 'hold' : ease,
    }))
    if (!result.ok) {
      setError([result.message, ...Object.entries(result.fieldErrors).map(([field, message]) => `${field}: ${message}`)].join(' '))
      return
    }
    onClose()
  }

  return <FormDialog title={t.timeline.addKeyExplicit} submitLabel={t.timeline.addKeyExplicit}
    kind="timeline-key-form" error={error} onSubmit={submit} onClose={onClose}>
    <label className={st.dialogField}>{t.operations.timelineTarget}<select autoFocus value={targetValue} onChange={(event) => chooseTarget(event.target.value)}>
      {targets.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select></label>
    <label className={st.dialogField}>{t.operations.timelineProperty}<select value={activeProperty} onChange={(event) => chooseProperty(event.target.value as TimelineProperty)}>
      {properties.map((item) => <option key={item} value={item}>{item}</option>)}
    </select></label>
    <label className={st.dialogField}>{t.operations.timelineTime}<input type="number" min="0" max={spread.sequence.holdSeconds}
      step="0.01" value={time} onChange={(event) => setTime(Number(event.target.value))} /></label>
    <TimelineValueField property={activeProperty} value={valueText} onChange={setValueText}
      visualAssets={store.project.assets.filter((asset) => ['image', 'svg', 'video'].includes(asset.type)).map((asset) => [asset.id, asset.name])} />
    {!DISCRETE_PROPERTIES.has(activeProperty) && <label className={st.dialogField}>{t.timeline.interpolation}<select value={ease} onChange={(event) => setEase(event.target.value as typeof ease)}>
      <option value="linear">linear</option><option value="easeInOut">easeInOut</option>
    </select></label>}
  </FormDialog>
}

function TimelineValueField({ property, value, onChange, visualAssets }: {
  property: TimelineProperty
  value: string
  onChange: (value: string) => void
  visualAssets: Array<[string, string]>
}) {
  const t = useT()
  if (property === 'visual.image') return <label className={st.dialogField}>{t.operations.timelineValue}<select value={value} onChange={(event) => onChange(event.target.value)}>
    {visualAssets.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
  </select></label>
  if (DISCRETE_PROPERTIES.has(property)) return <label className={st.dialogCheck}>
    <input type="checkbox" checked={value === 'true'} onChange={(event) => onChange(String(event.target.checked))} />{t.operations.timelineValue}
  </label>
  if (COLOR_PROPERTIES.has(property)) return <label className={st.dialogField}>{t.operations.timelineValue}<input type="color" value={value} onChange={(event) => onChange(event.target.value)} /></label>
  return <label className={st.dialogField}>{t.operations.timelineValue}<input type="text" value={value} onChange={(event) => onChange(event.target.value)}
    inputMode={NUMBER_PROPERTIES.has(property) || VEC3_PROPERTIES.has(property) ? 'decimal' : undefined} /></label>
}

function defaultValueText(property: TimelineProperty, assets: ReturnType<typeof useBuilderStore.getState>['project']['assets']): string {
  if (VEC3_PROPERTIES.has(property)) return '0, 0, 0'
  if (COLOR_PROPERTIES.has(property)) return '#ffffff'
  if (property === 'visual.image') return assets.find((asset) => ['image', 'svg', 'video'].includes(asset.type))?.id ?? ''
  if (DISCRETE_PROPERTIES.has(property)) return property === 'cue' ? 'true' : 'false'
  return '0'
}

function parseTimelineValue(property: TimelineProperty, value: string): TimelineValue {
  if (VEC3_PROPERTIES.has(property)) return value.split(',').map((part) => Number(part.trim())) as [number, number, number]
  if (NUMBER_PROPERTIES.has(property)) return Number(value)
  if (DISCRETE_PROPERTIES.has(property) && property !== 'visual.image') return value === 'true'
  return value
}
