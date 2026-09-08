import { useEffect, useState } from 'react'
import type { Asset } from '../../schema/assets'
import type { PartBinding, PartDefinitions, PartInput, PartMaterial, PartNode, PartReference } from '../../parts/schema'
import { builtinPart } from '../../parts/catalog'
import { useT, t } from '../i18n'
import st from './parts.module.css'

export function TextField({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const props = { 'aria-label': label, value: draft, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: () => { if (draft !== value) onChange(draft) } }
  return <label className={st.field}><span>{label}</span>{multiline ? <textarea {...props} rows={3} /> : <input {...props} />}</label>
}
export function NumberField({ label, value, onChange, min, max, step = .05 }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return <label className={st.field}><span>{label}</span><input type="number" aria-label={label} value={draft} min={min} max={max} step={step}
    onChange={(event) => setDraft(event.target.value)} onBlur={() => {
      const number = Number(draft)
      if (draft.trim() && Number.isFinite(number) && number !== value) onChange(number)
      else setDraft(String(value))
    }} /></label>
}
export function MaterialFields({ value, assets, onChange }: { value: PartMaterial; assets: Asset[]; onChange: (material: PartMaterial) => void }) {
  const t = useT().parts
  return <div className={st.fields}>
    <label className={st.field}><span>{t.color}</span><input type="color" aria-label={t.color} value={value.color ?? '#e3b476'} onChange={(event) => onChange({ ...value, color: event.target.value })} /></label>
    {(['image', 'backImage'] as const).map((key) => <label className={st.field} key={key}><span>{t[key]}</span>
      <select aria-label={t[key]} value={value[key] ?? ''} onChange={(event) => onChange({ ...value, [key]: event.target.value || undefined })}>
        <option value="">{t.noImage}</option>{assets.filter((asset) => ['image', 'svg'].includes(asset.type)).map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
      </select></label>)}
    <TextField label={t.text} multiline value={value.text ?? ''} onChange={(text) => onChange({ ...value, text })} />
    <label className={st.field}><span>{t.textColor}</span><input type="color" aria-label={t.textColor} value={value.textColor ?? '#322719'} onChange={(event) => onChange({ ...value, textColor: event.target.value })} /></label>
  </div>
}
export const parameterLabel = (key: string) => t().parts.parameters[key as keyof ReturnType<typeof t>['parts']['parameters']] ?? key
export const portLabel = (key: string) => t().parts.ports[key as keyof ReturnType<typeof t>['parts']['ports']] ?? key
export function referenceName(reference: PartReference, definitions: PartDefinitions): string {
  return 'builtin' in reference ? t().parts.names[reference.builtin as keyof ReturnType<typeof t>['parts']['names']] ?? reference.builtin
    : definitions[reference.custom]?.name ?? reference.custom.slice(0, 8)
}
export function referencePorts(reference: PartReference, definitions: PartDefinitions, seen: string[] = []): { name: string; kind: 'surface' | 'fold-pair' }[] {
  try {
    if ('builtin' in reference) {
      const spec = builtinPart(reference.builtin, reference.version)
      return [...spec.surfaces.map((name) => ({ name, kind: 'surface' as const })), ...spec.pairs.map((name) => ({ name, kind: 'fold-pair' as const }))]
    }
    const definition = definitions[reference.custom]
    if (!definition || seen.includes(reference.custom)) return []
    return Object.entries(definition.outputs).flatMap(([name, binding]) => {
      if (binding.type === 'input') return [{ name, kind: binding.face ? 'surface' as const : definition.input.kind }]
      if (binding.type === 'pair') return [{ name, kind: 'fold-pair' as const }]
      const node = definition.nodes.find((item) => item.id === binding.nodeId)
      const port = node && referencePorts(node.definition, definitions, [...seen, reference.custom]).find((item) => item.name === binding.portId)
      return port ? [{ name, kind: port.kind }] : []
    })
  } catch { return [] }
}
export interface MountOption { label: string; binding: PartBinding; kind: 'surface' | 'fold-pair' }
export function mountOptions(nodes: PartNode[], definitions: PartDefinitions, input?: PartInput, excludeId?: string): MountOption[] {
  const labels = t().parts
  const options: MountOption[] = input ? input.kind === 'fold-pair' ? [
    { label: labels.inputPair, binding: { type: 'input' }, kind: 'fold-pair' },
    { label: labels.inputA, binding: { type: 'input', face: 'a' }, kind: 'surface' },
    { label: labels.inputB, binding: { type: 'input', face: 'b' }, kind: 'surface' },
  ] : [{ label: labels.inputSurface, binding: { type: 'input' }, kind: 'surface' }] : [
    { label: labels.gutter, binding: { type: 'output', nodeId: '$book', portId: 'gutter' }, kind: 'fold-pair' },
    { label: labels.left, binding: { type: 'output', nodeId: '$book', portId: 'left-page' }, kind: 'surface' },
    { label: labels.right, binding: { type: 'output', nodeId: '$book', portId: 'right-page' }, kind: 'surface' },
  ]
  for (const node of nodes) if (node.id !== excludeId) for (const port of referencePorts(node.definition, definitions)) {
    options.push({ label: `${node.name} / ${portLabel(port.name)}`, binding: { type: 'output', nodeId: node.id, portId: port.name }, kind: port.kind })
  }
  return options
}
export function MountField({ value, options, kind, onChange }: { value: PartBinding; options: MountOption[]; kind?: PartInput['kind']; onChange: (binding: PartBinding) => void }) {
  const t = useT().parts, encoded = JSON.stringify(value), choices = options.filter((option) => !kind || kind === option.kind)
  const selected = choices.findIndex((option) => JSON.stringify(option.binding) === encoded)
  const [advanced, setAdvanced] = useState(value.type === 'pair')
  return <>
    <label className={st.field}><span>{t.mount}</span><select aria-label={t.mount} value={selected} onChange={(event) => {
      const option = choices[Number(event.target.value)]; if (option) onChange(option.binding)
    }}><option value={-1}>{selected < 0 ? t.currentMount : t.choose}</option>{choices.map((option, index) => <option key={index} value={index}>{option.label}</option>)}</select></label>
    {kind !== 'surface' && <details open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)}><summary>{t.pairFaces}</summary>
      <PairFields value={value} options={options.filter((option) => option.kind === 'surface')} onChange={onChange} />
    </details>}
  </>
}
function PairFields({ value, options, onChange }: { value: PartBinding; options: MountOption[]; onChange: (binding: PartBinding) => void }) {
  const t = useT().parts
  const surface = (index: number) => {
    const binding = options[index]?.binding
    return binding?.type === 'output' ? { nodeId: binding.nodeId, portId: binding.portId }
      : { nodeId: '$input', portId: binding?.type === 'input' ? binding.face ?? 'surface' : 'a' }
  }
  const [draft, setDraft] = useState<Extract<PartBinding, { type: 'pair' }>>(value.type === 'pair' ? value : {
    type: 'pair', a: surface(0), b: surface(1), hingeA: [[0, 0], [2, 0]], hingeB: [[0, 0], [2, 0]], directionA: 'positive', directionB: 'positive', foldSign: 1,
  })
  return <div className={st.fields}>
    {(['a', 'b'] as const).map((side) => <label className={st.field} key={side}><span>{side === 'a' ? t.faceA : t.faceB}</span><select aria-label={side === 'a' ? t.faceA : t.faceB}
      value={options.findIndex((_, index) => JSON.stringify(surface(index)) === JSON.stringify(draft[side]))}
      onChange={(event) => setDraft({ ...draft, [side]: surface(Number(event.target.value)) })}>
      <option value={-1}>{t.choose}</option>{options.map((option, index) => <option key={index} value={index}>{option.label}</option>)}
    </select></label>)}
    {(['hingeA', 'hingeB'] as const).map((key) => <div key={key}><span>{t[key]}</span><div className={st.compactGrid}>
      {draft[key].flatMap((point, i) => point.map((coordinate, axis) => <NumberField key={`${i}-${axis}`} label={`${t[key]} ${i + 1} ${axis === 0 ? 'u' : 'v'}`} value={coordinate}
        onChange={(number) => { const next = structuredClone(draft); next[key][i][axis] = number; setDraft(next) }} />))}
    </div></div>)}
    {(['directionA', 'directionB'] as const).map((side) => <label className={st.field} key={side}><span>{side === 'directionA' ? t.faceA : t.faceB} / {t.foldDirection}</span>
      <select aria-label={`${side === 'directionA' ? t.faceA : t.faceB} / ${t.foldDirection}`} value={draft[side]}
        onChange={(event) => setDraft({ ...draft, [side]: event.target.value as 'positive' | 'negative' })}>
        <option value="positive">{t.positive}</option><option value="negative">{t.negative}</option>
      </select></label>)}
    <label className={st.field}><span>{t.foldDirection}</span><select aria-label={t.foldDirection} value={draft.foldSign} onChange={(event) => setDraft({ ...draft, foldSign: Number(event.target.value) as 1 | -1 })}>
      <option value={1}>{t.positive}</option><option value={-1}>{t.negative}</option>
    </select></label>
    <button type="button" onClick={() => onChange(draft)}>{t.apply}</button>
  </div>
}
