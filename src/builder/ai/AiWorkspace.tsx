import { Viewport } from '../Viewport'
import { useT } from '../i18n'
import st from '../builder.module.css'
import { AiModePanel } from './AiModePanel'
import { useBuilderStore } from '../store'

export function AiWorkspace({ onScreenshot }: { onScreenshot: () => Promise<void> }) {
  const t = useT()
  const mode = useBuilderStore((state) => state.mode)

  return <main className={`${st.aiWorkspace} ${mode === 'play' ? st.aiWorkspacePlayback : ''}`}
    data-tobidas-ai-mode="true" aria-label={t.ai.workspaceTitle}>
    <aside className={st.aiControlPane} aria-label={t.ai.controlPane}>
      <AiModePanel />
    </aside>
    <section className={st.aiViewportPane} aria-label={t.ai.viewportPane}>
      <Viewport onScreenshot={onScreenshot} />
    </section>
  </main>
}
