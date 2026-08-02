import type { TextFont, VisualElement } from '../schema/stageElement'

/**
 * 文字の書体と寸法。
 *
 * 文字はキャンバスへ描いたテクスチャを箱いっぱいへ引き伸ばして貼る。つまり箱の縦横比が
 * テクスチャの縦横比とずれると、その差がそのまま字の歪みになる。だから箱を決める式と
 * テクスチャを描く式は同じ場所に置き、どちらも同じ行高・同じ余白から導く。
 *
 * 書体はフォントファイルではなく端末に載っている候補列。同梱プレイヤーは単一HTMLを
 * file:// で開くため外部フォントを参照できず、埋め込めば日本語書体は数MB級で作品の
 * 容量を食う。作品が持つのは系統だけにして、実物は端末のものを使う (docs の容量要件)。
 * どの端末でも必ず着地するよう、候補列の末尾は総称ファミリで閉じる。
 */
export const TEXT_FONTS: Record<TextFont, { stack: string }> = {
  rounded: { stack: "'Hiragino Maru Gothic ProN', 'BIZ UDGothic', 'Yu Gothic', sans-serif" },
  sans: { stack: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', Meiryo, sans-serif" },
  serif: { stack: "'Hiragino Mincho ProN', 'Yu Mincho', 'BIZ UDMincho', serif" },
  mono: { stack: "'SFMono-Regular', Consolas, 'BIZ UDGothic', monospace" },
}

/** 選択肢に出す順。書体の名前はビルダーの辞書が持つ (表示言語に従うため) */
export const TEXT_FONT_IDS: TextFont[] = ['rounded', 'sans', 'serif', 'mono']

/** 行の高さ (フォントサイズ比)。テクスチャの行送りと箱の高さが共有する */
export const TEXT_LINE_HEIGHT = 1.25
/** 左右の余白 (フォントサイズ比)。同じく両者で共有する */
export const TEXT_SIDE_PAD = 0.2

export type TextStyle = Pick<VisualElement, 'text' | 'font' | 'bold' | 'italic' | 'underline'>

/** キャンバスの font 指定。斜体と太字はここだけで決める */
export function canvasFont(style: Pick<TextStyle, 'font' | 'bold' | 'italic'>, px: number): string {
  const stack = (TEXT_FONTS[style.font] ?? TEXT_FONTS.rounded).stack
  return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${px}px ${stack}`
}

let scratch: CanvasRenderingContext2D | null | undefined

function measureContext(): CanvasRenderingContext2D | null {
  if (scratch === undefined) {
    scratch = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  }
  return scratch
}

/** 端末に書体がない場所 (テスト・生成スクリプト) の見積り。半角0.55・全角1.0の粗い勘定 */
function estimateEm(line: string): number {
  return [...line].reduce((sum, ch) => sum + (/[ -~]/.test(ch) ? 0.55 : 1), 0)
}

/** いちばん長い行の幅をフォントサイズ比で返す */
export function measureTextEm(style: TextStyle): number {
  const lines = style.text.split('\n')
  const c2d = measureContext()
  if (!c2d) return Math.max(...lines.map(estimateEm), 0.001)
  const px = 100
  c2d.font = canvasFont(style, px)
  return Math.max(...lines.map((line) => c2d.measureText(line).width / px), 0.001)
}

/**
 * 文字が歪まない箱の寸法。テクスチャの縦横比と必ず一致する。
 * fontSize は世界座標での1文字ぶんの大きさで、行の高さはその TEXT_LINE_HEIGHT 倍。
 */
export function measureTextBox(style: TextStyle, fontSize: number): { width: number; height: number } {
  const lines = style.text.split('\n').length
  const size = Math.max(0.01, fontSize)
  return {
    width: Math.max(0.05, size * (measureTextEm(style) + TEXT_SIDE_PAD)),
    height: Math.max(0.05, size * TEXT_LINE_HEIGHT * lines),
  }
}
