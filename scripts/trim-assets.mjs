/**
 * サンプル素材の透明余白の点検とトリム。
 *
 * 部品の世界寸法 (width / height) は画像の「枠」に割り当てられる。絵の周りに
 * 透明の余白があると、その割合ぶん絵が小さく描かれ、立ち板なら接地線から浮く。
 * 画像サイズを見ても枠の寸法しか分からないので、点検はアルファの外接矩形で行う。
 *
 * 既定は下見だけ。--apply で実際に切る。
 *
 *   node scripts/trim-assets.mjs                 全作品を下見
 *   node scripts/trim-assets.mjs morning_walk    作品を絞る
 *   node scripts/trim-assets.mjs --apply         切る (WebPを上書き)
 *
 * ImageMagick の `magick` が要る。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { basename } from 'node:path'

const ASSET_ROOT = new URL('./samples/assets/', import.meta.url)
const WORKS = ['forest_lantern', 'morning_walk', 'four_seasons']

/** 紙面と表紙は全面が絵。透明部分を持たないので対象外 */
const isFullBleed = (name) => /^(page-|cover-)/.test(name)

/**
 * 枠の中心が意味を持つ素材。回転する部品は枠の中心を軸に回るので、
 * 左右非対称に切ると軸がずれる。粒子の帯は絵が散っていること自体が絵なので、
 * 外接矩形まで詰めると粒の間隔が変わる。これらは左右上下を同量だけ切る。
 */
const KEEP_CENTER = new Set([
  'windmill-rotor.webp',
  'crossing-arm.webp',
  'particle-leaf.webp',
  'particle-maple.webp',
  'particle-petal.webp',
  'particle-snow.webp',
  'light-mote.webp',
])

/**
 * 同じ枠として扱う素材の束。切り方が別々になると絵が飛ぶ:
 *
 * - `asset` トラックで差し替わる連番 (粒子・季節の絵札) は、枠が変わると
 *   差し替わった瞬間に大きさと位置が跳ねる
 * - パノラマを左右へ割った半分どうしは、縦の切り方が揃っていないと
 *   綴じ目で地平線が段違いになる。内側の辺 (継ぎ目) はそもそも余白を持たない
 * - 重ねて使う2枚 (消灯/点灯) は枠がずれると重ならない
 *
 * axes に挙げた軸だけを束の中で統一する (和集合)。
 */
const GROUPS = [
  { match: /^particle-/, axes: 'xy' },
  { match: /^season-\d/, axes: 'xy' },
  { match: /^cottage-(dark|lit)\.webp$/, axes: 'xy' },
  { match: /^view-.+-[lr]\.webp$/, axes: 'y' },
  { match: /^view-.+-l\.webp$/, axes: 'x' },
  { match: /^view-.+-r\.webp$/, axes: 'x' },
]

/** アルファがこれを超える画素を絵とみなす (builder の readAlphaBounds と同じ境目) */
const ALPHA_THRESHOLD = '3.2%'

