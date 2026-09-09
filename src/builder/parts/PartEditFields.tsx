import { useMemo, useState } from 'react'
import { describePartEdit, type PartEditDescription } from '../../parts/edit'
import { bookEditScene } from '../../parts/bookEdit'
import { evaluateBookSignals } from '../../runtime/signals'
import { normalizedDihedral } from '../../runtime/stow/dihedral'
import { useBuilderStore } from '../store'
import { useT } from '../i18n'
import { usePartEditStore } from './editState'
import { editPlacedPartCommand } from './commands'
import { NumberField } from './fields'
import st from './parts.module.css'

export function useSelectedPartEdit() {
  const project = useBuilderStore((state) => state.project), selection = useBuilderStore((state) => state.selection)
  return useMemo(() => {
    if (selection.type !== 'element') return null
    const element = project.book.spreads.find((item) => item.id === selection.spreadId)?.elements.find((item) => item.id === selection.elementId)
    if (element?.type !== 'part') return null
    try { return { description: describePartEdit(bookEditScene(project, selection.spreadId), selection.elementId), ...selection } } catch { return null }
  }, [project, selection])
}
export function PartEditBadge() {
  const selected = useSelectedPartEdit(), state = usePartEditStore(), store = useBuilderStore(), t = useT().parts.editing
  if (!selected) return null
  const index = store.project.book.spreads.findIndex((item) => item.id === selected.spreadId)
  const open = normalizedDihedral(evaluateBookSignals(store.project.book, store.previewProgress).dihedrals[index]) > .999
  const d = selected.description
  const error = state.session?.error || state.error
  return <div className={st.placementBadge} data-part-edit-valid={state.session || error ? !error : undefined}>
    <strong>{open ? store.gizmo === 'translate' ? d.translateY ? t.movePlane : t.moveHinge : store.gizmo === 'scale' ? t.scale : t.rotate : t.openToEdit}</strong>
    {open && store.gizmo === 'rotate' && <AngleChoice description={d} />}
    {open && <p>{error ? t.rejected : t.hint}</p>}
    {error && <details><summary>{t.reason}</summary><p role="status">{error}</p></details>}
  </div>
}
export function AngleChoice({ description }: { description: PartEditDescription }) {
  const state = usePartEditStore(), t = useT().parts.editing
  return description.angles.length ? <select aria-label={t.rotate} value={description.angles.some((a) => a.id === state.angleId) ? state.angleId : description.angles[0].id}
    onChange={(event) => state.chooseAngle(event.target.value)}>{description.angles.map((angle) => <option key={angle.id} value={angle.id}>
      {t.labels[angle.label as keyof typeof t.labels] ?? angle.label}
    </option>)}</select> : <p>{t.noRotation}</p>
}
export function PartEditFields({ spreadId, elementId }: { spreadId: string; elementId: string }) {
  const project = useBuilderStore((state) => state.project), t = useT().parts.editing
  const [delta, setDelta] = useState<[number, number]>([0, 0]), [error, setError] = useState('')
  let description: PartEditDescription
  try { description = describePartEdit(bookEditScene(project, spreadId), elementId) } catch { return null }
  const run = (intent: Parameters<typeof editPlacedPartCommand>[0]['intent']) => {
    const result = editPlacedPartCommand({ spreadId, elementId, intent }); setError(result.ok ? '' : result.message)
    if (result.ok) setDelta([0, 0])
  }
  return <details className={st.section} open data-tobidas-kind="part-design-edit"><summary>{t.title}</summary><div className={st.fields}>
    <NumberField label={t.along} value={delta[0]} step={.1} onChange={(v) => setDelta([v, delta[1]])} />
    {description.translateY && <NumberField label={t.across} value={delta[1]} step={.1} onChange={(v) => setDelta([delta[0], v])} />}
    <button type="button" onClick={() => run({ type: 'translate', delta })}>{t.move}</button>
    <NumberField label={t.scale} value={description.scale} min={.01} max={100} step={.05} onChange={(value) => run({ type: 'scale', value })} />
    {description.angles.map((angle) => <NumberField key={angle.id} label={t.labels[angle.label as keyof typeof t.labels] ?? angle.label}
      value={angle.value} min={angle.min} max={angle.max} step={5} onChange={(value) => run({ type: 'rotate', handle: angle.id, value })} />)}
    <p className={st.hint}>{t.actualSize}: {description.size.map((n) => n.toFixed(2)).join(' × ')}</p>
    {error && <p role="alert" className={st.error}>{error}</p>}
  </div></details>
}
