// 024の論理紙面・二つ折り・親子支持・収納縮小を標準ビルダーで確認する作品。
import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'
import JSZip from 'jszip'

const root = process.cwd(), out = path.join(root, '.tmp/024-preview')
const server = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, entries: [] }, appType: 'custom', logLevel: 'error' })
try {
  const load = name => server.ssrLoadModule(`/src/${name}.ts`)
  const { createBookProject, createSpread, createStageElement } = await load('schema/bookDefaults')
  const { planSupportedPart } = await load('parts/supportPlanning')
  const { evaluateBookParts, deployBookParts } = await load('parts/book')
  const { validateBookProject } = await load('schema/bookValidate')
  const { projectFileJson, stripAuthoringGuide } = await load('package/serialize')
  const { injectProjectJson } = await load('builder/io/siteExport')
  const { compileBookBeats } = await load('runtime/signals')
  const project = createBookProject('024 無限紙面と収納縮小')
  project.id = '024-infinite-paper'; project.book.spreads = []
  project.book.camera = { position: [13, 12, 25], target: [0, 3, -3], fov: 45 }
  project.book.appearance.background = '#dce5eb'
  const page = name => { const spread = createSpread(name); spread.elements = []; project.book.spreads.push(spread); return spread }
  const put = (spread, id, position, width, height, color) => {
    const element = { ...createStageElement('part'), id, name: id, type: 'part', part: {
      definition: { builtin: 'upright', version: 1 }, mount: { type: 'output', nodeId: '$book', portId: 'gutter' },
      parameters: { width, height }, materials: { panel: { color } },
    } }
    const planned = planSupportedPart(project, spread, element, { position }); spread.elements.push(planned)
    return planned
  }
  const far = page('01 紙面外の巨大な遠景と親子支持')
  put(far, '遠景の二つ折り', [0, 0, -9], 22, 10, '#476582')
  put(far, '右の中景', [4, 0, -4], 4, 5, '#478878')
  put(far, '左の中景', [-4, 0, -4], 4, 4, '#b9835d')
  put(far, '手前の小物', [4, 0, 0], 2, 2, '#d6b16e')
  const real = page('02 実ページに接地する巨大な二つ折り')
  put(real, '左右に接地した背景', [0, 0, -1.5], 12, 12, '#567d9c')
  put(real, '背景に接続した前景', [3, 0, 1], 2, 3, '#d5a167')
  const free = page('03 紙面外での自立と側方への連結')
  put(free, '遠方の自立部品', [4, 0, -10], 4, 6, '#66867e')
  put(free, '側方に連結する部品', [8, 0, -10], 2, 3, '#c79968')
  put(free, '背後へ連結する部品', [8, 0, -6], 2, 2, '#b4766f')
  const validation = validateBookProject(project)
  if (!validation.ok) throw new Error(validation.errors.join('\n'))
  await fs.mkdir(out, { recursive: true })
  const json = projectFileJson(project), zip = new JSZip()
  zip.file('project.json', json)
  await fs.writeFile(path.join(out, 'project.json'), json)
  await fs.writeFile(path.join(out, '024-infinite-paper.tobidas.zip'), await zip.generateAsync({ type: 'nodebuffer' }))
  const player = await fs.readFile(path.join(root, 'public/player/index.html'), 'utf8')
  await fs.writeFile(path.join(out, '024-infinite-paper.html'), injectProjectJson(player, stripAuthoringGuide(project)))
  const poses = project.book.spreads.map(spread => ({ name: spread.name, elements: spread.elements.length,
    stowScale: deployBookParts(project, spread, evaluateBookParts(project, spread, 0, 0), 0, 0).deploymentScale ?? 1 }))
  await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify({ validation, poses, beats: compileBookBeats(project.book) }, null, 2))
  console.log(JSON.stringify({ out, poses, validation }))
} finally { await server.close() }
