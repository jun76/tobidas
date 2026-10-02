/**
 * 公開サンプルの生成。作品ごとの定義 (scripts/samples/<work>.mjs) と画面での手直し (overrides/<work>.json) から
 * 下書きを組み、connected.mjs で基本部品と紙面の演出へ組み立てて projects/<作品ID>/ へ書き出す。
 *
 * projects/ はソース管理する生成物なので、project.json を直接直さず、定義・手直し・組み立てを変えて生成し直す。
 * 鑑賞用HTML、作品ZIP、部品ZIP、検証の記録は .tmp/samples-review/ へ出す (--export で公開用ファイルも作る)。
 *
 * 使い方: node scripts/generate-samples.mjs [--work forest_lantern,...] [--export] [--review .tmp/samples-review]
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join, sep } from 'node:path'
import JSZip from 'jszip'
import { BUILDERS } from './samples/registry.mjs'
import { remakeConnected } from './samples/connected.mjs'
import { applyOverrides, loadOverrides } from './samples/overrides.mjs'
import { connectedRuntime } from './lib/connectedRuntime.mjs'
import { hashBytes, writeSampleFolder } from './lib/sampleOutput.mjs'
import { sampleReviewIndex } from './lib/sampleReview.mjs'
import { inspectSampleOverlaps, inspectSampleDimensions } from './lib/sampleSceneAudit.mjs'
import { CONNECTED_LAYOUTS } from './samples/connected-layouts.mjs'

const args = process.argv.slice(2), flag = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const canonical = (value) => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v)
const projectsRoot = resolve('projects'), reviewRoot = resolve(flag('--review', '.tmp/samples-review')), selected = flag('--work', 'all')
const ids = selected === 'all' ? Object.keys(BUILDERS) : selected.split(',')
if (ids.some((id) => !(id in BUILDERS))) throw new Error(`未知の作品: ${selected}`)
// 公開サンプルは同じ定義から同じJSONを得る。内容を更新したときだけ、この値も定義の変更として明示的に進める。
const updatedAt = '2026-09-09T00:00:00.000Z'
const runtime = await connectedRuntime(), { api } = runtime, reports = [], catalog = []
const review = new Map(), exporting = args.includes('--export')
const player = exporting ? readFileSync(resolve('public/player/index.html'), 'utf8') : undefined

/** 生成物の作品フォルダを置き換える。以前の内容はGitの履歴が持つので退避しない */
function replaceSampleFolder(name, files) {
  const dir = resolve(projectsRoot, name)
  if (!/^[a-z0-9_]+$/.test(name) || !dir.startsWith(projectsRoot + sep)) throw new Error(`不正な生成先: ${dir}`)
  rmSync(dir, { recursive: true, force: true })
  for (const [file, bytes] of files) {
    const target = resolve(dir, file)
    if (!target.startsWith(dir + sep)) throw new Error(`不正な生成ファイル: ${target}`)
    mkdirSync(resolve(target, '..'), { recursive: true }); writeFileSync(target, bytes)
  }
}

