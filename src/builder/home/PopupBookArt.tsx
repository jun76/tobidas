import type { CSSProperties } from 'react'
import st from './home.module.css'

/** 立ち上がる順番。紙が奥から手前へ起きる飛び出す絵本の開き方にそろえる。 */
const delay = (seconds: number) => ({ '--delay': `${seconds}s` }) as CSSProperties

/** 昼と夜で同じ紙工作を塗り分ける。夜は窓に明かりが灯る。 */
const PALETTES = {
  day: {
    cover: '#e4775d', coverEdge: '#c95f47', stack: '#efe2c8', pageLeft: '#fffaf0', pageRight: '#fff6e6', gutter: '#e9d9bb',
    cloud: '#ffffff', cloudLine: '#e6dccb', hillBack: '#9fd4b8', hillFront: '#7cc2a0', tab: '#e8d7b6', trunk: '#a8744f',
    leaf: '#5fae86', leafLight: '#6dbb92', berryA: '#f08a6c', berryB: '#f6c95b', wall: '#ffd9c7', roof: '#e4775d', roofLine: '#c95f47',
    window: '#b9a6e0', windowFrame: '#fffaf0', door: '#8a6bc7', knob: '#f6c95b', grass: '#5fae86', flowerA: '#f08a6c', flowerB: '#b9a6e0', flowerC: '#f6c95b',
  },
  night: {
    cover: '#b95e4c', coverEdge: '#8f4536', stack: '#cdc2a8', pageLeft: '#ebe4d2', pageRight: '#e5ddc9', gutter: '#cbbd9d',
    cloud: '#3e4580', cloudLine: '#525a99', hillBack: '#2f5f63', hillFront: '#27514f', tab: '#c9bb9b', trunk: '#7a5440',
    leaf: '#2f6e5a', leafLight: '#3a7d66', berryA: '#d97a62', berryB: '#e6c05a', wall: '#d9b8a8', roof: '#a9584a', roofLine: '#86443a',
    window: '#ffd36b', windowFrame: '#c8a24a', door: '#5d4a8c', knob: '#ffd36b', grass: '#2f6e5a', flowerA: '#d97a62', flowerB: '#9d8ad6', flowerC: '#e6c05a',
  },
}

