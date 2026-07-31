import type { LucideIcon, LucideProps } from 'lucide-react'

/**
 * アイコンの体裁をここだけで決める薄いラッパ。
 *
 * lucide のアイコンは実体がSVGコンポーネントで、ビルド時にバンドルへ取り込まれる。
 * 外部フォントもCDN参照も生まないので、サイト書き出しの単一HTML (scripts/embed-player.mjs が
 * JS/CSSをインライン化する) でも file:// で自己完結する。アイコンフォントは使わない。
 *
 * 意味はボタン側の aria-label / title が持つので、SVG自体は支援技術から隠す。
 */

/** 行内は14px、ツールバーは16px、ビューポートの浮きボタンは20pxを既定にする */
export const ICON = { row: 14, bar: 16, float: 20 } as const

export function Icon({ as: Glyph, size = ICON.row, ...rest }: { as: LucideIcon } & LucideProps) {
  return <Glyph size={size} strokeWidth={1.75} aria-hidden="true" focusable={false} {...rest} />
}
