// dist-player (vite.player.config.ts の成果物) を public/player/ へ同梱する。
// JS/CSS は index.html へインライン化し、単一ファイルのプレイヤーにする —
// サイト書き出しの成果物を file:// で直接開いても動かすため (モジュールスクリプトの
// 外部参照や fetch は file:// では CORS でブロックされる)。
// ビルダーの「サイト書き出し」はここに置かれた manifest.json とファイル一式を
// ブラウザ内で fetch し、作品データを注入して .site.zip に束ねる。
import fs from 'node:fs'
import path from 'node:path'

const src = 'dist-player'
const dest = 'public/player'

if (!fs.existsSync(path.join(src, 'player.html'))) {
  console.error('dist-player がありません。先に vite build -c vite.player.config.ts を実行してください')
  process.exit(1)
}

fs.rmSync(dest, { recursive: true, force: true })
fs.mkdirSync(dest, { recursive: true })

copyDir(src, '')

function copyDir(from, rel) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const abs = path.join(from, e.name)
    if (e.isDirectory()) {
      fs.mkdirSync(path.join(dest, rel, e.name), { recursive: true })
      copyDir(abs, rel + e.name + '/')
    } else {
      // player.html は配布 ZIP の入口になるため index.html へ改名する
      const name = rel === '' && e.name === 'player.html' ? 'index.html' : rel + e.name
      fs.copyFileSync(abs, path.join(dest, name))
    }
  }
}

// --- index.html へ JS/CSS をインライン化 ---------------------------------------
const htmlPath = path.join(dest, 'index.html')
let html = fs.readFileSync(htmlPath, 'utf8')
const inlined = []

html = html.replace(/<script type="module"[^>]*\bsrc="\.\/([^"]+)"[^>]*><\/script>/g, (_m, file) => {
  // "</script" や "<!--" が JS 中 (文字列リテラル内) に現れても HTML パーサを壊さないよう
  // エスケープする。どちらも文字列リテラル内では同値な表現になる
  const js = fs
    .readFileSync(path.join(dest, file), 'utf8')
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--')
  inlined.push(file)
  return `<script type="module">\n${js}\n</script>`
})
html = html.replace(/<link rel="stylesheet"[^>]*\bhref="\.\/([^"]+)"[^>]*>/g, (_m, file) => {
  const css = fs.readFileSync(path.join(dest, file), 'utf8').replace(/<\/style/gi, '<\\/style')
  inlined.push(file)
  return `<style>\n${css}\n</style>`
})
// 単一チャンク前提のため modulepreload は不要 (残っていれば外部参照になるので除去)
html = html.replace(/[ \t]*<link rel="modulepreload"[^>]*>\r?\n?/g, '')

fs.writeFileSync(htmlPath, html)
for (const f of inlined) {
  fs.rmSync(path.join(dest, f))
}
const assetsDir = path.join(dest, 'assets')
if (fs.existsSync(assetsDir) && fs.readdirSync(assetsDir).length === 0) {
  fs.rmdirSync(assetsDir)
}

// --- manifest.json (サイト書き出しが ZIP に含めるファイル一覧) -----------------
const files = []
listFiles(dest, '')
function listFiles(from, rel) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) listFiles(path.join(from, e.name), rel + e.name + '/')
    else files.push(rel + e.name)
  }
}
fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify({ files }, null, 2))
console.log(`プレイヤー同梱: ${dest} (${files.length} ファイル, インライン化: ${inlined.length})`)