/** 入口の挿絵。開いた本から丘・木・家が順に起き上がる。装飾なので支援技術からは隠す。 */
export function PopupBookArt({ night = false }: { night?: boolean }) {
  const c = PALETTES[night ? 'night' : 'day']
  return <svg className={st.art} viewBox="0 0 520 430" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="gutter-left" x1="0" x2="1"><stop offset="0" stopColor={c.gutter} stopOpacity="0" /><stop offset="1" stopColor={c.gutter} stopOpacity=".7" /></linearGradient>
      <linearGradient id="gutter-right" x1="1" x2="0"><stop offset="0" stopColor={c.gutter} stopOpacity="0" /><stop offset="1" stopColor={c.gutter} stopOpacity=".7" /></linearGradient>
      <radialGradient id="moon-glow"><stop offset=".45" stopColor="#f7e7a1" stopOpacity=".22" /><stop offset="1" stopColor="#f7e7a1" stopOpacity="0" /></radialGradient>
      <radialGradient id="window-glow"><stop offset="0" stopColor="#ffd36b" stopOpacity=".55" /><stop offset="1" stopColor="#ffd36b" stopOpacity="0" /></radialGradient>
    </defs>
    <ellipse cx="260" cy="392" rx="232" ry="18" className={st.artShadow} />

    {/* 本体。180°に開いた平らな見開き。表紙の縁、紙束の厚み、左右のページ */}
    <g className={st.book}>
      <path d="M52 280 L468 280 L494 368 L26 368 Z" fill={c.cover} />
      <path d="M26 368 L494 368 L492 377 L28 377 Z" fill={c.coverEdge} />
      <path d="M40 360 L480 360 L479 367 L41 367 Z" fill={c.stack} />
      <path d="M62 288 L256 288 Q260 290 260 294 L260 360 L40 360 Z" fill={c.pageLeft} />
      <path d="M260 294 Q260 290 264 288 L458 288 L480 360 L260 360 Z" fill={c.pageRight} />
      {/* 綴じ目へ向かって紙がわずかに沈む陰影 */}
      <path d="M226 288 L256 288 Q260 290 260 294 L260 360 L222 360 Z" fill="url(#gutter-left)" />
      <path d="M260 294 Q260 290 264 288 L294 288 L298 360 L260 360 Z" fill="url(#gutter-right)" />
      <path d="M260 292 L260 360" stroke={c.gutter} strokeWidth="2" />
      <path d="M78 338 H238" className={st.pageLine} />
      <path d="M72 348 H238" className={st.pageLine} />
      <path d="M282 338 H444" className={st.pageLine} />
    </g>

    {/* 昼は太陽、夜は眠そうな月。どちらも奥の空でゆっくり動き続ける */}
    <g className={st.pop} style={delay(.35)}>
      {night ? <Moon /> : <Sun />}
    </g>
    {night && <Stars />}
    <g className={st.pop} style={delay(.5)}>
      <g className={st.cloud}>
        <path d="M96 128 a22 22 0 0 1 40 -14 a28 28 0 0 1 52 10 a18 18 0 0 1 4 36 h-90 a16 16 0 0 1 -6 -32 z" fill={c.cloud} stroke={c.cloudLine} strokeWidth="2" />
      </g>
    </g>
    <g className={st.pop} style={delay(.6)}>
      <g className={st.cloudSlow}>
        <path d="M250 70 a16 16 0 0 1 30 -10 a20 20 0 0 1 38 8 a13 13 0 0 1 2 26 h-66 a12 12 0 0 1 -4 -24 z" fill={c.cloud} stroke={c.cloudLine} strokeWidth="2" />
      </g>
    </g>

    {/* 奥の丘。背景パネルのように左右へ広がる */}
    <g className={st.pop} style={delay(.15)}>
      <path d="M78 318 C112 236 168 206 214 232 C248 182 316 170 352 214 C394 196 440 236 452 318 Z" fill={c.hillBack} />
      <path d="M128 318 C150 270 196 252 232 268 C262 236 312 230 344 262 C376 252 404 280 410 318 Z" fill={c.hillFront} />
    </g>

    {/* 木。幹を支える支持紙を背面に添える */}
    <g className={st.pop} style={delay(.8)}>
      <path d="M154 318 L170 300 L186 318 Z" fill={c.tab} />
      <rect x="164" y="236" width="12" height="82" rx="4" fill={c.trunk} />
      <circle cx="170" cy="214" r="34" fill={c.leaf} />
      <circle cx="146" cy="232" r="22" fill={c.leafLight} />
      <circle cx="194" cy="230" r="24" fill={c.leafLight} />
      <circle cx="160" cy="204" r="6" fill={c.berryA} /><circle cx="186" cy="218" r="5" fill={c.berryB} /><circle cx="150" cy="236" r="5" fill={c.berryA} />
    </g>

    {/* 家。いちばん大きく、最後に勢いよく起きる */}
    <g className={st.pop} style={delay(1)}>
      <path d="M278 324 L300 306 L322 324 Z" fill={c.tab} />
      {night && <circle cx="279" cy="280" r="34" fill="url(#window-glow)" className={st.windowGlow} />}
      <rect x="252" y="250" width="96" height="74" rx="4" fill={c.wall} />
      <path d="M240 256 L300 204 L360 256 Z" fill={c.roof} />
      <path d="M240 256 L300 204 L360 256" fill="none" stroke={c.roofLine} strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
      <rect x="326" y="214" width="14" height="28" rx="2" fill={c.roofLine} />
      <rect x="266" y="268" width="26" height="24" rx="5" fill={c.window} />
      <path d="M279 268 v24 M266 280 h26" stroke={c.windowFrame} strokeWidth="3" />
      <path d="M306 324 v-34 a12 12 0 0 1 24 0 v34 Z" fill={c.door} />
      <circle cx="325" cy="306" r="2.5" fill={c.knob} />
    </g>

    {/* 手前の草花 */}
    <g className={st.pop} style={delay(1.2)}>
      <path d="M200 326 q4 -16 8 0 q4 -12 8 0 q4 -16 8 0 Z" fill={c.grass} />
      <path d="M372 322 q4 -14 8 0 q4 -18 8 0 q4 -12 8 0 Z" fill={c.grass} />
      <circle cx="214" cy="314" r="5" fill={c.flowerA} /><circle cx="384" cy="306" r="5" fill={c.flowerB} /><circle cx="400" cy="312" r="4" fill={c.flowerC} />
    </g>

    {/* 昼は空を渡る鳥、夜は草むらのホタル */}
    {night ? <g className={st.fireflies}>
      <circle cx="226" cy="296" r="2.6" /><circle cx="364" cy="284" r="2.2" /><circle cx="128" cy="300" r="2" /><circle cx="420" cy="296" r="2.4" />
    </g> : <g className={st.birds}>
      <path d="M200 66 q8 -8 14 0 q6 -8 14 0" />
      <path d="M232 90 q6 -6 10 0 q4 -6 10 0" />
    </g>}
  </svg>
}