try {
  for (const id of ids) {
    const work = BUILDERS[id](updatedAt), definition = work.toProject(), overrides = loadOverrides(id)
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
          const holdTime = api.bookContentHoldTime(angle, side, spread.sequence.holdSeconds)
          const times = holdTime === undefined ? api.contentSampleTimes(bindings, spread.sequence.holdSeconds) : [holdTime]
          for (const time of times) {
            const contents = api.evaluateContents(bindings, { openingAngleDeg: angle, maxOpeningAngleDeg: 180, holdTime: Math.min(time, spread.sequence.holdSeconds), clock: () => time })
            const contentErrors = api.inspectContentIntersections(contents, [...paper.faces, pages['left-page'].face, pages['right-page'].face], true)
            if (contentErrors.length) contentCrossings.push({ spreadId: spread.id, side, angle, time, errors: contentErrors })
          }
        } catch (error) { referenceErrors.push({ spreadId: spread.id, side, angle, error: error.message }) }
      }
    }
    const sceneAudit = { ...inspectSampleOverlaps(project, api), ...inspectSampleDimensions(project, entries, CONNECTED_LAYOUTS[id]) }
    const body = api.projectFileJson(project)
    const output = new Map([['project.json', body], ...project.assets.map((asset) => [`assets/${asset.id}`, files.get(asset.id)])])
    // 定義の全要素が、組み立て後の部品か演出へ対応していることを台帳で確かめる
    const allNewIds = new Set(project.book.spreads.flatMap((spread) => {
      const paper = api.evaluateBookParts(project, spread, Math.PI, 0)
      return [...spread.elements.map((element) => element.id), ...paper.contents?.map((content) => content.id) ?? []]
    }))
    if (entries.some((entry) => !entry.newIds.length || entry.newIds.some((id) => !allNewIds.has(id)))) throw new Error(`${id}: 組み立て先のIDに欠落があります`)
    const sourceIds = source.book.spreads.flatMap((spread) => spread.elements.map((element) => spread.id + '/' + element.id)).sort()
    if (JSON.stringify(entries.map((entry) => entry.spreadId + '/' + entry.oldId).sort()) !== JSON.stringify(sourceIds)) throw new Error(`${id}: 定義の要素に対応しない台帳です`)
    const assetHashes = Object.fromEntries(project.assets.map((asset) => [asset.id, hashBytes(files.get(asset.id))]))
    if (project.assets.reduce((n, asset) => n + files.get(asset.id).length, 0) >= 12 * 1024 * 1024) throw new Error(`${id}: 素材合計が12MiB以上です`)
    if (project.assets.some((asset) => asset.type === 'audio' && files.get(asset.id).length > 3 * 1024 * 1024)) throw new Error(`${id}: 音声が3MiBを超えています`)
    if (JSON.stringify(source.authoringGuide) !== JSON.stringify(project.authoringGuide)) throw new Error(`${id}: 制作ガイドが変わっています`)
    const restored = await api.assemblePackage(body, new Map(project.assets.map((asset) => [asset.id, {
      size: files.get(asset.id).length, text: async () => files.get(asset.id).toString('utf8'),
      dataUrl: async (mime) => `data:${mime};base64,${files.get(asset.id).toString('base64')}`, blob: async (mime) => new Blob([files.get(asset.id)], { type: mime }),
    }])))
    if (canonical(JSON.parse(api.projectFileJson(restored.project))) !== canonical(JSON.parse(body))) throw new Error(`${id}: フォルダーの読み込みで作品が変わっています`)
    const unattached = project.book.spreads.reduce((n, spread) => n + spread.elements.filter((element) => element.type !== 'part' && !element.attachment).length, 0)
    if (unattached) throw new Error(`${id}: 紙に接続していない要素が${unattached}件残っています`)
    const report = { sourceId: id, projectId: project.id, title: project.name, spreadCount: project.book.spreads.length, authoringGuideHash: hashBytes(JSON.stringify(source.authoringGuide)), assetHashes,
      sourceElementCount: source.book.spreads.reduce((n, spread) => n + spread.elements.length, 0), entries, overrideResult, overrides,
      validation, validationMs, crossings, contentCrossings, referenceErrors, sceneAudit, folderRoundTrip: true,
      checkedAngles: angleSamples, checkedDirections: ['left', 'right'], phaseCoverage: 'At full opening: key times, key midpoints, and hold endpoints. During opening/closing: the first/last authored pose, as in the book player. Independent interval envelopes for periodic motion and particle drift at every inspected pose. Finite angles and timeline samples, not a continuous collision proof.' }
    reports.push(report)
    const unsafe = validation.errors.length || referenceErrors.length || crossings.length || contentCrossings.length || sceneAudit.physicalOverlaps.length || sceneAudit.errors.length
    if (unsafe) throw new Error(`${id}: 未解決の診断があるため projects/ へは書き出しません\n${[...new Set([
      ...validation.errors, ...referenceErrors.map((item) => item.error), ...crossings.flatMap((item) => item.errors), ...contentCrossings.flatMap((item) => item.errors),
      ...sceneAudit.errors, ...sceneAudit.physicalOverlaps.map(item => `Coincident paper: ${item.a} / ${item.b}`),
    ])].slice(0, 8).join('\n')}`)
    if (exporting) {
      const zip = await api.buildProjectZip(restored.project), roundTrip = await api.readProjectZip(zip)
      if (canonical(JSON.parse(api.projectFileJson(roundTrip.project))) !== canonical(JSON.parse(body))) throw new Error(`${id}: ZIPの読み込みで作品が変わっています`)
      report.zipRoundTrip = true
      review.set(project.id + '.tobidas.zip', zip)
      const html = api.injectProjectJson(player, await api.inlineAssetBodies(roundTrip.project))
      review.set(project.id + '.html', html)
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
    replaceSampleFolder(project.id, output)
    catalog.push({ id: project.id, title: work.meta.title, description: work.meta.description, projectPath: `/projects/${project.id}/`,
      thumbnail: `/projects/${project.id}/assets/${work.meta.cover.front}`, theme: work.meta.theme })
    console.log(`${id}: ${entries.length}要素 / ${project.book.spreads.length}見開き / 検証${Math.round(validationMs)}ms / エラー${validation.errors.length} / 紙交差${crossings.length} / 演出交差${contentCrossings.length} / 共面の紙${sceneAudit.physicalOverlaps.length} / 寸法エラー${sceneAudit.errors.length}`)
  }
  // 手で組んだ作品の登録は残す。catalog.json を生成対象だけで書き直すと、その登録が消える
  const catalogPath = join(projectsRoot, 'catalog.json'), generated = new Set(catalog.map((entry) => entry.id))
  const previous = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')).samples : []
  const order = Object.keys(BUILDERS)
  const samples = [...previous.filter((entry) => !generated.has(entry.id)), ...catalog]
    .sort((a, b) => (order.indexOf(a.id) + 1 || order.length + 1) - (order.indexOf(b.id) + 1 || order.length + 1))
  writeFileSync(catalogPath, JSON.stringify({ samples }, null, 2) + '\n')

  const shots = flag('--shots')
  if (shots) for (const name of readdirSync(resolve(shots))) if (/\.(png|jpg|json)$/.test(name)) review.set('screenshots/' + name, readFileSync(join(resolve(shots), name)))
  for (const [flagName, folder] of [['--ui-checks', 'builder-checks'], ['--part-checks', 'part-checks'], ['--performance-checks', 'performance-checks']]) {
    const source = flag(flagName)
    if (source) for (const name of readdirSync(resolve(source))) if (/\.(png|jpg|json|txt)$/.test(name)) review.set(folder + '/' + name, readFileSync(join(resolve(source), name)))
  }
  if (exporting) review.set('index.html', sampleReviewIndex(reports, Boolean(shots)))
  review.set('report.json', JSON.stringify({ version: 3, sourceElements: reports.reduce((n, report) => n + report.sourceElementCount, 0), reports }, null, 2) + '\n')
  review.set('README.txt', 'tobidas 公開サンプルの確認用ファイル\n\nindex.html: 作品の一覧。\n*.html: 開発サーバーなしで開く鑑賞用ファイル。\n*.tobidas.zip: 標準ビルダーの「作品ZIPを開く」で再編集。\n*.tobidas-part.zip: カスタム部品の読み込みから利用。\nreport.json: 定義の要素と組み立て後の部品・演出の対応、検証結果。\n\n作品フォルダ本体はリポジトリの projects/ にあります。\n')
  writeSampleFolder(resolve(reviewRoot, '..'), reviewRoot.split(sep).at(-1), review)
  console.log(`公開サンプルを${catalog.length}件、projects/ へ生成しました。確認用ファイル: ${reviewRoot}`)
} finally { await runtime.close() }
