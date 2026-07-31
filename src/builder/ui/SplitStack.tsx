import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '../i18n'
import st from '../builder.module.css'

/**
 * 縦に積んだ領域を、境界のハンドルで拡縮できるようにする。
 * 最後の領域だけが余りを占め、それより上は明示的な高さを持つ。
 * 各領域は自前でスクロールし、高さは localStorage へ保存する。
 */

export interface SplitPane {
  key: string
  label: string
  node: ReactNode
}

/** ハンドルの高さ。領域の合計を出すときに数える */
const HANDLE = 8

export function SplitStack({ storageKey, panes, initial, min = 90 }: {
  storageKey: string
  panes: SplitPane[]
  /** 上から順の初期高さ。最後の領域は余りを占めるので指定しない */
  initial: number[]
  min?: number
}) {
  const stackRef = useRef<HTMLDivElement>(null)
  const [heights, setHeights] = useState(() => storedHeights(storageKey, initial))

  useEffect(() => {
    localStorage.setItem(storageId(storageKey), JSON.stringify(heights.map(Math.round)))
  }, [storageKey, heights])

  /** 合計が入り切らないときは下の領域から詰める */
  const fit = (values: number[], container: number): number[] => {
    const next = values.map((value) => Math.max(min, value))
    let excess = next.reduce((sum, value) => sum + value, 0) + (panes.length - 1) * HANDLE + min - container
    for (let index = next.length - 1; index >= 0 && excess > 0; index--) {
      const give = Math.min(excess, next[index] - min)
      next[index] -= give
      excess -= give
    }
    return next
  }

  useEffect(() => {
    const onResize = () => setHeights((current) => fit(current, stackRef.current?.clientHeight ?? 0))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panes.length, min])

  /** 境界indexのドラッグ。下へ引くと上の領域が伸びる */
  const resize = (index: number, delta: number) => setHeights((current) => {
    const container = stackRef.current?.clientHeight ?? 0
    const others = current.reduce((sum, value, at) => (at === index ? sum : sum + value), 0)
    // 最後の領域にも min を残す
    const room = container - (panes.length - 1) * HANDLE - others - min
    const next = [...current]
    next[index] = Math.max(min, Math.min(Math.max(min, room), current[index] + delta))
    return next
  })

  return <div ref={stackRef} className={st.splitStack}>
    {panes.map((pane, index) => <Fragment key={pane.key}>
      <div className={st.splitPane}
        style={index < heights.length ? { flex: 'none', height: heights[index] } : undefined}>
        {pane.node}
      </div>
      {index < panes.length - 1 && <StackHandle label={pane.label} onDelta={(delta) => resize(index, delta)} />}
    </Fragment>)}
  </div>
}

function StackHandle({ label, onDelta }: { label: string; onDelta: (delta: number) => void }) {
  const last = useRef(0)
  return <div className={st.splitStackHandle} role="separator" aria-orientation="horizontal"
    aria-label={t().app.paneHeight(label)} title={t().app.paneHeightHint}
    onPointerDown={(event) => {
      last.current = event.clientY
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      onDelta(event.clientY - last.current)
      last.current = event.clientY
    }} />
}

function storageId(storageKey: string): string {
  return `tobidas4.splitH.${storageKey}`
}

function storedHeights(storageKey: string, initial: number[]): number[] {
  try {
    const raw = localStorage.getItem(storageId(storageKey))
    if (!raw) return initial
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length !== initial.length) return initial
    if (!parsed.every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)) return initial
    return parsed as number[]
  } catch {
    return initial
  }
}
