import { useEffect } from 'react'
import { BookOpen, Blocks, SlidersHorizontal, Home } from 'lucide-react'
import { Icon } from '../ui/Icon'
import App from './App'
import { LOCALES, useLocaleStore, useT } from './i18n'
import { PartEditor } from './parts/PartEditor'
import { usePartEditorStore, useWorkspaceStore } from './parts/store'
import { WebMcpBridge } from './webmcp/WebMcpBridge'
import st from './parts/parts.module.css'

export default function Workspace() {
  const t = useT().parts, workspace = useWorkspaceStore(), locale = useLocaleStore(), boot = usePartEditorStore((state) => state.boot)
  useEffect(() => { void boot() }, [boot])
  return <><WebMcpBridge />{workspace.screen === 'book' ? <App /> : workspace.screen === 'part' ? <PartEditor />
    : <main className={st.home} data-tobidas-kind={workspace.screen === 'home' ? 'entrance' : 'settings'}>
      <h1>tobidas</h1>
      {workspace.screen === 'settings' ? <div className={st.settings}>
        <h2>{t.settings}</h2><label>{t.language} <select aria-label={t.language} value={locale.locale} onChange={(event) => locale.setLocale(event.target.value as typeof locale.locale)}>
          {LOCALES.map((language) => <option value={language.id} key={language.id}>{language.label}</option>)}
        </select></label><p><button type="button" onClick={() => workspace.setScreen('home')}><Icon as={Home} />{t.home}</button></p>
      </div> : <><p>{t.homeLead}</p><nav className={st.homeMenu}>
        <button type="button" onClick={() => workspace.setScreen('book')}><Icon as={BookOpen} size={32} />{t.bookEditor}</button>
        <button type="button" onClick={() => workspace.setScreen('part')}><Icon as={Blocks} size={32} />{t.partEditor}</button>
        <button type="button" onClick={() => workspace.setScreen('settings')}><Icon as={SlidersHorizontal} size={32} />{t.settings}</button>
      </nav></>}
    </main>}</>
}
