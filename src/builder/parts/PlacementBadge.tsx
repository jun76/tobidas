import { useT } from '../i18n'
import { usePartPlacementStore } from './placementState'
import st from './parts.module.css'

export function PlacementBadge() {
  const state = usePartPlacementStore(), t = useT().parts
  if (!state.tool) return null
  const step = state.first ? 2 : 1
  return <div className={st.placementBadge} data-part-placement-step={step} data-part-hover-surface={state.hover ?? ''}
    data-part-hover-valid={state.hover ? !state.reason : undefined}>
    <div role="status" aria-live="polite"><strong>{state.tool.name} · {t.pickFace(step, state.tool.faces)}</strong>
      <p>{state.reason ? t.placementFailures[state.reason] : t.pickHint}</p></div>
    {state.error && <p role="alert">{state.error}</p>}
    <div>{state.first && <button type="button" onClick={state.back}>{t.pickBack}</button>}
      <button type="button" onClick={state.cancel}>{t.pickCancel}</button></div>
  </div>
}
