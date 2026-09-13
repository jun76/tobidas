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
      // 支持台は実紙の構造として必要なものだけを許す。演出の参照だけでは必要と見なさない。
      const needed = new Set(), byId = new Map(spread.elements.map(e => [e.id, e]))
      const visit = id => {
        if (needed.has(id)) return
        needed.add(id)
        const mount = byId.get(id)?.part?.mount
        if (mount?.type === 'pair') { visit(mount.a.nodeId); visit(mount.b.nodeId) }
        else if (mount?.type === 'output') visit(mount.nodeId)
      }
      spread.elements.filter(e => e.type === 'part' && !e.id.endsWith('-anchor')).forEach(e => visit(e.id))
      for (const e of spread.elements) if (e.id.endsWith('-anchor') && !needed.has(e.id)) throw new Error(`${e.id}: 演出専用の不要な支持紙です`)
      if (entry.sourceId === 'four_seasons' && spread.id !== 'spread-5') {
        for (const e of spread.elements.filter(e => /-prop-\d$/.test(e.id))) {
          if (e.type === 'part' || e.presentation?.kind !== 'fiction' || e.attachment?.surface?.nodeId !== '$book') throw new Error(`${e.id}: 季節の小物に支持が補完されています`)
        }
      }
      for (const face of runtime.api.evaluateBookParts(project, spread, Math.PI, 0).faces) {
        if (face.support && Math.abs(face.v.z) < .85) throw new Error(`${face.id}: 支持紙が鑑賞方向の奥へ向いていません`)
      }
    }
    console.log(`${entry.projectId}: ${project.book.spreads.length}見開き、接続・材料・収納・演出・共面の紙・${dimensions.dimensions.length}部品の寸法・埋め込み部品 OK`)
  }
} finally { await runtime.close() }
