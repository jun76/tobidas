import type { CSSProperties } from 'react'
import st from './home.module.css'

/** 立ち上がる順番。紙が奥から手前へ起きる飛び出す絵本の開き方にそろえる。 */
const delay = (seconds: number) => ({ '--delay': `${seconds}s` }) as CSSProperties

/** 入口の挿絵。開いた本から丘・木・家が順に起き上がる。装飾なので支援技術からは隠す。 */
export function PopupBookArt() {
  return <svg className={st.art} viewBox="0 0 520 430" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="gutter-left" x1="0" x2="1"><stop offset="0" stopColor="#e9d9bb" stopOpacity="0" /><stop offset="1" stopColor="#e9d9bb" stopOpacity=".7" /></linearGradient>
      <linearGradient id="gutter-right" x1="1" x2="0"><stop offset="0" stopColor="#e9d9bb" stopOpacity="0" /><stop offset="1" stopColor="#e9d9bb" stopOpacity=".7" /></linearGradient>
    </defs>
    <ellipse cx="260" cy="392" rx="232" ry="18" className={st.artShadow} />

    {/* 本体。180°に開いた平らな見開き。表紙の縁、紙束の厚み、左右のページ */}
    <g className={st.book}>
      <path d="M52 280 L468 280 L494 368 L26 368 Z" fill="#e4775d" />
      <path d="M26 368 L494 368 L492 377 L28 377 Z" fill="#c95f47" />
      <path d="M40 360 L480 360 L479 367 L41 367 Z" fill="#efe2c8" />
      <path d="M62 288 L256 288 Q260 290 260 294 L260 360 L40 360 Z" fill="#fffaf0" />
      <path d="M260 294 Q260 290 264 288 L458 288 L480 360 L260 360 Z" fill="#fff6e6" />
      {/* 綴じ目へ向かって紙がわずかに沈む陰影 */}
      <path d="M226 288 L256 288 Q260 290 260 294 L260 360 L222 360 Z" fill="url(#gutter-left)" />
      <path d="M260 294 Q260 290 264 288 L294 288 L298 360 L260 360 Z" fill="url(#gutter-right)" />
      <path d="M260 292 L260 360" stroke="#e9d9bb" strokeWidth="2" />
      <path d="M78 338 H238" className={st.pageLine} />
      <path d="M72 348 H238" className={st.pageLine} />
      <path d="M282 338 H444" className={st.pageLine} />
    </g>

    {/* 太陽と雲は奥の空に浮かび、ゆっくり揺れ続ける */}
    <g className={st.pop} style={delay(.35)}>
      <g>
        <circle cx="396" cy="96" r="34" fill="#f6c95b" />
        <g className={st.sunRays} stroke="#f6c95b" strokeWidth="7" strokeLinecap="round">
          <path d="M396 44 v-14" /><path d="M396 148 v14" /><path d="M344 96 h-14" /><path d="M448 96 h14" />
          <path d="M359 59 l-10 -10" /><path d="M433 133 l10 10" /><path d="M433 59 l10 -10" /><path d="M359 133 l-10 10" />
        </g>
        <circle cx="386" cy="92" r="3.5" fill="#6b4a2c" /><circle cx="406" cy="92" r="3.5" fill="#6b4a2c" />
        <path d="M386 104 q10 8 20 0" stroke="#6b4a2c" strokeWidth="3" fill="none" strokeLinecap="round" />
      </g>
    </g>
    <g className={st.pop} style={delay(.5)}>
      <g className={st.cloud}>
        <path d="M96 128 a22 22 0 0 1 40 -14 a28 28 0 0 1 52 10 a18 18 0 0 1 4 36 h-90 a16 16 0 0 1 -6 -32 z" fill="#ffffff" stroke="#e6dccb" strokeWidth="2" />
      </g>
    </g>
    <g className={st.pop} style={delay(.6)}>
      <g className={st.cloudSlow}>
        <path d="M250 70 a16 16 0 0 1 30 -10 a20 20 0 0 1 38 8 a13 13 0 0 1 2 26 h-66 a12 12 0 0 1 -4 -24 z" fill="#ffffff" stroke="#e6dccb" strokeWidth="2" />
      </g>
    </g>

    {/* 奥の丘。背景パネルのように左右へ広がる */}
    <g className={st.pop} style={delay(.15)}>
      <path d="M78 318 C112 236 168 206 214 232 C248 182 316 170 352 214 C394 196 440 236 452 318 Z" fill="#9fd4b8" />
      <path d="M128 318 C150 270 196 252 232 268 C262 236 312 230 344 262 C376 252 404 280 410 318 Z" fill="#7cc2a0" />
    </g>

    {/* 木。幹を支える支持紙を背面に添える */}
    <g className={st.pop} style={delay(.8)}>
      <path d="M154 318 L170 300 L186 318 Z" fill="#e8d7b6" />
      <rect x="164" y="236" width="12" height="82" rx="4" fill="#a8744f" />
      <circle cx="170" cy="214" r="34" fill="#5fae86" />
      <circle cx="146" cy="232" r="22" fill="#6dbb92" />
      <circle cx="194" cy="230" r="24" fill="#6dbb92" />
      <circle cx="160" cy="204" r="6" fill="#f08a6c" /><circle cx="186" cy="218" r="5" fill="#f6c95b" /><circle cx="150" cy="236" r="5" fill="#f08a6c" />
    </g>

    {/* 家。いちばん大きく、最後に勢いよく起きる */}
    <g className={st.pop} style={delay(1)}>
      <path d="M278 324 L300 306 L322 324 Z" fill="#e8d7b6" />
      <rect x="252" y="250" width="96" height="74" rx="4" fill="#ffd9c7" />
      <path d="M240 256 L300 204 L360 256 Z" fill="#e4775d" />
      <path d="M240 256 L300 204 L360 256" fill="none" stroke="#c95f47" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
      <rect x="326" y="214" width="14" height="28" rx="2" fill="#c95f47" />
      <rect x="266" y="268" width="26" height="24" rx="5" fill="#b9a6e0" />
      <path d="M279 268 v24 M266 280 h26" stroke="#fffaf0" strokeWidth="3" />
      <path d="M306 324 v-34 a12 12 0 0 1 24 0 v34 Z" fill="#8a6bc7" />
      <circle cx="325" cy="306" r="2.5" fill="#f6c95b" />
    </g>

    {/* 手前の草花 */}
    <g className={st.pop} style={delay(1.2)}>
      <path d="M200 326 q4 -16 8 0 q4 -12 8 0 q4 -16 8 0 Z" fill="#5fae86" />
      <path d="M372 322 q4 -14 8 0 q4 -18 8 0 q4 -12 8 0 Z" fill="#5fae86" />
      <circle cx="214" cy="314" r="5" fill="#f08a6c" /><circle cx="384" cy="306" r="5" fill="#b9a6e0" /><circle cx="400" cy="312" r="4" fill="#f6c95b" />
    </g>

    {/* 空を渡る鳥 */}
    <g className={st.birds}>
      <path d="M200 66 q8 -8 14 0 q6 -8 14 0" />
      <path d="M232 90 q6 -6 10 0 q4 -6 10 0" />
    </g>
  </svg>
}
