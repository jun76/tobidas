// 020の交換部品と検証作品を通常のスキーマ・評価器・書き出し経路から生成する。
// examples/parts のJSONと素材が編集元。アプリの初期ライブラリには登録しない。
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import JSZip from 'jszip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] ?? path.join(root, '.tmp/020-preview'))
const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, entries: [] }, appType: 'custom', logLevel: 'error' })
try {
  const { partDefinitionSchema } = await server.ssrLoadModule('/src/parts/schema.ts')
  const { partDefinitionJsonSchema } = await server.ssrLoadModule('/src/parts/jsonSchema.ts')
  const { snapshotPartBundle, partBundleFiles } = await server.ssrLoadModule('/src/parts/package.ts')
  const { validatePartDefinition } = await server.ssrLoadModule('/src/parts/validate.ts')
  const { createBookProject, createSpread, createStageElement } = await server.ssrLoadModule('/src/schema/bookDefaults.ts')
  const { validateBookProject } = await server.ssrLoadModule('/src/schema/bookValidate.ts')
  const { projectFileJson, stripAuthoringGuide } = await server.ssrLoadModule('/src/package/serialize.ts')
  const { injectProjectJson } = await server.ssrLoadModule('/src/builder/io/siteExport.ts')
  const { compileBookBeats } = await server.ssrLoadModule('/src/runtime/signals.ts')
  await fs.mkdir(out, { recursive: true })
  await fs.writeFile(path.join(out, 'tobidas-part-v1.schema.json'), JSON.stringify(partDefinitionJsonSchema, null, 2))
  const bundles = {}
  for (const name of ['house', 'cake', 'box-150']) {
    const directory = path.join(root, 'examples/parts', name)
    const definition = partDefinitionSchema.parse(JSON.parse(await fs.readFile(path.join(directory, 'part.json'), 'utf8')))
    const assets = []
    for (const meta of definition.assets) {
      const bytes = await fs.readFile(path.join(directory, 'assets', meta.id))
      const { hash: _hash, ...metadata } = meta
      assets.push({ ...metadata, bytes: bytes.length, data: meta.type === 'svg' ? bytes.toString('utf8') : `data:${meta.mime};base64,${bytes.toString('base64')}` })
    }
    const snapshot = await snapshotPartBundle({ definition, definitions: {}, assets })
    const validation = validatePartDefinition(snapshot.definition, snapshot.definitions)
    if (!validation.ok) throw new Error(`${name}: ${validation.errors.join('\n')}`)
    bundles[name] = snapshot
    const files = await partBundleFiles(snapshot), zip = new JSZip()
    for (const [relative, bytes] of files) {
      const target = path.join(out, 'parts', name, relative)
      await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes)
      zip.file(relative, bytes)
    }
    await fs.writeFile(path.join(out, `${name}.tobidas-part.zip`), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  }
  const project = createBookProject('020 つながる紙の部品')
  project.id = '020-connected-parts'; project.partDefinitions = {}
  project.book.spreads = []
  project.book.appearance.background = '#d8c9a5'
  project.book.appearance.paperColor = '#f1e9d4'
  project.book.camera = { position: [8, 8, 14], target: [0, 1.2, 0], fov: 42 }
  for (const bundle of Object.values(bundles)) {
    project.partDefinitions[bundle.hash] = bundle.definition
    Object.assign(project.partDefinitions, bundle.definitions)
    for (const asset of bundle.assets) if (!project.assets.some((item) => item.id === asset.id)) project.assets.push(asset)
  }
  const builtin = (id) => ({ builtin: id, version: 1 })
  const output = (nodeId, portId) => ({ type: 'output', nodeId, portId })
  const gutter = output('$book', 'gutter')
  const add = (spread, id, name, definition, mount, parameters = {}, materials = {}) => {
    const element = createStageElement('part', mount.nodeId === '$book' ? { type: mount.portId === 'left-page' ? 'left-page' : 'right-page' } : { type: 'element', elementId: mount.nodeId })
    element.id = id; element.name = name; element.part = { definition, mount, parameters, materials }; spread.elements.push(element)
  }
  const page = (id, name, subtitle) => {
    const spread = createSpread(name); spread.id = id; spread.sequence = { holdSeconds: 6, turnSeconds: 3 }
    project.book.spreads.push(spread)
    add(spread, `${id}-caption`, name, builtin('text'), output('$book', 'right-page'), { width: 5.3, height: .75, u: 2.5, v: 4, rotation: 90 },
      { face: { color: '#f7f1de', text: subtitle, textColor: '#463a2a' } })
    return spread
  }
  const first = page('ground-backdrop', '01 背景と地面から家を起こす', '背景と地面の二面から、家を起こす。')
  add(first, 'background', '背景パネル', builtin('backdrop'), gutter, { width: 5, height: 2.7, distance: .8 }, { panel: { color: '#8db8a8' }, support: { color: '#aeb997' } })
  add(first, 'house', '家', { custom: bundles.house.hash }, output('background', 'ground-backdrop'), { width: 1.8, height: 2, distance: 1.5 })
  add(first, 'small-house', '小さな家', { custom: bundles.house.hash }, output('background', 'ground-backdrop'), { width: 1.2, height: 1.5, distance: 3, offset: 1.7 })
  const second = page('full-box', '02 見開き180度の箱', '180°の見開きで、箱が開く。')
  add(second, 'cake', 'ケーキ', { custom: bundles.cake.hash }, gutter, { width: 3.1, height: 1.3, distance: 1.9 })
  const third = page('partial-box', '03 90度の接続先で半開き', '同じ箱でも、90°の接続先なら途中の姿勢。')
  add(third, 'background', '背景パネル', builtin('backdrop'), gutter, { width: 5, height: 3.2, distance: .8 }, { panel: { color: '#88a2b8' } })
  add(third, 'cake', '同じケーキ', { custom: bundles.cake.hash }, output('background', 'ground-backdrop'), { width: 3.1, height: 1.3, distance: 1.9 })
  const fourth = page('nested-parts', '04 面から面へつながる', '部品の接続口へ、次の部品をつなぐ。')
  add(fourth, 'background', '背景パネル', builtin('backdrop'), gutter, { width: 4.5, height: 2.4, distance: .8 }, { panel: { color: '#9daf8a' } })
  add(fourth, 'sign', '一段目の看板', builtin('upright'), output('background', 'ground-backdrop'), { width: 2.6, height: 1.8, distance: 1.3, supportHeight: 1 }, { panel: { color: '#bf846a', text: 'つながる' } })
  add(fourth, 'next-sign', '看板から支える小さな看板', builtin('upright'), output('sign', 'ground-panel'), { width: 1.4, height: 1, distance: 1.3, supportHeight: .5 }, { panel: { color: '#dfba6b', text: 'tobidas' } })
  const validation = validateBookProject(project)
  if (!validation.ok) throw new Error(validation.errors.join('\n'))
  const directory = path.join(out, '020-connected-parts')
  await fs.mkdir(path.join(directory, 'assets'), { recursive: true })
  await fs.writeFile(path.join(directory, 'project.json'), projectFileJson(project))
  const bookZip = new JSZip(); bookZip.file('project.json', projectFileJson(project))
  for (const asset of project.assets) {
    const bytes = asset.type === 'svg' ? asset.data : Buffer.from(asset.data.split(',')[1], 'base64')
    await fs.writeFile(path.join(directory, 'assets', asset.id), bytes); bookZip.file(`assets/${asset.id}`, bytes)
  }
  await fs.writeFile(path.join(out, '020-connected-parts.tobidas.zip'), await bookZip.generateAsync({ type: 'nodebuffer' }))
  const player = await fs.readFile(path.join(root, 'public/player/index.html'), 'utf8')
  await fs.writeFile(path.join(out, '020-connected-parts.html'), injectProjectJson(player, stripAuthoringGuide(project)))
  const report = { errors: validation.errors, warnings: validation.warnings, parts: Object.fromEntries(Object.entries(bundles).map(([id, bundle]) => [id, bundle.hash])),
    beats: compileBookBeats(project.book), project: path.join(directory, 'project.json') }
  await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { await server.close() }
