import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bookProjectSchema, type BookProjectFile } from './bookPackage'
import { validateBookProject } from './bookValidate'
import type { Spread } from './book'
import { measureTextBox } from '../runtime/textStyle'

interface Catalog {
  samples: Array<{ id: string; projectPath: string; thumbnail: string }>
}

const catalog = JSON.parse(readFileSync('projects/catalog.json', 'utf8')) as Catalog
const trackedSamples = catalog.samples
const load = (id: string): BookProjectFile =>
  bookProjectSchema.parse(JSON.parse(readFileSync(`projects/${id}/project.json`, 'utf8')))
const raw = (id: string): unknown => JSON.parse(readFileSync(`projects/${id}/project.json`, 'utf8'))

const elementOf = (spread: Spread, id: string) => spread.elements.find((element) => element.id === id)

describe('public samples', () => {
  it('catalogs each project under its own folder', () => {
    expect(trackedSamples.length).toBeGreaterThan(0)
    expect(new Set(trackedSamples.map((sample) => sample.id)).size).toBe(trackedSamples.length)
    for (const sample of trackedSamples) {
      expect(sample.projectPath).toBe(`/projects/${sample.id}/`)
      expect(sample.thumbnail.startsWith(`/projects/${sample.id}/assets/`)).toBe(true)
    }
  })

  it.each(trackedSamples)('$id is a valid timeline package', ({ id }) => {
    const project = load(id)
    const validation = validateBookProject(raw(id))
    expect(validation.errors).toEqual([])
    expect(validation.warnings).toEqual([])
    expect(project.book.spreads.every((spread) => spread.timeline.tracks.length > 0)).toBe(true)
    expect(project.book.spreads.every((spread) => spread.sequence.holdSeconds > 0 && spread.sequence.turnSeconds > 0)).toBe(true)
    expect(project.book.spreads.some((spread) => spread.timeline.tracks.some((track) => track.target.type === 'camera'))).toBe(true)
  })

  /** 公開サンプルは、実際の紙面と折り線に接続した部品と、紙の面に取り付けた演出だけで組む */
  it.each(trackedSamples)('$id builds every element from connected paper parts and attached content', ({ id }) => {
    const project = load(id)
    for (const spread of project.book.spreads) {
      const parts = new Set(spread.elements.filter((element) => element.type === 'part').map((element) => element.id))
      for (const element of spread.elements) {
        if (element.type === 'part') {
          if ('custom' in element.part.definition) expect(project.partDefinitions?.[element.part.definition.custom], `${spread.id}/${element.id}`).toBeDefined()
          if ('builtin' in element.part.definition && element.part.definition.builtin === 'upright') expect(element.part.supportDesign, `${spread.id}/${element.id}`).toBe('automatic')
          continue
        }
        expect(element.presentation, `${spread.id}/${element.id}`).toBeDefined()
        expect(element.attachment, `${spread.id}/${element.id}`).toBeDefined()
        if (element.attachment?.type === 'surface') {
          const host = element.attachment.surface.nodeId
          expect(host === '$book' || parts.has(host), `${spread.id}/${element.id} host`).toBe(true)
        }
      }
    }
  })

  it.each(trackedSamples)('$id attaches every particle to a paper face as moving content', ({ id }) => {
    for (const spread of load(id).book.spreads) {
      for (const element of spread.elements.filter((item) => item.type === 'particle')) {
        expect(element.presentation?.kind, `${spread.id}/${element.id}`).toBe('fiction')
        expect(element.attachment?.type, `${spread.id}/${element.id}`).toBe('surface')
      }
    }
  })

  it.each(trackedSamples.filter((sample) => sample.id !== 'crooked_castle'))('$id prints each page caption on a book page', ({ id }) => {
    for (const spread of load(id).book.spreads) {
      const caption = elementOf(spread, `${spread.id}-text`)
      expect(caption, `${spread.id} caption`).toBeDefined()
      expect(caption?.presentation?.kind, `${spread.id} caption`).toBe('decal')
      expect(caption?.attachment?.type === 'surface' && caption.attachment.surface.nodeId, `${spread.id} caption`).toBe('$book')
    }
  })

  it.each(trackedSamples)('$id gives every text visual enough room for all glyphs and lines', ({ id }) => {
    const project = load(id)
    for (const spread of project.book.spreads) {
      for (const element of spread.elements) {
        if (element.type !== 'visual' || !element.text) continue
        const required = measureTextBox(element, element.fontSize)
        expect(element.width, `${spread.id}/${element.id} width`).toBeGreaterThanOrEqual(required.width - 1e-6)
        expect(element.height, `${spread.id}/${element.id} height`).toBeGreaterThanOrEqual(required.height - 1e-6)
      }
    }
  })

  it('keeps forest captions at the pre-visual-integration footprint', () => {
    const project = load('forest_lantern')
    const caption = project.book.spreads[1].elements.find((element) => element.id === 'spread-2-text')
    expect(caption?.type === 'visual' && caption.width).toBeCloseTo(5.168)
    expect(caption?.type === 'visual' && caption.height).toBeCloseTo(0.8)
    expect(caption?.type === 'visual' && caption.fontSize).toBeCloseTo(0.32)
  })

  it.each(trackedSamples)('$id stays inside the asset budget', ({ id }) => {
    const project = load(id)
    const bytes = project.assets.reduce((total, asset) => total + (asset.bytes ?? 0), 0)
    expect(bytes).toBeLessThan(12 * 1024 * 1024)
    // 絵は全WebP。音声だけが別形式で、1本ずつ3MBに収まる
    expect(project.assets.every((asset) => asset.type === 'image' || asset.type === 'svg'
      ? asset.mime === 'image/webp' && asset.id.endsWith('.webp')
      : asset.type === 'audio' && (asset.bytes ?? 0) <= 3 * 1024 * 1024)).toBe(true)
  })

  it('rejects removed font assets', () => {
    const withFont = raw('forest_lantern') as { assets: Array<Record<string, unknown>> }
    withFont.assets.push({ id: 'font.woff2', name: 'font', type: 'font', mime: 'font/woff2' })
    expect(bookProjectSchema.safeParse(withFont).success).toBe(false)

  })

  it('keeps the BGM and spread cue contracts', () => {
    const project = raw('forest_lantern') as {
      audio?: { bgmAsset: string; volume: number; loop: boolean }
      assets: Array<Record<string, unknown>>
      book: { spreads: Array<{ enterSound?: string }> }
    }
    project.assets.push({ id: 'cue.mp3', name: 'cue', type: 'audio', mime: 'audio/mpeg' })
    project.audio = { bgmAsset: 'cue.mp3', volume: .8, loop: true }
    project.book.spreads[0].enterSound = 'cue.mp3'
    expect(bookProjectSchema.safeParse(project).success).toBe(true)
  })

  /** 効果音は音声トラックの点。値は場所取りなので true で固定する */
  it('accepts sound cue tracks and rejects cues outside a sound track', () => {
    const project = raw('forest_lantern') as {
      assets: Array<Record<string, unknown>>
      book: { spreads: Array<{ timeline: { tracks: Array<Record<string, unknown>> } }> }
    }
    project.assets.push({ id: 'step.wav', name: 'step', type: 'audio', mime: 'audio/wav', bytes: 1024 })
    project.book.spreads[0].timeline.tracks.push({
      id: 'cue-track',
      target: { type: 'sound', assetId: 'step.wav' },
      property: 'cue',
      keys: [{ id: 'cue-key', time: 1, value: true, ease: 'hold' }],
    })
    expect(validateBookProject(project).errors).toEqual([])

    project.book.spreads[0].timeline.tracks.at(-1)!.target = { type: 'camera' }
    expect(validateBookProject(project).errors).toContain('camera:cue: property not available on the camera')
  })

  /** 音声は data URL のまま単一HTMLへ入る。大きすぎるものは書き出しを太らせる */
  it('warns about audio over 3MB without rejecting it', () => {
    const project = raw('forest_lantern') as { assets: Array<Record<string, unknown>> }
    project.assets.push({
      id: 'long.mp3', name: 'long', type: 'audio', mime: 'audio/mpeg', bytes: 4 * 1024 * 1024,
    })
    const result = validateBookProject(project)
    expect(result.errors).toEqual([])
    expect(result.warnings).toContain('long: audio exceeds 3MB (4.0MB)')
  })

  /** 効果音はタイムラインの点だけで表し、紙面を押して鳴らす部品は受け付けない */
  it('does not accept a sound trigger element', () => {
    const project = raw('forest_lantern') as {
      book: { spreads: Array<{ elements: Array<Record<string, unknown>> }> }
    }
    project.book.spreads[0].elements.push({
      ...project.book.spreads[0].elements[0],
      id: 'sound-trigger',
      name: '効果音',
      type: 'sound-trigger',
      asset: 'cue.mp3',
      width: 1,
      height: 1,
      volume: 1,
      loop: false,
    })
    expect(bookProjectSchema.safeParse(project).success).toBe(false)
  })

  it('does not accept the removed camera views contract', () => {
    const project = raw('forest_lantern') as { book: { camera: Record<string, unknown> } }
    project.book.camera.views = []
    expect('views' in bookProjectSchema.parse(project).book.camera).toBe(false)
  })

  it('requires common opacity', () => {
    const project = raw('forest_lantern') as {
      book: { spreads: Array<{ elements: Array<Record<string, unknown>> }> }
    }
    delete project.book.spreads[0].elements[1].opacity
    expect(bookProjectSchema.safeParse(project).success).toBe(false)
  })

  it('all root visuals belong to a page even when they cross the spine', () => {
    const project = load('forest_lantern')
    expect(project.book.spreads.flatMap((spread) => spread.elements)
      .filter((element) => element.parent.type !== 'element')
      .every((element) => element.parent.type === 'left-page' || element.parent.type === 'right-page')).toBe(true)
  })

  it('accepts a stage background image and validates its asset reference', () => {
    const project = load('forest_lantern')
    project.book.appearance.backgroundAsset = 'page-1-left.webp'
    expect(validateBookProject(project)).toEqual({ ok: true, errors: [], warnings: [] })

    project.book.appearance.backgroundAsset = 'missing.webp'
    expect(validateBookProject(project).errors).toContain('stage background: unregistered asset missing.webp')
  })

  it('allows a particle plane to rotate like other planar parts', () => {
    const project = load('forest_lantern')
    const particle = project.book.spreads.flatMap((spread) => spread.elements)
      .find((element) => element.type === 'particle')!
    particle.baseTransform.rotation[0] = 20
    expect(bookProjectSchema.safeParse(project).success).toBe(true)
    // 傾けた面が紙と交差すれば接続の検査が知らせる。回転そのものを理由に拒否しない
    expect(validateBookProject(project).errors.filter((error) => !error.startsWith('Content crosses paper'))).toEqual([])
  })

  it('accepts project-specific cover and spine colors', () => {
    const project = load('forest_lantern')
    project.book.appearance.coverColor = '#17633c'
    project.book.appearance.coverEdgeColor = '#0b3d25'
    const parsed = bookProjectSchema.parse(project)
    expect(parsed.book.appearance.coverColor).toBe('#17633c')
    expect(parsed.book.appearance.coverEdgeColor).toBe('#0b3d25')
  })

  // --- 公開サンプル3作品の実装要件 ------------------------------------------

  /**
   * 季節を運ばない部屋の道具は、5つの見開きで同じ場所に居続ける。
   *
   * カーテンや鉢が見開きごとに面や位置を移ると、部屋そのものが毎回組み替わり、
   * 移ろったのが季節なのか部屋なのかが読めなくなる。動かないものが動かない
   * ままだから、窓の外だけが変わったと分かる。
   */
})
