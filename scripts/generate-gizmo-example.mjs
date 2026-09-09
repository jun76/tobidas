// 021の接続編集を共通の設計計画へ通し、再読み込み用作品と配布用HTMLを作る。
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import JSZip from 'jszip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] ?? path.join(root, '.tmp/021-preview'))
const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, entries: [] }, appType: 'custom', logLevel: 'error' })
try {
  const load = (module) => server.ssrLoadModule(`/src/${module}.ts`)
  const { newPartDefinition } = await load('parts/schema')
  const { partDefinitionJsonSchema } = await load('parts/jsonSchema')
  const { snapshotPartBundle, partBundleFiles, importPartFiles } = await load('parts/package')
  const { createBookProject, createSpread, createStageElement } = await load('schema/bookDefaults')
  const { validateBookProject } = await load('schema/bookValidate')
  const { projectFileJson, stripAuthoringGuide } = await load('package/serialize')
  const { assemblePackage } = await load('package/assemble')
  const { injectProjectJson } = await load('builder/io/siteExport')
  const { compileBookBeats } = await load('runtime/signals')
  const { bookEditScene, applyBookEditPlan } = await load('parts/bookEdit')
  const { planPartEdit } = await load('parts/edit')

  await fs.mkdir(out, { recursive: true })
  const inner = newPartDefinition('傾きを編集できる小物', { kind: 'fold-pair', maxOpeningAngleDeg: 90 })
  inner.id = '021-leaning-panel'
  inner.parameters.lean = { type: 'angle', label: '傾き', default: 90, min: 30, max: 150 }
  inner.nodes = [{ id: 'panel', name: '小物', definition: { builtin: 'upright', version: 1 }, mount: { type: 'input' },
    parameters: { width: 1.2, height: 1.2, distance: 1, supportHeight: .6, tiltAngle: { parameter: 'lean' } },
    materials: { panel: { color: '#d99678', text: 'PART' } } }]
  inner.editHandles = [{ id: 'leaning', label: '傾き', kind: 'angle', parameter: 'lean', nodeId: 'panel', operation: 'tiltAngle' }]
  const child = await snapshotPartBundle({ definition: inner, definitions: {}, assets: [] })
  const outer = newPartDefinition('入れ子の小物', inner.input)
  outer.id = '021-nested-panel'
  outer.parameters.angle = { ...inner.parameters.lean }
  outer.nodes = [{ id: 'child', name: '内部の小物', definition: { custom: child.hash }, mount: { type: 'input' },
    parameters: { lean: { parameter: 'angle' } }, materials: {}, uniformScale: .7 }]
  outer.editHandles = [{ id: 'angle', label: '傾き', kind: 'angle', parameter: 'angle', nodeId: 'child', operation: 'leaning' }]
  const frozen = await snapshotPartBundle({ definition: outer, definitions: { [child.hash]: child.definition }, assets: [] })
  const partFiles = await partBundleFiles(frozen), imported = await importPartFiles(partFiles), partZip = new JSZip()
  for (const [name, bytes] of partFiles) {
    const target = path.join(out, 'nested-panel', name)
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes)
    partZip.file(name, bytes)
  }
  await fs.writeFile(path.join(out, 'nested-panel.tobidas-part.zip'), await partZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  await fs.writeFile(path.join(out, 'tobidas-part-v1.schema.json'), JSON.stringify(partDefinitionJsonSchema, null, 2))

  let project = createBookProject('021 接続を保つ配置編集')
  project.id = '021-connected-gizmos'; project.book.spreads = []
  project.partDefinitions = { ...imported.definitions, [frozen.hash]: imported.definition }
  project.book.appearance.background = '#d8c9a5'; project.book.appearance.paperColor = '#f1e9d4'
  project.book.camera = { position: [8, 8, 14], target: [0, 1.1, 0], fov: 42 }
  const output = (nodeId, portId) => ({ type: 'output', nodeId, portId })
  const gutter = output('$book', 'gutter'), right = output('$book', 'right-page')
  const builtin = (id) => ({ builtin: id, version: id === 'backdrop' ? 2 : 1 })
  const add = (spreadId, id, name, definition, mount, parameters = {}, materials = {}) => {
    const spread = project.book.spreads.find((spread) => spread.id === spreadId)
    const element = createStageElement('part', mount.nodeId === '$book' ? { type: 'right-page' } : { type: 'element', elementId: mount.nodeId })
    element.id = id; element.name = name; element.part = { definition, mount, parameters, materials }; spread.elements.push(element)
  }
  const page = (id, name, text) => {
    const spread = createSpread(name); spread.id = id; spread.sequence = { holdSeconds: 6, turnSeconds: 3 }
    project.book.spreads.push(spread)
    add(id, `${id}-caption`, name, builtin('text'), right, { width: 5.3, height: .75, u: 2.5, v: 4, rotation: 90 },
      { face: { color: '#f7f1de', text, textColor: '#463a2a' } })
    return id
  }
  const edits = []
  const edit = (spreadId, id, intent) => {
    const plan = planPartEdit(bookEditScene(project, spreadId), id, intent)
    if (!plan.ok) throw new Error(`${spreadId}/${id}: ${plan.detail}`)
    project = applyBookEditPlan(project, spreadId, plan)
    edits.push({ spreadId, id, intent, checkedAngles: plan.checkedAngles })
  }
  const bg = (spreadId) => add(spreadId, `${spreadId}-background`, '背景屏風', builtin('backdrop'), gutter,
    { width: 9, height: 2, offset: -1 }, { '*': { color: '#668e7e' } })
  const first = page('move-tilt', '01 移動・傾き・向き', '足元と接続を保ち、位置と角度を変える。')
  bg(first)
  add(first, 'small-panel', '移動して75°に傾けた小物', builtin('upright'), output(`${first}-background`, 'ground-backdrop'),
    { width: 1.1, height: 1.2, distance: .9, supportHeight: .7 }, { panel: { color: '#dc9871' } })
  edit(first, 'small-panel', { type: 'translate', delta: [.4, .3] })
  edit(first, 'small-panel', { type: 'rotate', handle: 'tiltAngle', value: 75 })
  add(first, 'angled-panel', '45°の向きへ開く小物', builtin('angled-upright'), output(`${first}-background`, 'ground-backdrop-b'),
    { width: 1.3, height: 1, offset: -.8, yawAngle: 35 }, { panel: { color: '#809bc9' } })
  edit(first, 'angled-panel', { type: 'rotate', handle: 'yawAngle', value: 45 })

  const second = page('parent-paper', '02 親の変更と貼り紙', '親の開き方を変えても、子の接続を保つ。')
  bg(second)
  add(second, 'child-panel', '親へ追従する小物', builtin('upright'), output(`${second}-background`, 'ground-backdrop'),
    { width: 1.1, height: 1.2, distance: 1.1, supportHeight: .7 }, { panel: { color: '#d6aa65' } })
  edit(second, `${second}-background`, { type: 'rotate', handle: 'splayAngle', value: 130 })
  edit(second, `${second}-background`, { type: 'scale', value: .9 })
  add(second, 'label', '回転して張り出す貼り紙', builtin('flat'), output(`${second}-background`, 'panel-b'),
    { width: 1.2, height: .7, u: .2, v: 1.4 }, { face: { color: '#a4bed4', text: 'PAPER' } })
  edit(second, 'label', { type: 'translate', delta: [.35, .2] })
  edit(second, 'label', { type: 'rotate', handle: 'surface-angle', value: 25 })

  const third = page('similarity', '03 立体の等比拡縮', '角度を保ち、立体と内部の支持を同じ倍率へ。')
  add(third, 'small-box', '0.75倍の箱', builtin('folding-box'), gutter, { width: 1.4, height: 1, distance: .9, offset: -2 }, { '*': { color: '#a7bc96' } })
  add(third, 'large-box', '1.5倍の箱', builtin('folding-box'), gutter, { width: 1.4, height: 1, distance: .9, offset: 1.4 }, { '*': { color: '#c7a2b0' } })
  edit(third, 'small-box', { type: 'scale', value: .75 })
  edit(third, 'large-box', { type: 'scale', value: 1.5 })

  const fourth = page('nested', '04 交換した入れ子の部品', '保存して読み込んだ部品にも、同じ角度と倍率。')
  bg(fourth)
  add(fourth, 'nested-small', '読み込んだ小物', { custom: frozen.hash }, output(`${fourth}-background`, 'ground-backdrop'))
  add(fourth, 'nested-large', '拡大して傾けた小物', { custom: frozen.hash }, output(`${fourth}-background`, 'ground-backdrop-b'))
  edit(fourth, 'nested-large', { type: 'scale', value: 1.6 })
  edit(fourth, 'nested-large', { type: 'rotate', handle: 'angle', value: 75 })

  const validation = validateBookProject(project)
  if (!validation.ok) throw new Error(validation.errors.join('\n'))
  const refused = planPartEdit(bookEditScene(project, third), 'large-box', { type: 'scale', value: 30 })
  if (refused.ok) throw new Error('The invalid enlargement was accepted')
  const json = projectFileJson(project), restored = (await assemblePackage(json, new Map())).project
  if (JSON.stringify(restored.book.spreads.map((s) => s.elements.map((e) => e.part))) !== JSON.stringify(project.book.spreads.map((s) => s.elements.map((e) => e.part)))) throw new Error('The saved placement changed on import')
  const directory = path.join(out, '021-connected-gizmos')
  await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, 'project.json'), json)
  const zip = new JSZip(); zip.file('project.json', json)
  await fs.writeFile(path.join(out, '021-connected-gizmos.tobidas.zip'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
  const player = await fs.readFile(path.join(root, 'public/player/index.html'), 'utf8')
  await fs.writeFile(path.join(out, '021-connected-gizmos.html'), injectProjectJson(player, stripAuthoringGuide(restored)))
  const report = { errors: validation.errors, warnings: validation.warnings, edits, refused: refused.detail,
    beats: compileBookBeats(project.book), project: path.join(directory, 'project.json') }
  await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ project: report.project, edits: edits.length, refused: refused.detail, errors: validation.errors }))
} finally { await server.close() }
