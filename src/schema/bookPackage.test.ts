import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bookProjectSchema, type BookProjectFile } from './bookPackage'
import { validateBookProject } from './bookValidate'
import type { Spread } from './book'
import type { TimelineProperty, TimelineTrack } from './timeline'
import { compileSpreadStow } from '../runtime/stow/assign'

interface Catalog {
  samples: Array<{ id: string; projectPath: string; thumbnail: string }>
}

const catalog = JSON.parse(readFileSync('projects/catalog.json', 'utf8')) as Catalog
const load = (id: string): BookProjectFile =>
  bookProjectSchema.parse(JSON.parse(readFileSync(`projects/${id}/project.json`, 'utf8')))
const raw = (id: string): unknown => JSON.parse(readFileSync(`projects/${id}/project.json`, 'utf8'))

const tracksOf = (spread: Spread, property: TimelineProperty): TimelineTrack[] =>
  spread.timeline.tracks.filter((track) => track.property === property)
const elementTracks = (spread: Spread, property: TimelineProperty): TimelineTrack[] =>
  tracksOf(spread, property).filter((track) => track.target.type === 'element')
const numbers = (track: TimelineTrack): number[] =>
  track.keys.map((key) => key.value).filter((value): value is number => typeof value === 'number')
const elementOf = (spread: Spread, id: string) => spread.elements.find((element) => element.id === id)

const centeredBackboards = {
  forest_lantern: [['canopy'], ['canopy'], ['ridge'], ['great-tree'], ['canopy']],
  morning_walk: [['skyline'], ['far-row', 'arcade'], ['far-row'], ['mountain', 'school'], ['window']],
  four_seasons: [['window'], ['window'], ['window'], ['window'], ['window']],
} as const

