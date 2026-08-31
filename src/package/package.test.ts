import { describe, expect, it, vi } from 'vitest'
import { ProjectAutosave } from '../builder/persistence/autosave'
import { decodeProject, encodeProject } from '../builder/persistence/projectCodec'
import { injectProjectJson } from '../builder/io/siteExport'
import { createBookProject } from '../schema/bookDefaults'
import { bookProjectSchema } from '../schema/bookPackage'
import { assemblePackage } from './assemble'
import { assetAccept, assetKindForFile, normalizeAssetPath } from './model'
import { externalizeAssets, projectFileJson } from './serialize'
import { VIDEO_BYTE_LIMIT } from '../schema/assets'

describe('package ownership boundaries', () => {
  it('v0.1.0のアーチとstrutを単一ビジュアルへ正規化する', () => {
    const legacy = createBookProject('legacy') as unknown as Record<string, any>
    const element = {
      ...legacy.book.spreads[0].elements[0],
      id: 'legacy-floating', name: 'legacy', visible: true, opacity: 1,
      type: 'image', asset: '', width: 1, height: 1, billboard: false,
      parent: { type: 'right-page' }, baseTransform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      pivot: [0.5, 0.5], layer: 0, motion: [], clock: 'visible-elapsed',
      sourcePreset: 'spine-arch', stow: { mechanism: 'strut', fallDirection: 'auto', stagger: 0 },
    }
    legacy.book.spreads[0].elements = [element]
    const parsed = bookProjectSchema.parse(legacy)
    expect(parsed.book.spreads[0].elements[0].type).toBe('visual')
    expect(parsed.book.spreads[0].elements[0].parent).toEqual({ type: 'right-page' })
    expect(parsed.book.spreads[0].elements[0].stow).toEqual({ fallDirection: 'auto', stagger: 0 })
  })

  it('fills the default authoring guide when opening an older project', () => {
    const legacy = createBookProject('without guide') as unknown as Record<string, any>
    delete legacy.authoringGuide
    const parsed = bookProjectSchema.parse(legacy)
    expect(parsed.authoringGuide.en.storyStructure).toContain('five story spreads')
    expect(parsed.authoringGuide.ja.storyStructure).toContain('見開き')
    expect(parsed.authoringGuide.en.additionalInstructions).toBe('')
  })

  it('localizes the previous single-language default during migration', () => {
    const legacy = createBookProject('legacy guide') as unknown as Record<string, any>
    legacy.authoringGuide = {
      ...legacy.authoringGuide.en,
      creativeIntent: 'Define the intended reader, emotional arc, and the one experience each spread should support.',
    }
    const parsed = bookProjectSchema.parse(legacy)
    expect(parsed.authoringGuide.ja.creativeIntent).toBe('子どもから大人まで楽しめる、優しい表現。')
    expect(parsed.authoringGuide.en.creativeIntent).toContain('gentle')
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
      ['picture.svg', {
        text: async () => '<svg/>',
        dataUrl: async () => '',
        blob: async () => new Blob(),
      }],
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
  it('accepts every image, video and audio format an author can bring in', () => {
    expect(Object.fromEntries(['svg', 'png', 'webp', 'jpg', 'jpeg', 'mp3', 'ogg', 'wav', 'mp4', 'webm']
      .map((ext) => [ext, assetKindForFile(`part.${ext}`)]))).toEqual({
      svg: { type: 'svg', mime: 'image/svg+xml' },
      png: { type: 'image', mime: 'image/png' },
      webp: { type: 'image', mime: 'image/webp' },
      jpg: { type: 'image', mime: 'image/jpeg' },
      jpeg: { type: 'image', mime: 'image/jpeg' },
      mp3: { type: 'audio', mime: 'audio/mpeg' },
      ogg: { type: 'audio', mime: 'audio/ogg' },
      wav: { type: 'audio', mime: 'audio/wav' },
      mp4: { type: 'video', mime: 'video/mp4' },
      webm: { type: 'video', mime: 'video/webm' },
    })
    expect(assetKindForFile('PART.PNG')).toEqual({ type: 'image', mime: 'image/png' })
    expect(assetKindForFile('animation.gif')).toBeNull()
    expect(assetKindForFile('notes.txt')).toBeNull()
  })

  /** ピッカーで選べるものは全部入る。選べたのに弾かれるのが無いようにする */
  it('offers exactly the formats it can ingest', () => {
    expect(assetAccept('svg', 'image')).toBe('.svg,.png,.webp,.jpg,.jpeg')
    expect(assetAccept('audio')).toBe('.mp3,.ogg,.wav')
    expect(assetAccept('video')).toBe('.mp4,.webm')
    for (const extension of assetAccept('svg', 'image', 'audio', 'video').split(',')) {
      expect(assetKindForFile(`part${extension}`)).not.toBeNull()
    }
  })

  it('keeps video bodies as Blob through package assembly, persistence and static export', async () => {
    const body = new Blob(['movie'], { type: 'video/mp4' })
    const project = createBookProject('video-package')
    project.assets.push({
      id: 'movie.mp4', name: 'movie', type: 'video', mime: 'video/mp4',
      bytes: body.size, width: 16, height: 9, duration: 1, data: body,
    })
    const assembled = await assemblePackage(projectFileJson(project), new Map([[
      'movie.mp4',
      {
        size: body.size,
        text: async () => '',
        dataUrl: async () => '',
        blob: async () => body,
      },
    ]]))
    expect(assembled.project.assets[0].data).toBe(body)

    const restored = decodeProject(encodeProject(assembled.project))
    expect(restored?.assets[0].data).toBe(body)

    const published = externalizeAssets(assembled.project)
    expect(published.project.assets[0].data).toBe('./assets/movie.mp4')
    expect(published.files[0].bytes).toEqual({ blob: body })
  })

  it('rejects a video one byte over the 100 MiB limit without decoding its body', async () => {
    const project = createBookProject('oversized-video')
    project.assets.push({
      id: 'movie.mp4', name: 'movie', type: 'video', mime: 'video/mp4',
      bytes: VIDEO_BYTE_LIMIT + 1, width: 16, height: 9, duration: 1, data: new Blob(),
    })
    await expect(assemblePackage(projectFileJson(project), new Map([[
      'movie.mp4',
      {
        size: VIDEO_BYTE_LIMIT + 1,
        mime: 'video/mp4',
        text: async () => '',
        dataUrl: async () => '',
        blob: async () => new Blob(['small'], { type: 'video/mp4' }),
      },
    ]]))).rejects.toThrow('video asset exceeds 100 MiB')
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
    delete record.files!['picture.svg']
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
    expect('authoringGuide' in published).toBe(false)
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

