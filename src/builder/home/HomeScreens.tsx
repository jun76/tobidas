import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, ArrowRight, Blocks, BookOpen, Lock, Moon, Settings, Sun, type LucideIcon } from 'lucide-react'
import packageJson from '../../../package.json'
import { Icon } from '../../ui/Icon'
import { LOCALES, useLocaleStore, useT } from '../i18n'
import { useWorkspaceStore } from '../parts/store'
import { THEMES, useThemeStore } from '../themeState'
import { PopupBookArt } from './PopupBookArt'
import st from './home.module.css'

/** 切り紙の文字。一文字ずつ色と傾きを変えて、紙を貼ったロゴにする。 */
const LETTERS = [['t', '#e4775d', -4], ['o', '#f6b84b', 3], ['b', '#5fae86', -2], ['i', '#6fa8dc', 4], ['d', '#8a6bc7', -3], ['a', '#f08a6c', 2], ['s', '#5fae86', -1]] as const

/** 跳ねの所要時間。最後の文字の遅れを含めて、終わる前に次の跳ねを重ねない */
const HOP_MS = 900, HOP_COOLDOWN_MS = 1500

function Wordmark() {
  // 登場は外側の文字が一度だけ受け持ち、マウスオーバーの跳ねは内側の文字だけで行う。
  // 跳ねのクラスを外しても登場のアニメーションは再生し直されない。
  const [hopping, setHopping] = useState(false), lastHop = useRef(-Infinity), timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const hop = () => {
    const now = performance.now()
    if (now - lastHop.current < HOP_COOLDOWN_MS) return
    lastHop.current = now
    setHopping(true)
    timer.current = window.setTimeout(() => setHopping(false), HOP_MS)
  }
  return <h1 className={`${st.wordmark} ${hopping ? st.hopping : ''}`} aria-label="tobidas" onMouseEnter={hop}>
    {LETTERS.map(([letter, color, tilt], index) => <span key={index} className={st.letter} aria-hidden="true"
      style={{ '--letter': color, '--tilt': `${tilt}deg`, '--index': index } as CSSProperties}><span className={st.hop}>{letter}</span></span>)}
  </h1>
}

/** 背景に散らす紙片。夜は紙片の代わりに小さな星を散らす。装飾だけなので支援技術からは隠す。 */
function Confetti() {
  const night = useThemeStore((state) => state.theme === 'dark')
  if (night) return <svg className={st.confetti} viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <g fill="#f7e7a1">
      {[[120, 140, 3], [1290, 120, 2.5], [1195, 715, 2], [70, 760, 3], [660, 60, 2], [1380, 500, 2.5], [560, 840, 2], [318, 846, 2.5], [900, 120, 1.8], [980, 820, 2.2], [40, 420, 1.8], [760, 880, 1.6]]
        .map(([x, y, r], index) => <circle key={index} cx={x} cy={y} r={r} className={st.dot} style={{ '--twinkle': `${2.4 + (index % 4) * .7}s` } as CSSProperties} />)}
    </g>
  </svg>
  return <svg className={st.confetti} viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <circle cx="120" cy="140" r="14" fill="#f6c95b" />
    <path d="M1290 120 l26 46 h-52 z" fill="#9fd4b8" />
    <rect x="1180" y="700" width="30" height="30" rx="6" fill="#f08a6c" transform="rotate(18 1195 715)" />
    <circle cx="70" cy="760" r="20" fill="#b9a6e0" />
    <path d="M640 60 q20 -24 40 0 t40 0" fill="none" stroke="#6fa8dc" strokeWidth="6" strokeLinecap="round" />
    <path d="M1380 470 q-20 20 0 40 t0 40" fill="none" stroke="#f6b84b" strokeWidth="6" strokeLinecap="round" />
    <circle cx="560" cy="840" r="10" fill="#9fd4b8" />
    <path d="M300 860 l18 -32 l18 32 z" fill="#e4775d" opacity=".8" />
  </svg>
}

