/**
 * 公開サンプル3作品の生成 (docs/007 §10)。
 *
 * 作品ごとの定義ファイルが紙工作の配置を宣言し、ここは書き出しだけを担う。
 * 配置の妥当性 (紙面からのはみ出し、収納時の縮小) は
 * scripts/samples/shared.mjs が投入時に検査し、
 * 開姿勢の通し検査は src/runtime/stow/containment.ts が npm test で行う。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build as forestLantern } from './samples/forest-lantern.mjs'
import { build as morningWalk } from './samples/morning-walk.mjs'
import { build as fourSeasons } from './samples/four-seasons.mjs'
import { applyOverrides, loadOverrides } from './samples/overrides.mjs'

const ROOT = 'projects'
const BUILDERS = [forestLantern, morningWalk, fourSeasons]
// 公開サンプルはソース管理する生成物なので、同じ generator から同じJSONを得る。
// 内容を更新したときだけ、この値も generator の変更として明示的に進める。
const updatedAt = '2026-07-26T00:00:00.000Z'

const catalog = []
for (const builder of BUILDERS) {
  const work = builder(updatedAt)
  const project = work.toProject()
  // 画面で詰めた手直しは overrides/<work>.json が持つ。定義の語彙で書けない
  // 調整を project.json へ直に入れると、次の生成で消えてしまう
  const patch = applyOverrides(project, loadOverrides(project.id))
  const files = work.files()
  const dir = join(ROOT, project.id)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'assets'), { recursive: true })
  const kept = new Set(project.assets.map((asset) => asset.id))
  for (const [name, content] of files) if (kept.has(name)) writeFileSync(join(dir, 'assets', name), content)
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2) + '\n')

  const bytes = project.assets.reduce((total, asset) => total + (asset.bytes ?? 0), 0)
  const elements = project.book.spreads.reduce((total, spread) => total + spread.elements.length, 0)
  const tracks = project.book.spreads.reduce((total, spread) => total + spread.timeline.tracks.length, 0)
  const patchNote = patch.patched || patch.removed
    ? ` [手直し ${patch.patched}件 / 削除 ${patch.removed}件 / 素材 ${patch.dropped}件落とし]`
    : ''
  console.log(`${project.id}: ${project.book.spreads.length}見開き / ${elements}部品 / ${tracks}トラック / ${project.assets.length}アセット (${(bytes / 1024).toFixed(0)}KB)${patchNote}`)

  catalog.push({
    id: project.id,
    title: work.meta.title,
    description: work.meta.description,
    projectPath: `/projects/${project.id}/`,
    thumbnail: `/projects/${project.id}/assets/${work.meta.cover.front}`,
    theme: work.meta.theme,
  })
}
writeFileSync(join(ROOT, 'catalog.json'), JSON.stringify({ samples: catalog }, null, 2) + '\n')
console.log(`公開サンプルを${catalog.length}件生成しました`)