// 全面不透明の素材へ %@ を求めると警告を出す。判定は戻り値で行うので黙らせる
const magick = (args) =>
  execFileSync('magick', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

function measure(path) {
  const [width, height] = magick(['identify', '-format', '%w %h', path]).split(' ').map(Number)
  const box = magick([path, '-alpha', 'extract', '-threshold', ALPHA_THRESHOLD, '-format', '%@', 'info:'])
  const parsed = /^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/.exec(box)
  if (!parsed) return { width, height, art: null }
  const [, w, h, x, y] = parsed.map(Number)
  if (w === 0 || h === 0) return { width, height, art: null }
  return { width, height, art: { x, y, width: w, height: h } }
}

/**
 * 絵の縁に残す透明の帯 (px)。
 * 完全に詰めると、線形補間でテクスチャの端が隣の画素と混ざったときに
 * 絵の縁が欠けて見える。1px あれば足り、寸法への影響も無い。
 */
const KEEP_EDGE = 1

/** 切り取る矩形。KEEP_CENTER の素材は中心を保つため上下左右を同量だけ落とす */
function cropOf(name, size) {
  const { width, height, art: tight } = size
  if (!tight) return null
  const art = {
    x: Math.max(0, tight.x - KEEP_EDGE),
    y: Math.max(0, tight.y - KEEP_EDGE),
    width: Math.min(width, tight.x + tight.width + KEEP_EDGE) - Math.max(0, tight.x - KEEP_EDGE),
    height: Math.min(height, tight.y + tight.height + KEEP_EDGE) - Math.max(0, tight.y - KEEP_EDGE),
  }
  if (KEEP_CENTER.has(name)) {
    const dx = Math.min(art.x, width - (art.x + art.width))
    const dy = Math.min(art.y, height - (art.y + art.height))
    if (dx <= 0 && dy <= 0) return null
    return { x: dx, y: dy, width: width - dx * 2, height: height - dy * 2 }
  }
  if (art.x === 0 && art.y === 0 && art.width === width && art.height === height) return null
  return art
}

/** 束に属する素材の外接矩形を、指定軸だけ和集合へ揃える */
function unifyGroups(sizes) {
  for (const group of GROUPS) {
    const members = [...sizes.entries()].filter(([name, size]) => group.match.test(name) && size.art)
    if (members.length < 2) continue
    const boxes = members.map(([, size]) => size.art)
    const x0 = Math.min(...boxes.map((box) => box.x))
    const x1 = Math.max(...boxes.map((box) => box.x + box.width))
    const y0 = Math.min(...boxes.map((box) => box.y))
    const y1 = Math.max(...boxes.map((box) => box.y + box.height))
    for (const [, size] of members) {
      if (group.axes.includes('x')) { size.art.x = x0; size.art.width = x1 - x0 }
      if (group.axes.includes('y')) { size.art.y = y0; size.art.height = y1 - y0 }
    }
  }
}

const apply = process.argv.includes('--apply')
const picked = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const works = picked.length ? picked : WORKS

let trimmed = 0
for (const work of works) {
  const dir = new URL(`${work}/`, ASSET_ROOT)
  const files = readdirSync(dir).filter((name) => name.endsWith('.webp') && !isFullBleed(name)).sort()
  const sizes = new Map(files.map((name) => [name, measure(new URL(name, dir).pathname.replace(/^\//, ''))]))
  unifyGroups(sizes)
  const rows = []
  for (const name of files) {
    const path = new URL(name, dir).pathname.replace(/^\//, '')
    const size = sizes.get(name)
    const crop = cropOf(name, size)
    if (!crop) continue
    trimmed++
    const percent = (value, whole) => `${Math.round((value / whole) * 100)}%`
    rows.push({
      name,
      from: `${size.width}x${size.height}`,
      to: `${crop.width}x${crop.height}`,
      // 落ちる余白 (左/上/右/下)
      margin: [
        percent(crop.x, size.width),
        percent(crop.y, size.height),
        percent(size.width - (crop.x + crop.width), size.width),
        percent(size.height - (crop.y + crop.height), size.height),
      ].join('/'),
      aspect: (crop.width / crop.height).toFixed(3),
      crop,
      path,
    })
  }
  if (!rows.length) {
    console.log(`${work}: 余白のある素材はありません`)
    continue
  }
  console.log(`\n${work}  (${rows.length}/${files.length} 件に余白)`)
  console.log('  素材                          枠 → 絵            余白 左/上/右/下   絵の縦横比')
  for (const row of rows) {
    console.log(`  ${basename(row.name).padEnd(28)} ${`${row.from} → ${row.to}`.padEnd(18)} ${row.margin.padEnd(16)} ${row.aspect}`)
  }
  if (!apply) continue
  for (const row of rows) {
    magick([
      row.path,
      '-crop', `${row.crop.width}x${row.crop.height}+${row.crop.x}+${row.crop.y}`,
      '+repage',
      '-quality', '88', '-define', 'webp:method=6',
      row.path,
    ])
  }
  console.log(`  → ${rows.length} 件を切りました`)
}

console.log(`\n${apply ? '切り取り' : '下見'}: 対象 ${trimmed} 件`)
if (!apply && trimmed) console.log('切るには --apply を付けて実行する。切ったあとは定義側の縦横比 (artSize / wide) を合わせ直すこと')