export function HomeScreen() {
  const t = useT().parts, setScreen = useWorkspaceStore((state) => state.setScreen), night = useThemeStore((state) => state.theme === 'dark')
  return <main className={st.screen} data-tobidas-kind="entrance">
    <Confetti />
    <header className={st.topBar}>
      <span className={st.versionPill}>v{packageJson.version}</span>
      <button type="button" className={st.roundButton} onClick={() => setScreen('settings')}>
        <Icon as={Settings} size={18} />{t.settings}
      </button>
    </header>
    <section className={st.hero}>
      <div className={st.heroText}>
        <Wordmark />
        <p className={st.tagline}>{t.homeTagline}</p>
        <p className={st.intro}>{t.homeIntro}</p>
      </div>
      <PopupBookArt night={night} />
    </section>
    <nav className={st.cards}>
      <MenuCard tone="coral" icon={BookOpen} title={t.bookEditor} hint={t.bookEditorHint} id="home-book" onClick={() => setScreen('book')} />
      <MenuCard tone="mint" icon={Blocks} title={t.partEditor} hint={t.partEditorHint} id="home-part" onClick={() => setScreen('part')} />
    </nav>
    <footer className={st.footer}>
      <span className={st.footerNote}><Icon as={Lock} size={15} />{t.localFirst}</span>
      <small className={st.copyright}>©2026 jun</small>
    </footer>
  </main>
}

/** 入口のカード。名前は見出しだけにして、説明は補足として読ませる。 */
function MenuCard({ tone, icon, title, hint, id, onClick }: {
  tone: 'coral' | 'mint'; icon: LucideIcon; title: string; hint: string; id: string; onClick: () => void
}) {
  return <button type="button" className={`${st.card} ${st[tone]}`} aria-label={title} aria-describedby={`${id}-hint`} onClick={onClick}>
    <span className={st.cardIcon}><Icon as={icon} size={30} /></span>
    <span className={st.cardTitle}>{title}</span>
    <span className={st.cardHint} id={`${id}-hint`}>{hint}</span>
    <span className={st.cardArrow}><Icon as={ArrowRight} size={20} /></span>
  </button>
}

export function SettingsScreen() {
  const t = useT().parts, setScreen = useWorkspaceStore((state) => state.setScreen), locale = useLocaleStore(), theme = useThemeStore()
  return <main className={st.screen} data-tobidas-kind="settings">
    <Confetti />
    <header className={st.topBar}>
      <button type="button" className={st.roundButton} onClick={() => setScreen('home')}>
        <Icon as={ArrowLeft} size={18} />{t.home}
      </button>
    </header>
    <section className={st.sheet}>
      <h1 className={st.sheetTitle}>{t.settings}</h1>
      <p className={st.sheetLead}>{t.settingsLead}</p>
      <fieldset className={st.group}>
        <legend>{t.language}</legend>
        <p className={st.groupHint}>{t.languageHint}</p>
        <div className={st.choices}>
          {LOCALES.map((language) => <label key={language.id} className={st.choice}>
            <input type="radio" name="tobidas-locale" value={language.id} checked={locale.locale === language.id}
              onChange={() => locale.setLocale(language.id)} />
            <span className={st.choiceGlyph} aria-hidden="true">{language.id === 'ja' ? 'あ' : 'A'}</span>
            <span>{language.label}</span>
          </label>)}
        </div>
      </fieldset>
      <fieldset className={st.group}>
        <legend>{t.theme}</legend>
        <p className={st.groupHint}>{t.themeHint}</p>
        <div className={st.choices}>
          {THEMES.map((id) => <label key={id} className={st.choice}>
            <input type="radio" name="tobidas-theme" value={id} checked={theme.theme === id} onChange={() => theme.setTheme(id)} />
            <span className={st.choiceGlyph} aria-hidden="true"><Icon as={id === 'light' ? Sun : Moon} size={20} /></span>
            <span>{id === 'light' ? t.themeLight : t.themeDark}</span>
          </label>)}
        </div>
      </fieldset>
      <section className={st.group} aria-labelledby="settings-about">
        <h2 id="settings-about">{t.about}</h2>
        <dl className={st.facts}>
          <dt>{t.appVersion}</dt><dd>tobidas v{packageJson.version}</dd>
          <dt>{t.storage}</dt><dd>{t.storageValue}</dd>
          <dt>{t.appLicense}</dt><dd>Apache-2.0</dd>
        </dl>
      </section>
    </section>
  </main>
}