describe('public samples', () => {
  it('catalogs each project under its own folder', () => {
    expect(catalog.samples.length).toBeGreaterThan(0)
    expect(new Set(catalog.samples.map((sample) => sample.id)).size).toBe(catalog.samples.length)
    for (const sample of catalog.samples) {
      expect(sample.projectPath).toBe(`/projects/${sample.id}/`)
      expect(sample.thumbnail.startsWith(`/projects/${sample.id}/assets/`)).toBe(true)
    }
  })

  it.each(catalog.samples)('$id is a valid timeline package', ({ id }) => {
    const project = load(id)
    const validation = validateBookProject(raw(id))
    expect(validation.errors).toEqual([])
    expect(validation.warnings).toEqual([])
    expect(project.book.spreads.every((spread) => spread.timeline.tracks.length > 0)).toBe(true)
    expect(project.book.spreads.every((spread) => spread.sequence.holdSeconds > 0 && spread.sequence.turnSeconds > 0)).toBe(true)
    expect(project.book.spreads.some((spread) => spread.timeline.tracks.some((track) => track.target.type === 'camera'))).toBe(true)
  })

  /** 飛び出す絵本として成立させるため、紙に支えられた部品を主役に保つ */
  it.each(catalog.samples)('$id builds each spread out of paper mechanisms', ({ id }) => {
    const project = load(id)
    for (const spread of project.book.spreads) {
      const roots = spread.elements.filter((element) => element.parent.type !== 'element')
      const compiled = compileSpreadStow(project.book, spread)
      const items = [...compiled.left, ...compiled.right]
      const supported = items.filter((item) => item.mechanism !== 'airborne-route')
      const floating = items.filter((item) => item.mechanism === 'airborne-route'
        && (item.element.type === 'image' || item.element.type === 'text'))
      expect(supported.length).toBeGreaterThanOrEqual(8)
      expect(floating.length).toBeLessThanOrEqual(supported.length / 4)
      expect(compiled.spanning.length).toBeGreaterThan(0)
      expect(roots.some((element) => element.stow.mechanism === 'page-glue')).toBe(true)
      expect(JSON.stringify(spread)).not.toContain('spine-arch')
      expect(JSON.stringify(spread)).not.toContain('"strut"')
    }
  })

  /** 旧アーチ由来の背面板は、右ページローカルの背表紙位置を中心に置く。 */
  it.each(Object.entries(centeredBackboards))('%s centers every rear board on the spine', (id, spreadNames) => {
    const project = load(id)
    expect(project.book.spreads).toHaveLength(spreadNames.length)
    project.book.spreads.forEach((spread, index) => {
      for (const name of spreadNames[index]) {
        const board = elementOf(spread, `${spread.id}-${name}`)
        expect(board?.parent).toEqual({ type: 'right-page' })
        expect(board?.baseTransform.position[0]).toBe(-project.book.format.pageWidth / 2)
      }
    })
  })

  it.each(catalog.samples)('$id stays inside the asset budget', ({ id }) => {
    const project = load(id)
    const bytes = project.assets.reduce((total, asset) => total + (asset.bytes ?? 0), 0)
    expect(bytes).toBeLessThan(12 * 1024 * 1024)
    // 絵は全WebP。音声だけが別形式で、1本ずつ3MBに収まる
    expect(project.assets.every((asset) => asset.type === 'image'
      ? asset.mime === 'image/webp' && asset.id.endsWith('.webp')
      : asset.type === 'audio' && (asset.bytes ?? 0) <= 3 * 1024 * 1024)).toBe(true)
  })

  it('rejects removed font assets and glow effects', () => {
    const withFont = raw('forest_lantern') as { assets: Array<Record<string, unknown>> }
    withFont.assets.push({ id: 'font.woff2', name: 'font', type: 'font', mime: 'font/woff2' })
    expect(bookProjectSchema.safeParse(withFont).success).toBe(false)

    const withGlow = raw('forest_lantern') as {
      book: { spreads: Array<{ elements: Array<Record<string, unknown>> }> }
    }
    const effect = withGlow.book.spreads.flatMap((spread) => spread.elements).find((element) => element.type === 'effect')!
    effect.effect = 'glow'
    expect(bookProjectSchema.safeParse(withGlow).success).toBe(false)
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

  it('requires source preset and common opacity', () => {
    const project = raw('forest_lantern') as {
      book: { spreads: Array<{ elements: Array<Record<string, unknown>> }> }
    }
    delete project.book.spreads[0].elements[0].sourcePreset
    delete project.book.spreads[0].elements[1].opacity
    expect(bookProjectSchema.safeParse(project).success).toBe(false)
  })

  it('rejects backgrounds outside a single page', () => {
    const project = load('forest_lantern')
    const background = project.book.spreads[0].elements.find((element) => element.sourcePreset === 'depth-layer')!
    background.parent = { type: 'spread' }
    expect(validateBookProject(project).errors.some((error) => error.includes('must sit directly under the left or right page'))).toBe(true)
    background.parent = { type: 'right-page' }
    background.baseTransform.position[0] = 20
    expect(validateBookProject(project).errors.some((error) => error.includes('exceeds the page width'))).toBe(true)
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
      .find((element) => element.sourcePreset === 'light-particles')!
    particle.baseTransform.rotation[0] = 20
    expect(validateBookProject(project).errors).toEqual([])
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

  it('forest_lantern raises trees with the spread, drifts a light mote, and lights homes in order', () => {
    const project = load('forest_lantern')

    /**
     * 木は収納機構が二面角で起こす。タイムラインで起こしてはいけない。
     *
     * 見開き時刻は保持区間に入るまで 0 なので、rotation.x のトラックで寝姿勢から
     * 起こすと、開き切ってからあらためて起き上がる二段の動きになる。他の見開きは
     * 開きと同時に立つため、そこだけ鈍く見える。
     */
    const forest = project.book.spreads[0]
    const trees = forest.elements.filter((element) => element.id.includes('-tree-'))
    expect(trees.length).toBeGreaterThanOrEqual(3)
    expect(trees.every((tree) => tree.baseTransform.rotation[0] === 0)).toBe(true)
    const treeIds = new Set(trees.map((tree) => tree.id))
    expect(elementTracks(forest, 'rotation.x')
      .some((track) => track.target.type === 'element' && treeIds.has(track.target.elementId))).toBe(false)

    const river = project.book.spreads[1]
    const mote = elementTracks(river, 'position.x')
      .find((track) => Math.abs(numbers(track).at(-1)! - numbers(track)[0]) > 4)!
    expect(mote).toBeDefined()
    const moteId = mote.target.type === 'element' ? mote.target.elementId : ''
    expect(elementOf(river, moteId)?.motion.some((motion) => motion.type === 'bob')).toBe(true)
    expect(elementTracks(river, 'position.y').some((track) => track.keys.length >= 3)).toBe(true)

    // 横へ走る部品はどれも背表紙を越えない。収納コンパイラは開始位置の符号だけで
    // 帰属面を決めるので、越えさせると左面の部品が右面の上へ出る。めくりの最中は
    // そこに次の見開きが来ているため、次のページを貫通して着地したように見える
    for (const spread of project.book.spreads) {
      for (const track of elementTracks(spread, 'position.x')) {
        const values = numbers(track)
        expect(Math.min(...values) * Math.max(...values)).toBeGreaterThanOrEqual(0)
      }
    }

    const finale = project.book.spreads[4]
    const lit = elementTracks(finale, 'opacity').filter((track) => numbers(track)[0] === 0)
    expect(lit.length).toBeGreaterThanOrEqual(4)
    const litOrder = lit.map((track) => track.keys.at(-1)!.time).sort((a, b) => a - b)
    expect(new Set(litOrder).size).toBe(litOrder.length)
    // 灯った家は暗い家へ同じ位置で重ねてあるので、灯し終えたら下敷きを消す。
    // 不透明な板を2枚重ねたままページを閉じると閉じ際にちらつく
    const holdSeconds = finale.sequence.holdSeconds
    for (const dark of finale.elements.filter((element) => element.id.startsWith('house-dark-'))) {
      const fade = elementTracks(finale, 'opacity')
        .find((track) => track.target.type === 'element' && track.target.elementId === dark.id)
      expect(fade).toBeDefined()
      expect(numbers(fade!).at(-1)).toBe(0)
      // 保持の終わりまでに消え切っていないと、めくりへ最終値が持ち越されない
      expect(fade!.keys.at(-1)!.time).toBeLessThan(holdSeconds)
      const litId = dark.id.replace('house-dark-', 'house-lit-')
      const litTrack = elementTracks(finale, 'opacity')
        .find((track) => track.target.type === 'element' && track.target.elementId === litId)!
      // 消すのは灯り切ったあと。同時に交差させると同じ絵が二重に薄まる
      expect(fade!.keys.at(-1)!.time).toBeGreaterThan(litTrack.keys.at(-1)!.time)
    }
    expect(tracksOf(project.book.spreads[0], 'background')).toHaveLength(1)
    expect(project.book.spreads.every((spread) => tracksOf(spread, 'ambient.intensity').length === 1)).toBe(true)
  })

  it('morning_walk lowers the crossing gate, sends one train across, and climbs the slope', () => {
    const project = load('morning_walk')
    const crossing = project.book.spreads[2]
    const arms = elementTracks(crossing, 'rotation.z')
    expect(arms.length).toBeGreaterThanOrEqual(1)
    expect(numbers(arms[0])[0]).toBeGreaterThan(numbers(arms[0]).at(-1)!)

    const train = elementTracks(crossing, 'position.x')
      .find((track) => Math.abs(numbers(track).at(-1)! - numbers(track)[0]) > 8)!
    expect(train).toBeDefined()
    const passes = numbers(train)
    expect(passes[0]).toBeLessThan(0)
    expect(passes.at(-1)).toBeGreaterThan(0)
    // 一度だけ通る: 往復しない
    expect(passes.every((value, index) => index === 0 || value >= passes[index - 1])).toBe(true)

    const slope = project.book.spreads[3]
    const camera = tracksOf(slope, 'position').find((track) => track.target.type === 'camera')!
    expect(camera.keys).toHaveLength(2)
    const [from, to] = camera.keys.map((key) => key.value as [number, number, number])
    expect(to[2]).toBeLessThan(from[2])

    const dawn = tracksOf(project.book.spreads[0], 'background')[0]
    expect(dawn.keys[0].value).not.toBe(dawn.keys.at(-1)!.value)
    expect(tracksOf(project.book.spreads[0], 'directional.intensity')).toHaveLength(1)
  })

  it('four_seasons holds one season per spread, drops two particle layers outside the glass, and hands the year over season by season', () => {
    const project = load('four_seasons')
    // 窓の外の帯。景色の板 (v=.12) より手前、窓枠のV折り (v=.28) より奥
    const sceneryZ = -2.432
    const creaseZ = -1.408
    const particleId = (track: TimelineTrack): string =>
      track.target.type === 'element' ? track.target.elementId : ''
    const particles = (spread: Spread, property: TimelineProperty): TimelineTrack[] =>
      elementTracks(spread, property).filter((track) =>
        ['particle-far', 'particle-near'].some((id) => particleId(track).endsWith(id)))

    for (const spread of project.book.spreads) {
      // 粒子は横切らず落ちる。二層とも下向き
      const falls = particles(spread, 'position.y')
      expect(falls).toHaveLength(2)
      for (const track of falls) {
        const values = numbers(track)
        // 下向きの区間と、消えているあいだの上への戻しが交互に並ぶ
        const downs = values.slice(1).map((value, index) => value - values[index]).filter((delta) => delta < 0)
        expect(downs.length).toBeGreaterThanOrEqual(1)
        expect(Math.min(...downs)).toBeLessThan(-1)
        expect(Math.max(...values)).toBeLessThan(2.8)

        // 室内へ出てこないこと。奥行きは窓の外の帯に収まる
        const z = elementOf(spread, particleId(track))!.baseTransform.position[2]
        expect(z).toBeGreaterThan(sceneryZ)
        expect(z).toBeLessThan(creaseZ)
      }
      // ななめの流れは付けるが、横切るほどではない
      const drifts = particles(spread, 'position.x').map((track) => numbers(track))
      expect(drifts).toHaveLength(2)
      expect(drifts.every((values) => Math.max(...values) - Math.min(...values) < 3)).toBe(true)
      // 上端で現れ下端で消えるので、窓の外に湧いて窓の外へ消える
      expect(particles(spread, 'opacity').map((track) => numbers(track))
        .every((values) => values[0] === 0 && values.at(-1) === 0)).toBe(true)

      // 保持の終わりより早く畳み切って消す。閉じるあいだ支持片は小口の外へ
      // 迂回するので、残っていると本の外へ部品と影がはみ出す
      const hold = spread.sequence.holdSeconds
      const gone = particles(spread, 'visible')
      expect(gone).toHaveLength(2)
      for (const track of gone) {
        expect(track.keys.at(-1)!.value).toBe(false)
        expect(track.keys.at(-1)!.time).toBeLessThan(hold - 0.2)
        // 消える時刻には既に透明。ここで弾けて見えない
        const fade = particles(spread, 'opacity').find((item) => particleId(item) === particleId(track))!
        expect(fade.keys.at(-1)!.time).toBeLessThanOrEqual(track.keys.at(-1)!.time)
      }
      // 落下・横流れとも、消えるまでに終わっている
      for (const property of ['position.y', 'position.x'] as const) {
        expect(particles(spread, property).every((track) =>
          track.keys.at(-1)!.time <= gone.find((item) => particleId(item) === particleId(track))!.keys.at(-1)!.time))
          .toBe(true)
      }
    }

    const seasonOrder = ['spring', 'summer', 'autumn', 'winter']
    project.book.spreads.slice(0, 4).forEach((spread, index) => {
      // 見開き1〜4は一枚につき一季節。途中で絵が入れ替わらない
      expect(elementTracks(spread, 'asset')).toHaveLength(0)

      // 景色は左右の面でパノラマの半分ずつ。両面に同じ絵を置かない
      const views = ['view-l', 'view-r'].map((suffix) =>
        spread.elements.find((element) => element.id.endsWith(suffix))!)
      expect(views.map((element) => element.type === 'image' && element.asset))
        .toEqual([`view-${seasonOrder[index]}-l.webp`, `view-${seasonOrder[index]}-r.webp`])

      // 粒子も同じ季節のものだけが落ちる
      const petals = ['particle-far', 'particle-near'].map((suffix) =>
        spread.elements.find((element) => element.id.endsWith(suffix))!)
      expect(new Set(petals.map((element) => element.type === 'image' && element.asset)).size).toBe(1)

      // 光も季節のあいだ動かない。動くのは明るさだけ
      for (const property of ['background', 'directional.color'] as const) {
        const track = tracksOf(spread, property)
        expect(track).toHaveLength(1)
        expect(new Set(track[0].keys.map((key) => key.value)).size).toBe(1)
      }

      // 落ちる回数が違う (窓ぎわは二度、奥は一度)
      expect(new Set(particles(spread, 'position.y').map((track) => track.keys.length)).size).toBe(2)
    })

    const finale = project.book.spreads[4]
    // 見開き5だけが四季を順に渡す。左右2面 × 4季節の層
    const layers = elementTracks(finale, 'opacity')
      .filter((track) => particleId(track).includes('layer-'))
    expect(layers).toHaveLength(8)
    // どの層も一度は不透明に出る
    expect(layers.every((track) => Math.max(...numbers(track)) === 1)).toBe(true)
    // 古い季節は次が立ち上がる区間で0まで落ちる。薄いまま残すと窓の外が
    // 多重露光になって、どの季節も読めない濁りになる
    const endsOf = (order: number): number[] => layers
      .filter((track) => particleId(track).endsWith(`-${order}`))
      .map((track) => numbers(track).at(-1)!)
    expect(endsOf(1)).toEqual([0, 0])
    expect(endsOf(2)).toEqual([0, 0])
    expect(endsOf(3)).toEqual([0, 0])
    // 残るのは最後の季節だけ
    expect(endsOf(4)).toEqual([1, 1])

    // 景色が半分入れ替わる時刻。立ち上がる3層の、立ち上がり区間の中央
    const seasonSwaps = [...new Set(layers
      .filter((track) => particleId(track).includes('layer-left-') && numbers(track)[0] === 0)
      .map((track) => (track.keys[1].time + track.keys[2].time) / 2))].sort((a, b) => a - b)
    expect(seasonSwaps).toHaveLength(3)

    // 粒子も景色と同じ順に四季を巡り、差し替えは景色の変わり目と同時刻
    const seasonal = particles(finale, 'asset')
    expect(seasonal).toHaveLength(2)
    for (const track of seasonal) {
      expect(new Set(track.keys.map((key) => key.value)).size).toBe(4)
      expect(track.keys.every((key) => key.ease === 'hold')).toBe(true)
      expect(track.keys.slice(1).map((key) => key.time)).toEqual(seasonSwaps)

      // 差し替えの瞬間は必ず不透明度0の谷の中。見えたまま絵が変わると弾ける
      const fade = particles(finale, 'opacity').find((item) => particleId(item) === particleId(track))!
      for (const key of track.keys.slice(1)) {
        const before = [...fade.keys].reverse().find((item) => item.time <= key.time)!
        const after = fade.keys.find((item) => item.time >= key.time)!
        expect(before.value).toBe(0)
        expect(after.value).toBe(0)
      }
    }
    // 粒子の四季は景色の四季と同じ順 (花びら→若葉→紅葉→雪)
    const viewOrder = ['spring', 'summer', 'autumn', 'winter']
    const petalOrder = ['petal', 'leaf', 'maple', 'snow']
    expect(seasonal.every((track) => track.keys.every((key, index) =>
      String(key.value).includes(petalOrder[index])))).toBe(true)
    expect(finale.elements.filter((element) => element.id.includes('layer-left-'))
      .every((element, index) => element.type === 'image' && element.asset.includes(viewOrder[index]))).toBe(true)
  })

  /**
   * 季節を運ばない部屋の道具は、5つの見開きで同じ場所に居続ける。
   *
   * カーテンや鉢が見開きごとに面や位置を移ると、部屋そのものが毎回組み替わり、
   * 移ろったのが季節なのか部屋なのかが読めなくなる。動かないものが動かない
   * ままだから、窓の外だけが変わったと分かる。
   */
  it('four_seasons keeps the season-less room props in one place all year', () => {
    const project = load('four_seasons')
    const fixed = ['curtain-left', 'curtain-right', 'plant']
    const placed = fixed.map((suffix) => project.book.spreads.map((spread) => {
      const element = spread.elements.find((item) => item.id.endsWith(`-${suffix}`))
      expect(element, `${spread.id} に ${suffix} がありません`).toBeDefined()
      return { parent: element!.parent.type, position: element!.baseTransform.position.join() }
    }))
    for (const [index, spreads] of placed.entries()) {
      expect(new Set(spreads.map((item) => `${item.parent} ${item.position}`)).size,
        `${fixed[index]} が見開きごとに動いています`).toBe(1)
    }
    // 左右のカーテンは対。同じ面へ寄せない
    expect(placed[0][0].parent).toBe('left-page')
    expect(placed[1][0].parent).toBe('right-page')
  })

})
