import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { connectedRuntime } from './lib/connectedRuntime.mjs'
import { embedProjectFolder } from './lib/embedProject.mjs'
import { inspectSampleOverlaps, inspectSampleDimensions } from './lib/sampleSceneAudit.mjs'
import { CONNECTED_LAYOUTS } from './samples/connected-layouts.mjs'

const args = process.argv.slice(2), root = resolve(args.includes('--root') ? args[args.indexOf('--root') + 1] : '.tmp/022-samples')
const report = JSON.parse(readFileSync(join(root, '022-samples-review/migration-report.json'), 'utf8'))
const runtime = await connectedRuntime()
try {
  if (report.reports.length !== 4 || report.sourceElements !== 331) throw new Error('全4作品・331要素の台帳が必要です')
  for (const entry of report.reports) {
    const raw = embedProjectFolder(join(root, entry.projectId)), project = { ...runtime.api.bookProjectSchema.parse(raw), assets: raw.assets }
    const result = runtime.api.validateBookProject(project)
    if (!result.ok || entry.contentCrossings.length || entry.crossings.length || entry.referenceErrors.length) throw new Error(`${entry.projectId}: ${result.errors.join(', ')}`)
    const overlaps = inspectSampleOverlaps(project, runtime.api), dimensions = inspectSampleDimensions(project, entry.entries, CONNECTED_LAYOUTS[entry.sourceId])
    if (overlaps.physicalOverlaps.length || dimensions.errors.length) throw new Error(`${entry.projectId}: ${JSON.stringify({ overlaps: overlaps.physicalOverlaps, errors: dimensions.errors })}`)
    await runtime.api.verifyEmbeddedParts(project.partDefinitions, project.assets)
    if (project.book.spreads.some((spread) => spread.elements.some((element) => element.type !== 'part' && !element.attachment))) throw new Error('旧方式の要素が残っています')
    for (const spread of project.book.spreads) {
      if (spread.elements.some((element) => element.id.includes('support-row-'))) throw new Error(`${spread.id}: 作品を横切る接続帯が残っています`)
      for (const e of spread.elements) {
        if (e.id.endsWith('-anchor')) throw new Error(`${e.id}: 作品固有の支持台が残っています`)
        if (e.type === 'part' && e.part.definition.builtin === 'upright' && e.part.supportDesign !== 'automatic') throw new Error(`${e.id}: 支持が共通処理で設計されていません`)
      }
      if (entry.sourceId === 'four_seasons' && spread.id !== 'spread-5') {
        for (const e of spread.elements.filter(e => /-prop-\d$/.test(e.id))) {
          if (e.type === 'part' || e.presentation?.kind !== 'fiction' || e.attachment?.surface?.nodeId !== '$book') throw new Error(`${e.id}: 季節の小物に支持が補完されています`)
        }
      }
      for (const face of runtime.api.evaluateBookParts(project, spread, Math.PI, 0).faces) {
        // 主支持は後方へ伸ばす。親面の幅外を補う延長紙は横向きになり、通常の接着・収納検査で確認する。
        if (face.support && !face.id.includes('/mount/') && Math.abs(face.v.z) < .85) throw new Error(`${face.id}: 支持紙が鑑賞方向の奥へ向いていません`)
      }
    }
    console.log(`${entry.projectId}: ${project.book.spreads.length}見開き、接続・材料・収納・演出・共面の紙・${dimensions.dimensions.length}部品の寸法・埋め込み部品 OK`)
  }
} finally { await runtime.close() }
