import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { BUILDERS } from './samples/registry.mjs'
import { remakeConnected } from './samples/connected.mjs'
import { applyOverrides, loadOverrides } from './samples/overrides.mjs'
import { connectedRuntime } from './lib/connectedRuntime.mjs'
import { directoryHashes, hashBytes, writeSampleFolder } from './lib/sampleOutput.mjs'
import JSZip from 'jszip'
import { sampleReviewIndex } from './lib/sampleReview.mjs'

const args = process.argv.slice(2), flag = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const canonical = (value) => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v)
const root = resolve(flag('--out-root', '.tmp/022-samples')), selected = flag('--work', 'all')
if (root === resolve('projects')) throw new Error('022の実験出力には原本以外の --out-root を指定してください')
const ids = selected === 'all' ? Object.keys(BUILDERS) : selected.split(',')
if (ids.some((id) => !(id in BUILDERS))) throw new Error(`未知の作品: ${selected}`)
const runtime = await connectedRuntime(), { api } = runtime, reports = []
const review = new Map(), exporting = args.includes('--export'), originalsHash = directoryHashes(resolve('projects'))
const player = exporting ? readFileSync(resolve('public/player/index.html'), 'utf8') : undefined
console.log(`実験版の出力先: ${root}`)
try {
  for (const id of ids) {
    const work = BUILDERS[id]('2026-09-09T00:00:00.000Z'), definition = work.toProject(), overrides = loadOverrides(id)
    const overrideResult = applyOverrides(definition, overrides)
    const source = api.bookProjectSchema.parse(definition), files = work.files()
    source.assets = source.assets.map((meta) => ({ ...meta, data: `data:${meta.mime};base64,${files.get(meta.id).toString('base64')}` }))
    const { project, entries } = await remakeConnected(source, api)
    const started = performance.now(), validation = api.validateBookProject(project), validationMs = performance.now() - started
    const crossings = [], contentCrossings = [], referenceErrors = [], angleSamples = [0, 5, 15, 30, 60, 90, 120, 150, 175, 180]
    for (const spread of project.book.spreads) {
      for (const side of ['left', 'right']) for (const angle of angleSamples) {
        try {
          const left = side === 'left' ? angle * Math.PI / 180 : Math.PI, right = side === 'right' ? (180 - angle) * Math.PI / 180 : 0
          const paper = api.evaluateBookParts(project, spread, left, right)
          const errors = api.inspectIntersections(paper)
          if (errors.length) crossings.push({ spreadId: spread.id, side, angle, errors })
          const bindings = api.bindBookContents(project, spread, paper, left, right)
          const pages = api.pagePorts(8, 6.4, left, right)
          const times = api.contentSampleTimes(bindings, spread.sequence.holdSeconds)
          for (const time of times) {
            const contents = api.evaluateContents(bindings, { openingAngleDeg: angle, maxOpeningAngleDeg: 180, holdTime: Math.min(time, spread.sequence.holdSeconds), clock: () => time })
            const contentErrors = api.inspectContentIntersections(contents, [...paper.faces, pages['left-page'].face, pages['right-page'].face], true)
            if (contentErrors.length) contentCrossings.push({ spreadId: spread.id, side, angle, time, errors: contentErrors })
          }
        } catch (error) { referenceErrors.push({ spreadId: spread.id, side, angle, error: error.message }) }
      }
    }
    const body = api.projectFileJson(project)
    const output = new Map([['project.json', body], ...project.assets.map((asset) => [`assets/${asset.id}`, files.get(asset.id)])])
    const sourceRaw = api.bookProjectSchema.parse(JSON.parse(readFileSync(resolve('projects', id, 'project.json'), 'utf8')))
    const allNewIds = new Set(project.book.spreads.flatMap((spread) => {
      const paper = api.evaluateBookParts(project, spread, Math.PI, 0)
      return [...spread.elements.map((element) => element.id), ...paper.contents?.map((content) => content.id) ?? []]
    }))
    if (entries.some((entry) => !entry.newIds.length || entry.newIds.some((id) => !allNewIds.has(id)))) throw new Error(`${id}: 移行先IDに欠落があります`)
    const originalIds = sourceRaw.book.spreads.flatMap((spread) => spread.elements.map((element) => spread.id + '/' + element.id)).sort()
    if (JSON.stringify(entries.map((entry) => entry.spreadId + '/' + entry.oldId).sort()) !== JSON.stringify(originalIds)) throw new Error(`${id}: 原本の要素に対応しない移行台帳です`)
    const assetHashes = Object.fromEntries(project.assets.map((asset) => {
      const generated = files.get(asset.id), original = readFileSync(resolve('projects', id, 'assets', asset.id))
      if (hashBytes(generated) !== hashBytes(original)) throw new Error(`${id}: 原本から素材が変わっています: ${asset.id}`)
      return [asset.id, hashBytes(generated)]
    }))
    if (project.assets.reduce((n, asset) => n + files.get(asset.id).length, 0) >= 12 * 1024 * 1024) throw new Error(`${id}: 素材合計が12MiB以上です`)
    if (project.assets.some((asset) => asset.type === 'audio' && files.get(asset.id).length > 3 * 1024 * 1024)) throw new Error(`${id}: 音声が3MiBを超えています`)
    if (JSON.stringify(sourceRaw.authoringGuide) !== JSON.stringify(project.authoringGuide)) throw new Error(`${id}: 制作ガイドが変わっています`)
    const restored = await api.assemblePackage(body, new Map(project.assets.map((asset) => [asset.id, {
      size: files.get(asset.id).length, text: async () => files.get(asset.id).toString('utf8'),
      dataUrl: async (mime) => `data:${mime};base64,${files.get(asset.id).toString('base64')}`, blob: async (mime) => new Blob([files.get(asset.id)], { type: mime }),
    }])))
    if (canonical(JSON.parse(api.projectFileJson(restored.project))) !== canonical(JSON.parse(body))) throw new Error(`${id}: フォルダーの読み込みで作品が変わっています`)
    const legacyCount = project.book.spreads.reduce((n, spread) => n + spread.elements.filter((element) => element.type !== 'part' && !element.attachment).length, 0)
    if (legacyCount) throw new Error(`${id}: 旧収納の要素が${legacyCount}件残っています`)
    const report = { sourceId: id, projectId: project.id, title: project.name, spreadCount: project.book.spreads.length, authoringGuideHash: hashBytes(JSON.stringify(source.authoringGuide)), assetHashes,
      sourceElementCount: source.book.spreads.reduce((n, spread) => n + spread.elements.length, 0), entries, overrideResult, overrides,
      validation, validationMs, crossings, contentCrossings, referenceErrors, legacyCount, folderRoundTrip: true,
      checkedAngles: angleSamples, checkedDirections: ['left', 'right'], phaseCoverage: 'Key times, key midpoints, hold endpoints, and independent interval envelopes for all periodic motion and particle drift. Finite angles and timeline samples, not a continuous collision proof.',
      preservation: { guide: true, assets: true, author: JSON.stringify(project.author) === JSON.stringify(sourceRaw.author), audio: JSON.stringify(project.audio) === JSON.stringify(sourceRaw.audio),
        lightingChanges: ['画像を貼った紙の拡散照明に合わせ、環境光を明るく中立色へ調整。明暗変化の時刻を維持。'],
        supportChanges: ['正面から隠れやすい後方支持へ変更。家・木・机などの既存面を使い、横断する接続帯を廃止。'],
        cameraChanges: id === 'four_seasons' ? ['最後の紙の2%拡大を、同時刻のカメラ接近へ置換'] : [] } }
    reports.push(report)
    const unsafe = validation.errors.length || referenceErrors.length || crossings.length || contentCrossings.length
    if (unsafe && !root.startsWith(resolve('.tmp') + '\\')) throw new Error(`${id}: 未解決の診断があるためDocumentsには出力しません`)
    if (exporting) {
      if (unsafe) throw new Error(`${id}: 未解決の診断があるため公開用ファイルは生成できません\n${[...new Set([
        ...validation.errors, ...referenceErrors.map((item) => item.error), ...crossings.flatMap((item) => item.errors), ...contentCrossings.flatMap((item) => item.errors),
      ])].slice(0, 8).join('\n')}`)
      const zip = await api.buildProjectZip(restored.project), roundTrip = await api.readProjectZip(zip)
      if (canonical(JSON.parse(api.projectFileJson(roundTrip.project))) !== canonical(JSON.parse(body))) throw new Error(`${id}: ZIPの読み込みで作品が変わっています`)
      report.zipRoundTrip = true
      review.set(project.id + '.tobidas.zip', zip)
      const html = api.injectProjectJson(player, await api.inlineAssetBodies(roundTrip.project))
      review.set(project.id.slice(4) + '.html', html)
      report.htmlBytes = Buffer.byteLength(html)
      for (const definition of Object.values(project.partDefinitions)) {
        if (review.has(definition.id + '.tobidas-part.zip')) continue
        const partFiles = await api.partBundleFiles({ definition, definitions: project.partDefinitions, assets: project.assets })
        const imported = await api.importPartFiles(partFiles)
        const validation = api.validatePartDefinition(imported.definition, imported.definitions)
        if (!validation.ok) throw new Error(`部品の交換に失敗: ${definition.id}: ${validation.errors.join(', ')}`)
        const archive = new JSZip(); for (const [name, bytes] of partFiles) archive.file(name, bytes)
        review.set(definition.id + '.tobidas-part.zip', await archive.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
      }
    }
    writeSampleFolder(root, project.id, output)
    console.log(`${id}: ${entries.length}要素 / ${project.book.spreads.length}見開き / 検証${Math.round(validationMs)}ms / エラー${validation.errors.length} / 紙交差${crossings.length} / 演出交差${contentCrossings.length}`)
    if (validation.errors.length) console.log(validation.errors.slice(0, 8))
    if (crossings.length) console.log(crossings.slice(0, 2))
    if (contentCrossings.length) console.log([...new Set(contentCrossings.flatMap((item) => item.errors))].slice(0, 20))
  }
  if (JSON.stringify(originalsHash) !== JSON.stringify(directoryHashes(resolve('projects')))) throw new Error('リポジトリの原本に差分があります')
  const shots = flag('--shots')
  if (shots) for (const name of readdirSync(resolve(shots))) if (/\.(png|jpg|json)$/.test(name)) review.set('screenshots/' + name, readFileSync(join(resolve(shots), name)))
  for (const [flagName, folder] of [['--ui-checks', 'builder-checks'], ['--part-checks', 'part-checks'], ['--performance-checks', 'performance-checks']]) {
    const source = flag(flagName)
    if (source) for (const name of readdirSync(resolve(source))) if (/\.(png|jpg|json|txt)$/.test(name)) review.set(folder + '/' + name, readFileSync(join(resolve(source), name)))
  }
  if (exporting) review.set('index.html', sampleReviewIndex(reports, Boolean(shots)))
  review.set('migration-report.json', JSON.stringify({ version: 2, sourceElements: reports.reduce((n, report) => n + report.sourceElementCount, 0), originalProjectsUnchanged: true, reports }, null, 2) + '\n')
  review.set('README.txt', '022 接続する紙と演出の実験版\n\nindex.html: 4作品の一覧。\n*.html: 開発サーバーなしで開く鑑賞用ファイル。\n*.tobidas.zip: 標準ビルダーの「作品ZIPを開く」で再編集。\n*.tobidas-part.zip: カスタム部品の読み込みから利用。\nmigration-report.json: 元の331要素と変更理由、検証結果。\nscreenshots/: 保持時刻・開閉途中・固定位相の確認画像。\nbuilder-checks/、part-checks/: 標準画面からの読み戻しと編集の確認。\n\n原本のprojectsは変更していません。\n')
  writeSampleFolder(root, '022-samples-review', review)
} finally { await runtime.close() }
