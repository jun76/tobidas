import { Viewport } from '../Viewport'
import { useT } from '../i18n'
import st from '../builder.module.css'
import { AiModePanel } from './AiModePanel'

export function AiWorkspace() {
  const t = useT()

  return <main className={st.aiWorkspace} data-tobidas-ai-mode="true" aria-label={t.ai.workspaceTitle}>
    <aside className={st.aiControlPane} aria-label={t.ai.controlPane}>
      <AiModePanel />
    </aside>
    <section className={st.aiViewportPane} aria-label={t.ai.viewportPane}>
      <Viewport showEditTimeline={false} />
    </section>
  </main>
}
