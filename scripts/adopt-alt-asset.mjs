/**
 * 任意の画像素材を、公開サンプルの素材置き場へ取り込む道具。
 *
 * サンプル定義 (scripts/samples/<work>.mjs) が宣言する世界寸法と、
 * scripts/samples/assets/<work>/<id>.webp の画素寸法は一致していなければ
 * ならない。ここは「世界での大きさ」だけを受け取り、
 *   透過部品   … アルファの外周を落として、宣言した箱いっぱいに合わせる
 *   紙面背景   … 片面の 1250x1000 へ合わせる
 * という二通りで書き出し、貼り付けるべき数値を表示する。
 *
 *   node scripts/adopt-alt-asset.mjs <work> <入力画像> <出力名.webp> --width 1.6
 *   node scripts/adopt-alt-asset.mjs <work> <入力画像> page-1-left.webp --page
 */
import { mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const [, , work, source, outName, ...rest] = process.argv
if (!work || !source || !outName) {
  console.error('usage: node scripts/adopt-alt-asset.mjs <work> <source-image> <out.webp> [--width W | --height H | --page]')
  process.exit(2)
}

const flag = (name) => {
  const index = rest.indexOf(`--${name}`)
  return index >= 0 ? rest[index + 1] : undefined
}
const asPage = rest.includes('--page')
const worldWidth = Number(flag('width'))
const worldHeight = Number(flag('height'))

const src = resolve(source)
const out = resolve('scripts/samples/assets', work, outName)
mkdirSync(dirname(out), { recursive: true })

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${command} failed\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}

/** shared.mjs の artSize と同じ換算。1024pxを超えず、世界寸法に比例させる */
const artSize = (w, h) => {
  const scale = Math.min(190, 1024 / Math.max(w, h))
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

let declared
if (asPage) {
  // 紙面背景。見開きマスターの左右半分はすでに片面と同じ 1250x1000。
  // 空や稜線が上端に写り込んでいる素材は --keep-bottom で地面だけを切り出す。
  // 斜めから見る紙面では、縦へ伸ばしたぶんは奥行きで詰まって見える。
  // --keep-bottom は手前 (絵の下端) の帯を、--keep-top は奥 (絵の上端) の帯を切り出す。
  // 見開きマスターの地面は手前ほど粒が粗いので、敷石や落ち葉が部品より大きく
  // 見えるときは --keep-top で奥の細かい帯を採る。縦へ伸びたぶんは、紙面を
  // 斜めから見る再生カメラのもとで奥行きに詰まって戻る。
  const bottom = flag('keep-bottom')
  const top = flag('keep-top')
  if (bottom !== undefined && top !== undefined) throw new Error('--keep-bottom と --keep-top は同時に使えません')
  const keep = Number(bottom ?? top ?? 1)
  if (!(keep > 0 && keep <= 1)) throw new Error('--keep-bottom / --keep-top は 0 より大きく 1 以下です')
  declared = { width: 1250, height: 1000 }
  const size = run('magick', [src, '-format', '%w %h', 'info:']).trim().split(/\s+/).map(Number)
  const band = Math.round(size[1] * keep)
  const offset = top !== undefined ? 0 : size[1] - band
  run('magick', [src, '-crop', `${size[0]}x${band}+0+${offset}`, '+repage',
    '-resize', '1250x1000!', '-quality', '86', '-define', 'webp:method=6', out])
} else {
  if (!worldWidth && !worldHeight) throw new Error('--width か --height のどちらかが要ります')
  // アルファの外周を落として、絵そのものの縦横比を得る
  const trim = run('magick', [src, '-trim', '+repage', '-format', '%w %h', 'info:']).trim().split(/\s+/).map(Number)
  const aspect = trim[0] / trim[1]
  const world = worldWidth
    ? { width: worldWidth, height: Math.round((worldWidth / aspect) * 100) / 100 }
    : { width: Math.round(worldHeight * aspect * 100) / 100, height: worldHeight }
  declared = { ...artSize(world.width, world.height), world }
  run('magick', [src, '-trim', '+repage', '-resize', `${declared.width}x${declared.height}!`,
    '-quality', '88', '-define', 'webp:method=6', out])
}

const identity = run('magick', ['identify', '-format', '%wx%h %[channels]', out]).trim()
console.log(JSON.stringify({ out: outName, ...declared, identity, bytes: statSync(out).size }))
