/**
 * 表紙の絵へ英字タイトルを焼き込む (要 ImageMagick の `magick`)。
 *
 *   node scripts/bake-cover-titles.mjs <原画フォルダ>                    # 素材を差し替える
 *   node scripts/bake-cover-titles.mjs <原画フォルダ> --preview-dir tmp  # 別フォルダへ出す
 *
 * タイトルは表紙の**絵の一部**として持つ。部品として立てるとページを開く区間には
 * 保持時刻が無く、表紙は要素を持てないので、字を置く先が絵しかない。
 *
 * 取り込み元には `<原画フォルダ>/<作品>.webp` の字の入っていない原画を使う。
 * 差し替え済みの素材を入力にすると字が二重に焼けるので、原画フォルダを
 * `scripts/samples/assets/` にしてはいけない。
 *
 * 置き方は作品ごとに違う。絵の空いている帯 (森は下の茂み、通学路は生成りの空、
 * 四季は水彩の余白) を選び、輪郭線ではなく**背後の滲み**で字を持ち上げる。
 * 縁取りを付けるとクレヨン・段ボール・水彩のどの質感とも噛み合わない。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [, , sourceDir, ...args] = process.argv
const option = (name) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}

if (!sourceDir) {
  console.error('usage: node scripts/bake-cover-titles.mjs <source-dir> [--preview-dir <dir>]')
  process.exit(2)
}

const previewDir = option('preview-dir')
if (args.includes('--preview-dir') && !previewDir) {
  console.error('--preview-dir には出力先が必要です')
  process.exit(2)
}

const WORKS = [
  {
    id: 'forest_lantern',
    // カタログの title と同じ文言。改行だけこちらで決める
    title: 'Chasing the\nForest Lantern',
    font: 'Georgia-Italic',
    size: 74,
    fill: '#f6d79a',
    glow: '#0b1524',
    // 下の茂みの帯。これより上げるとキツネの頭に掛かる
    gravity: 'south',
    offset: '+0+42',
    lineSpacing: 12,
  },
  {
    id: 'morning_walk',
    title: 'The Walk to School',
    font: 'Georgia',
    size: 74,
    fill: '#5b4025',
    glow: '#f7e9cf',
    // 生成りの空。これより下げると稜線に掛かる
    gravity: 'north',
    offset: '+0+34',
    lineSpacing: 0,
  },
  {
    id: 'four_seasons',
    title: 'One Window,\nFour Seasons',
    font: 'Georgia-Italic',
    size: 76,
    fill: '#4c5f74',
    glow: '#ffffff',
    gravity: 'north',
    offset: '+0+70',
    lineSpacing: 10,
  },
]

if (previewDir) fs.mkdirSync(previewDir, { recursive: true })

for (const work of WORKS) {
  const src = path.join(sourceDir, `${work.id}.webp`)
  if (!fs.existsSync(src)) {
    throw new Error(`字の入っていない原画がありません: ${src}`)
  }
  const out = previewDir
    ? path.join(previewDir, `cover-front-${work.id}.webp`)
    : `scripts/samples/assets/${work.id}/cover-front.webp`
  const text = ['-background', 'none', '-font', work.font, '-pointsize', String(work.size),
    '-interline-spacing', String(work.lineSpacing), '-gravity', 'center']
  execFileSync('magick', [
    src,
    // 滲み: 同じ字を二度ぼかして敷き、絵の細かい模様から字を浮かせる
    '(', ...text, '-fill', work.glow, `label:${work.title}`,
    '-bordercolor', 'none', '-border', '40', '-blur', '0x14', '-blur', '0x14', ')',
    '-gravity', work.gravity, '-geometry', work.offset, '-composite',
    '(', ...text, '-fill', work.fill, `label:${work.title}`,
    '-bordercolor', 'none', '-border', '40', ')',
    '-gravity', work.gravity, '-geometry', work.offset, '-composite',
    '-quality', '90', out,
  ], { stdio: 'inherit' })
  console.log(`${out}  ${(fs.statSync(out).size / 1024).toFixed(0)}KB`)
}
