// 再生に関わるソースの内容ハッシュ。ビルダー本体と同梱プレイヤーが同じエンジンかを照合する。
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** 再生画面と描画・機構の評価に関わる範囲。ビルダーの画面だけの変更は含めない */
const ENGINE_DIRS = ['src/parts', 'src/runtime', 'src/schema', 'src/package', 'src/player', 'src/audio', 'src/styles', 'src/ui']
const ENGINE_FILES = ['player.html', 'vite.player.config.ts', 'scripts/embed-player.mjs', 'package-lock.json']

export function engineHash(root = process.cwd()) {
  const hash = createHash('sha256')
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (!/\.test\.[tj]sx?$/.test(entry.name)) files.push(full)
    }
  }
  for (const dir of ENGINE_DIRS) walk(path.join(root, dir))
  for (const file of ENGINE_FILES) if (fs.existsSync(path.join(root, file))) files.push(path.join(root, file))
  for (const file of files) {
    hash.update(path.relative(root, file).split(path.sep).join('/')); hash.update('\0')
    hash.update(fs.readFileSync(file)); hash.update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}
