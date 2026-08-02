import { describe, expect, it, vi } from 'vitest'
import { ProjectAutosave } from '../builder/persistence/autosave'
import { decodeProject, encodeProject } from '../builder/persistence/projectCodec'
import { injectProjectJson } from '../builder/io/siteExport'
import { createBookProject } from '../schema/bookDefaults'
import { bookProjectSchema } from '../schema/bookPackage'
import { assemblePackage } from './assemble'
import { assetAccept, assetKindForFile, normalizeAssetPath } from './model'
import { externalizeAssets, projectFileJson } from './serialize'

describe('package ownership boundaries', () => {
  it('v0.1.0のアーチとstrutを現在の自動機構へ正規化する', () => {
    const legacy = createBookProject('legacy') as unknown as Record<string, any>
    const element = {
      ...legacy.book.spreads[0].elements[0],
      id: 'legacy-floating', name: 'legacy', visible: true, opacity: 1,
      type: 'image', asset: '', width: 1, height: 1, billboard: false,
      parent: { type: 'spread' }, baseTransform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      pivot: [0.5, 0.5], layer: 0, motion: [], clock: 'visible-elapsed',
      sourcePreset: 'spine-arch', stow: { mechanism: 'strut', fallDirection: 'auto', stagger: 0 },
    }
    legacy.book.spreads[0].elements = [element]
    const parsed = bookProjectSchema.parse(legacy)
    expect(parsed.book.spreads[0].elements[0].sourcePreset).toBe('bottom-upright')
    expect(parsed.book.spreads[0].elements[0].stow.mechanism).toBe('auto')
  })

  it('round-trips project metadata and asset bodies', async () => {
    const project = createBookProject('package')
    project.assets.push({
      id: 'picture.svg',
      name: 'picture',
      type: 'svg',
      mime: 'image/svg+xml',
      data: '<svg/>',
    })
    const result = await assemblePackage(projectFileJson(project), new Map([
      ['picture.svg', { text: async () => '<svg/>', dataUrl: async () => '' }],
    ]))
    expect(result.project).toEqual(project)
  })

  it('rejects traversal and normalized duplicate asset paths', () => {
    expect(() => normalizeAssetPath('../secret.svg')).toThrow('invalid asset path')
    expect(() => normalizeAssetPath('folder/../secret.svg')).toThrow('invalid asset path')
    expect(normalizeAssetPath('\\folder\\asset.svg')).toBe('folder/asset.svg')
  })

  /**
   * WebP限定なのは公開サンプルの作り方 (scripts/samples) だけで、制作者の作品ではない。
   * 読み込みも書き出しも mime を持ち回るだけなので、ここが受け付ける形式が全部通る。
   */
  it('accepts every image and audio format an author can bring in', () => {
    expect(Object.fromEntries(['svg', 'png', 'webp', 'jpg', 'jpeg', 'mp3', 'ogg', 'wav']
      .map((ext) => [ext, assetKindForFile(`part.${ext}`)]))).toEqual({
      svg: { type: 'svg', mime: 'image/svg+xml' },
      png: { type: 'image', mime: 'image/png' },
      webp: { type: 'image', mime: 'image/webp' },
      jpg: { type: 'image', mime: 'image/jpeg' },
      jpeg: { type: 'image', mime: 'image/jpeg' },
      mp3: { type: 'audio', mime: 'audio/mpeg' },
      ogg: { type: 'audio', mime: 'audio/ogg' },
      wav: { type: 'audio', mime: 'audio/wav' },
    })
    expect(assetKindForFile('PART.PNG')).toEqual({ type: 'image', mime: 'image/png' })
    expect(assetKindForFile('animation.gif')).toBeNull()
    expect(assetKindForFile('notes.txt')).toBeNull()
  })

  /** ピッカーで選べるものは全部入る。選べたのに弾かれるのが無いようにする */
  it('offers exactly the formats it can ingest', () => {
    expect(assetAccept('svg', 'image')).toBe('.svg,.png,.webp,.jpg,.jpeg')
    expect(assetAccept('audio')).toBe('.mp3,.ogg,.wav')
    for (const extension of assetAccept('svg', 'image', 'audio').split(',')) {
      expect(assetKindForFile(`part${extension}`)).not.toBeNull()
    }
  })

  it('carries non-WebP bodies through the site export unchanged', () => {
    const project = createBookProject('formats')
    project.assets.push(
      { id: 'photo.png', name: 'photo', type: 'image', mime: 'image/png', data: 'data:image/png;base64,QUJD' },
      { id: 'scene.jpg', name: 'scene', type: 'image', mime: 'image/jpeg', data: 'data:image/jpeg;base64,REVG' },
      { id: 'draft.svg', name: 'draft', type: 'svg', mime: 'image/svg+xml', data: '<svg/>' },
    )
    const { project: external, files } = externalizeAssets(project)
    expect(external.assets.map((asset) => asset.data))
      .toEqual(['./assets/photo.png', './assets/scene.jpg', './assets/draft.svg'])
    // 実体は元の形式のまま。SVGだけ文字列で、それ以外は data URL の base64 部分
    expect(files.map((file) => [file.path, file.mime, file.bytes])).toEqual([
      ['photo.png', 'image/png', { base64: 'QUJD' }],
      ['scene.jpg', 'image/jpeg', { base64: 'REVG' }],
      ['draft.svg', 'image/svg+xml', { text: '<svg/>' }],
    ])
  })

  it('round-trips the IndexedDB record and drops missing asset bodies', () => {
    const project = createBookProject('persistence')
    project.assets.push({
      id: 'picture.svg',
      name: 'picture',
      type: 'svg',
      mime: 'image/svg+xml',
      data: '<svg/>',
    })
    expect(decodeProject(encodeProject(project))).toEqual(project)
    const record = encodeProject(project)
    delete record.files['picture.svg']
    expect(decodeProject(record)?.assets).toEqual([])
  })

  it('moves asset bodies out of the published book and leaves relative URLs', () => {
    const project = createBookProject('site')
    project.assets.push(
      { id: 'picture.svg', name: 'picture', type: 'svg', mime: 'image/svg+xml', data: '<svg/>' },
      { id: 'かえる 1.webp', name: 'frog', type: 'image', mime: 'image/webp', data: 'data:image/webp;base64,QUJD' },
      { id: 'sound/step.mp3', name: 'step', type: 'audio', mime: 'audio/mpeg', data: 'data:audio/mpeg;base64,REVG' },
    )
    const { project: published, files } = externalizeAssets(project)
    expect(published.assets.map((asset) => asset.data)).toEqual([
      './assets/picture.svg',
      './assets/%E3%81%8B%E3%81%88%E3%82%8B%201.webp',
      './assets/sound/step.mp3',
    ])
    // 実体はどのアセットも欠けずに外へ出て、埋め込みには残らない
    expect(files.map((file) => file.path)).toEqual(project.assets.map((asset) => asset.id))
    expect(files.map((file) => file.bytes)).toEqual([{ text: '<svg/>' }, { base64: 'QUJD' }, { base64: 'REVG' }])
    expect(JSON.stringify(published)).not.toContain('base64,')
    // 元の作品は触らない (書き出しは編集中の状態を壊さない)
    expect(project.assets[0].data).toBe('<svg/>')
  })

  it('escapes script-closing project text in a published site', () => {
    const project = createBookProject('</script><script>alert(1)</script>')
    const html = '<script type="application/json" id="tobidas-project">null</script>'
    const injected = injectProjectJson(html, project)
    expect(injected).not.toContain('</script><script>')
    expect(injected).toContain('\\u003c/script>')
  })

  it('debounces autosave to the last scheduled project', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => {})
    const autosave = new ProjectAutosave(save, 50)
    const first = createBookProject('first')
    const second = createBookProject('second')
    autosave.schedule(first)
    autosave.schedule(second)
    await vi.advanceTimersByTimeAsync(50)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(second)
    vi.useRealTimers()
  })
})