function Sun() {
  return <g>
    <circle cx="396" cy="96" r="34" fill="#f6c95b" />
    <g className={st.sunRays} stroke="#f6c95b" strokeWidth="7" strokeLinecap="round">
      <path d="M396 44 v-14" /><path d="M396 148 v14" /><path d="M344 96 h-14" /><path d="M448 96 h14" />
      <path d="M359 59 l-10 -10" /><path d="M433 133 l10 10" /><path d="M433 59 l10 -10" /><path d="M359 133 l-10 10" />
    </g>
    <circle cx="386" cy="92" r="3.5" fill="#6b4a2c" /><circle cx="406" cy="92" r="3.5" fill="#6b4a2c" />
    <path d="M386 104 q10 8 20 0" stroke="#6b4a2c" strokeWidth="3" fill="none" strokeLinecap="round" />
  </g>
}

/** 三日月の顔。目を閉じてうとうとし、小さな「Z」が昇っていく */
function Moon() {
  return <g>
    <g className={st.moon}>
      <circle cx="392" cy="96" r="62" fill="url(#moon-glow)" />
      <path d="M414 58 A40 40 0 1 0 430 128 A32 32 0 1 1 414 58 Z" fill="#f7e7a1" />
      <circle cx="376" cy="114" r="3" fill="#e2cd7c" /><circle cx="384" cy="68" r="2.2" fill="#e2cd7c" />
      <path d="M369 89 q3.5 3.5 7 0" stroke="#6b5a2c" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M373 104 q4 3.5 8 .5" stroke="#6b5a2c" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <circle cx="369" cy="97" r="4" fill="#f2a58f" opacity=".75" />
    </g>
    <g className={st.snore} fill="none" stroke="#f7e7a1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M440 64 h10 l-10 10 h10" />
      <path d="M458 44 h7 l-7 7 h7" />
    </g>
  </g>
}

/** 夜空の星。ばらばらの速さでまたたく */
function Stars() {
  const star = (x: number, y: number, r: number, seconds: number) => <path key={`${x}-${y}`} className={st.star} style={{ '--twinkle': `${seconds}s` } as CSSProperties}
    d={`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z`} />
  return <g fill="#f7e7a1">
    {[star(60, 70, 8, 2.6), star(220, 40, 6, 3.4), star(330, 150, 5, 2.2), star(470, 170, 7, 3.0), star(120, 190, 5, 3.8), star(300, 20, 4, 2.8)]}
  </g>
}
