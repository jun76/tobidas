import { describe, expect, it } from 'vitest'
import { createBookProject, createStageElement } from '../schema/bookDefaults'
import { makeMechanism } from '../schema/mechanism'
import { validateBookProject } from '../schema/bookValidate'
import type { AssemblyElement } from '../schema/stageElement'
import { decodeProject, encodeProject } from '../builder/persistence/projectCodec'
import { injectProjectJson } from '../builder/io/siteExport'
import { assemblePackage } from './assemble'
import { externalizeAssets, inlineAssetBodies, projectFileJson } from './serialize'
import { evaluateAssemblyScene } from '../runtime/mechanisms/scene'

function fixture() {
  const project = createBookProject('機構の保存')
  project.assets = [
    { id: 'front.svg', name: '表', type: 'svg', mime: 'image/svg+xml', data: '<svg xmlns="http://www.w3.org/2000/svg"><path fill="red" d="M0 0h10v10z"/></svg>' },
    { id: 'back.svg', name: '裏', type: 'svg', mime: 'image/svg+xml', data: '<svg xmlns="http://www.w3.org/2000/svg"><path fill="blue" d="M0 0h10v10z"/></svg>' },
  ]
  const root = createStageElement('assembly') as AssemblyElement
  root.mechanism = makeMechanism('box', { parameters: { width: 4, height: 2 }, deployment: { mode: 'virtual' }, staging: { openScale: 3, closedScale: .07, floatAmplitude: [0, 1, 0] },
    surfaces: { 'top-left': { color: '#ffffff', image: 'front.svg', backImage: 'back.svg', text: '</script>箱', visible: true } } })
  root.composition = { kind: 'house', count: 1, spacing: 1 }
  root.baseTransform.position = [0, 0, 0]
  const child = createStageElement('visual', { type: 'element', elementId: root.id })
  if (child.type !== 'visual') throw new Error('visual fixture expected')
  child.image = 'front.svg'
  child.surfaceAttachment = { surfaceId: 'top-left', u: .25, v: .75, offset: .03 }
  project.book.spreads[0].elements.push(root, child)
  return project
}

describe('新機構の保存と公開データ', () => {
  it('作品フォルダの再読込で面素材・面アンカー・複合パラメータと巨大展開を保つ', async () => {
    const project = fixture()
    const files = new Map(project.assets.map((asset) => [asset.id, {
      text: async () => String(asset.data), dataUrl: async () => String(asset.data), blob: async () => new Blob([asset.data]),
    }]))
    const saved = projectFileJson(project)
    expect(saved).not.toContain('<svg')
    const restored = (await assemblePackage(saved, files)).project
    expect(restored).toEqual(project)
    expect(validateBookProject(restored).errors).toEqual([])
    expect(decodeProject(encodeProject(restored))).toEqual(project)
  })

  it('宣言された面素材のファイル欠損と未登録の面素材IDを検出する', async () => {
    const project = fixture()
    await expect(assemblePackage(projectFileJson(project), new Map())).rejects.toThrow('declared assets are missing')
    project.assets = project.assets.filter((asset) => asset.id !== 'back.svg')
    expect(validateBookProject(project).errors).toContainEqual(expect.stringContaining('unregistered asset back.svg'))
    const stored = encodeProject(fixture())
    const restored = decodeProject(stored, { 'front.svg': '<svg/>' })!
    expect(validateBookProject(restored).errors).toContainEqual(expect.stringContaining('unregistered asset back.svg'))
  })

  it('HTMLと静的サイト用データに面定義を残し、再評価したメッシュと子姿勢が一致する', async () => {
    const project = fixture()
    const single = await inlineAssetBodies(project)
    const site = externalizeAssets(project)
    expect(site.files.map((file) => file.path)).toEqual(['front.svg', 'back.svg'])
    expect(site.project.assets.map((asset) => asset.data)).toEqual(['./assets/front.svg', './assets/back.svg'])
    for (const published of [single, site.project]) {
      const html = injectProjectJson('<html><script type="application/json" id="tobidas-project"></script></html>', published)
      expect(html).not.toContain('</script>箱')
      const embedded = JSON.parse(html.match(/id="tobidas-project">([\s\S]*?)<\/script>/)![1])
      expect(embedded.authoringGuide).toBeUndefined()
      expect(embedded.book).toEqual(project.book)
      const input = { open: .5, leftAngle: Math.PI, rightAngle: Math.PI / 2, spreadTime: 0, clock: 2 }
      const expected = evaluateAssemblyScene(project.book, project.book.spreads[0], input)
      const actual = evaluateAssemblyScene(embedded.book, embedded.book.spreads[0], input)
      expect(actual.surfaces.map((part) => [part.surface.positions, part.matrix.elements, part.material])).toEqual(expected.surfaces.map((part) => [part.surface.positions, part.matrix.elements, part.material]))
      expect(actual.visuals.map((part) => part.matrix.elements)).toEqual(expected.visuals.map((part) => part.matrix.elements))
    }
  })
})
