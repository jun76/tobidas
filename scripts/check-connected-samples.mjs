import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { connectedRuntime } from './lib/connectedRuntime.mjs'
import { embedProjectFolder } from './lib/embedProject.mjs'

const args = process.argv.slice(2), root = resolve(args.includes('--root') ? args[args.indexOf('--root') + 1] : '.tmp/022-samples')
const report = JSON.parse(readFileSync(join(root, '022-samples-review/migration-report.json'), 'utf8'))
const runtime = await connectedRuntime()
try {
  if (report.reports.length !== 4 || report.sourceElements !== 331) throw new Error('全4作品・331要素の台帳が必要です')
  for (const entry of report.reports) {
    const raw = embedProjectFolder(join(root, entry.projectId)), project = { ...runtime.api.bookProjectSchema.parse(raw), assets: raw.assets }
    const result = runtime.api.validateBookProject(project)
    if (!result.ok || entry.contentCrossings.length || entry.crossings.length || entry.referenceErrors.length) throw new Error(`${entry.projectId}: ${result.errors.join(', ')}`)
    await runtime.api.verifyEmbeddedParts(project.partDefinitions, project.assets)
    if (project.book.spreads.some((spread) => spread.elements.some((element) => element.type !== 'part' && !element.attachment))) throw new Error('旧方式の要素が残っています')
    for (const spread of project.book.spreads) {
      if (spread.elements.some((element) => element.id.includes('support-row-'))) throw new Error(`${spread.id}: 作品を横切る接続帯が残っています`)
      for (const face of runtime.api.evaluateBookParts(project, spread, Math.PI, 0).faces) {
        if (face.support && Math.abs(face.v.z) < .85) throw new Error(`${face.id}: 支持紙が鑑賞方向の奥へ向いていません`)
      }
    }
    console.log(`${entry.projectId}: ${project.book.spreads.length}見開き、接続・材料・収納・演出・埋め込み部品 OK`)
  }
} finally { await runtime.close() }
