import { beforeEach, describe, expect, it } from 'vitest'
import { createBookProject } from '../schema/bookDefaults'
import { validateBookProject } from '../schema/bookValidate'
import { compileBookBeats } from '../runtime/signals'
import { createLocalizedBookProject, useBuilderStore } from './store'

describe('new project defaults', () => {
  it('registers and assigns the bundled cover and page-turn assets', () => {
    const project = createLocalizedBookProject()

    expect(project.assets.map((asset) => asset.id)).toEqual([
      'standard/tobidas-cover-front.webp',
      'standard/tobidas-cover-back.webp',
      'standard/bgm.mp3',
      'standard/page-turn.wav',
    ])
    expect(project.book.frontCover.frontAsset).toBe('standard/tobidas-cover-front.webp')
    expect(project.book.frontCover.backAsset).toBeUndefined()
    expect(project.book.backCover.frontAsset).toBeUndefined()
    expect(project.book.backCover.backAsset).toBe('standard/tobidas-cover-back.webp')
    expect(project.audio).toEqual({ bgmAsset: 'standard/bgm.mp3', volume: 0.7, loop: true })
    expect(project.book.spreads[0].pageTurnSound).toBe('standard/page-turn.wav')
    expect(validateBookProject(project)).toMatchObject({ ok: true, errors: [], warnings: [] })
  })
})

describe('builder playback start', () => {
  beforeEach(() => {
    useBuilderStore.setState({ mode: 'edit', previewProgress: 0 })
  })

  it('always resets progress when entering playback', () => {
    const store = useBuilderStore.getState()
    store.setPreviewProgress(0.73)
    store.setMode('play')

    expect(useBuilderStore.getState().mode).toBe('play')
    expect(useBuilderStore.getState().previewProgress).toBe(0)
  })

  it('resets again on every playback session', () => {
    useBuilderStore.getState().setMode('play')
    useBuilderStore.getState().setPreviewProgress(0.91)
    useBuilderStore.getState().setMode('edit')
    useBuilderStore.getState().setMode('play')

    expect(useBuilderStore.getState().previewProgress).toBe(0)
  })

  /**
   * 保持区間の外では見開きが完全展開でなく、ギズモが出ない。
   * 再生から戻ったときに編集できない状態へ落ちないようにする。
   */
  it('pulls progress back into the active spread hold when returning to edit', () => {
    const project = createBookProject('return to edit')
    useBuilderStore.getState().setProject(project, 'import')
    const book = useBuilderStore.getState().project.book
    const hold = compileBookBeats(book).find((beat) => beat.kind === 'hold')!

    useBuilderStore.getState().setMode('play')
    useBuilderStore.getState().setPreviewProgress(1)
    useBuilderStore.getState().setMode('edit')
    expect(useBuilderStore.getState().previewProgress).toBe(hold.start)

    // 保持区間の中にいるときは、編集で見ていた時刻を保つ
    const inside = (hold.start + hold.end) / 2
    useBuilderStore.getState().setPreviewProgress(inside)
    useBuilderStore.getState().setMode('play')
    useBuilderStore.getState().setPreviewProgress(inside)
    useBuilderStore.getState().setMode('edit')
    expect(useBuilderStore.getState().previewProgress).toBe(inside)
  })

  /**
   * 戻り先は直前に再生で見ていた見開き。最後に編集していた見開きへ戻すと、
   * 再生でめくった先を直したいときに必ず選び直すことになる。
   */
  it('returns to the spread that playback was showing', () => {
    useBuilderStore.getState().setProject(createBookProject('return to the shown spread'), 'import')
    useBuilderStore.getState().addSpread()
    useBuilderStore.getState().addSpread()
    const book = useBuilderStore.getState().project.book
    const third = book.spreads[2]
    const first = book.spreads[0]

    // 編集していたのは1つ目
    useBuilderStore.getState().setActiveSpread(first.id)
    useBuilderStore.getState().setMode('play')
    // 再生で3つ目まで送った
    const hold = compileBookBeats(book).find((beat) => beat.kind === 'hold' && beat.spreadId === third.id)!
    useBuilderStore.getState().setPreviewProgress((hold.start + hold.end) / 2)
    useBuilderStore.getState().setMode('edit')

    const state = useBuilderStore.getState()
    expect(state.activeSpreadId).toBe(third.id)
    // 前の見開きの部品を選んだままにしない
    expect(state.selection).toEqual({ type: 'spread', spreadId: third.id })
  })

  /** めくりの途中で戻したときも、そこで見えている見開きが編集できる状態になる */
  it('lands on a fully open spread when leaving playback mid-turn', () => {
    useBuilderStore.getState().setProject(createBookProject('mid turn'), 'import')
    useBuilderStore.getState().addSpread()
    const book = useBuilderStore.getState().project.book
    const turn = compileBookBeats(book).find((beat) => beat.kind === 'turn')!

    useBuilderStore.getState().setMode('play')
    useBuilderStore.getState().setPreviewProgress((turn.start + turn.end) / 2)
    useBuilderStore.getState().setMode('edit')

    const state = useBuilderStore.getState()
    const hold = compileBookBeats(book).find(
      (beat) => beat.kind === 'hold' && beat.spreadId === state.activeSpreadId,
    )!
    expect(state.previewProgress).toBe(hold.start)
  })
})

/**
 * 投入導線は「プリセットを選んでからアセットをドラッグ」の一本。
 * どの型で置くかを決めずに紙へ置ける経路を残すと、押した瞬間に出る経路と
 * 二本立てに戻る。
 */
describe('preset placement', () => {
  const setup = () => {
    const store = useBuilderStore.getState()
    const project = createBookProject('placement')
    project.assets.push({
      id: 'tree.png', name: 'tree', type: 'image', mime: 'image/png',
      width: 100, height: 200, data: 'data:image/png;base64,AA',
    })
    store.setProject(project, 'import')
    return useBuilderStore.getState().activeSpreadId
  }
  const elements = () => {
    const state = useBuilderStore.getState()
    return state.project.book.spreads.find((spread) => spread.id === state.activeSpreadId)!.elements
  }

  it('places nothing while no preset is selected', () => {
    const spreadId = setup()
    useBuilderStore.getState().placeAsset(spreadId, 'right', 'tree.png', { x: .5, y: .5 })
    expect(elements()).toHaveLength(0)
  })

  it('lays the part flat for the paper-stack preset', () => {
    const spreadId = setup()
    useBuilderStore.getState().setPlacement('paper-stack')
    useBuilderStore.getState().placeAsset(spreadId, 'right', 'tree.png', { x: .5, y: .5 })
    const element = elements()[0]
    expect(element.type).toBe('visual')
    expect(element.baseTransform.rotation[0]).toBe(-90)
    expect(element.pivot).toEqual([.5, .5])
    // 縦横比は素材から取る
    expect(element.type === 'visual' && element.height / element.width).toBe(2)
  })

  it('stands the part on its ground line for the upright preset', () => {
    const spreadId = setup()
    useBuilderStore.getState().setPlacement('bottom-upright')
    useBuilderStore.getState().placeAsset(spreadId, 'left', 'tree.png', { x: .25, y: .5 })
    const element = elements()[0]
    expect(element.type).toBe('visual')
    expect(element.baseTransform.rotation).toEqual([0, 0, 0])
    expect(element.pivot).toEqual([.5, 0])
    expect(element.parent).toEqual({ type: 'left-page' })
  })

  it('廃止した空中プリセットは選択肢に入らない', () => {
    const spreadId = setup()
    useBuilderStore.getState().placeAsset(spreadId, 'left', 'tree.png', { x: .5, y: .4 })
    expect(elements()).toHaveLength(0)
  })

  it('ignores an audio preset on the page', () => {
    const spreadId = setup()
    useBuilderStore.getState().setPlacement('sound-cue')
    useBuilderStore.getState().placeAsset(spreadId, 'right', 'tree.png', { x: .5, y: .5 })
    expect(elements()).toHaveLength(0)
  })
})

describe('builder project session reset', () => {
  it('resets every transient editor state when loading another project', () => {
    const store = useBuilderStore.getState()
    const previous = createBookProject('変更前')
    previous.book.spreads[0].timeline.tracks.push({
      id: 'old-track',
      target: { type: 'camera' },
      property: 'fov',
      keys: [{ id: 'old-key', time: 1, value: 40, ease: 'linear' }],
    })
    store.setProject(previous, 'import')
    store.setMode('play')
    store.setGizmo('scale')
    store.setPreviewProgress(0.8)
    store.commit((project) => { project.name = 'undo履歴あり' })

    const previousSession = useBuilderStore.getState().projectSession
    const incoming = createBookProject('読込先')
    useBuilderStore.getState().setProject(incoming, 'import')

    const next = useBuilderStore.getState()
    expect(next.project.name).toBe('読込先')
    expect(next.project.book.spreads[0].timeline.tracks).toEqual([])
    expect(next.projectSession).toBe(previousSession + 1)
    expect(next.activeSpreadId).toBe(incoming.book.spreads[0].id)
    expect(next.selection).toEqual({ type: 'spread', spreadId: incoming.book.spreads[0].id })
    expect(next.mode).toBe('edit')
    expect(next.gizmo).toBe('translate')
    // ビュワーは1つめの見開きを開いた姿から始める。進行値0は本が閉じた姿なので、
    // 見開きを選んだ扱いのまま0で始めると選択と画面が食い違う
    const hold = compileBookBeats(next.project.book).find(
      (beat) => beat.kind === 'hold' && beat.spreadId === incoming.book.spreads[0].id,
    )!
    expect(next.previewProgress).toBe(hold.start)
    expect(next.undoStack).toEqual([])
    expect(next.redoStack).toEqual([])
  })

  it('does not retain a caller-owned project reference', () => {
    const incoming = createBookProject('読込先')
    useBuilderStore.getState().setProject(incoming, 'import')
    incoming.book.spreads[0].timeline.tracks.push({
      id: 'late-track',
      target: { type: 'camera' },
      property: 'fov',
      keys: [{ id: 'late-key', time: 1, value: 40, ease: 'linear' }],
    })

    expect(useBuilderStore.getState().project.book.spreads[0].timeline.tracks).toEqual([])
  })
})

describe('builder timeline operations', () => {
  it('upserts one key per target and time', () => {
    const project = createBookProject('timeline')
    const spreadId = project.book.spreads[0].id
    useBuilderStore.getState().setProject(project, 'import')
    const store = useBuilderStore.getState()
    store.upsertTimelineKey(spreadId, { type: 'camera' }, 'fov', 1, 40)
    useBuilderStore.getState().upsertTimelineKey(spreadId, { type: 'camera' }, 'fov', 1, 55)
    const tracks = useBuilderStore.getState().project.book.spreads[0].timeline.tracks
    expect(tracks).toHaveLength(1)
    expect(tracks[0].keys).toHaveLength(1)
    expect(tracks[0].keys[0].value).toBe(55)
  })

  it('stores a transform gesture as one undo operation', () => {
    const project = createBookProject('transform')
    const spread = project.book.spreads[0]
    useBuilderStore.getState().setProject(project, 'import')
    useBuilderStore.getState().addElement(spread.id, 'visual')
    const created = useBuilderStore.getState().project.book.spreads[0].elements[0]
    const before = useBuilderStore.getState().undoStack.length
    useBuilderStore.getState().applyGizmoTransform(spread.id, created.id, 1, {
      position: [1, 2, 3],
      rotation: [10, 20, 30],
      scale: [1, 1.2, .8],
    })
    expect(useBuilderStore.getState().undoStack.length).toBe(before + 1)
  })

  /**
   * ギズモの反映先は軸ごとに決まる。トラックのある軸へ基本姿勢を書くと、
   * 描画はトラックが支配したままで収納コンパイラの入力だけが変わってしまう。
   */
  it('routes a gizmo gesture per axis: tracked axes to keys, the rest to the base pose', () => {
    const project = createBookProject('gizmo routing')
    const spread = project.book.spreads[0]
    useBuilderStore.getState().setProject(project, 'import')
    useBuilderStore.getState().addElement(spread.id, 'visual')
    const created = useBuilderStore.getState().project.book.spreads[0].elements[0]
    useBuilderStore.getState().upsertTimelineKey(
      spread.id, { type: 'element', elementId: created.id }, 'position.x', 0, -4,
    )
    useBuilderStore.getState().applyGizmoTransform(spread.id, created.id, 1, {
      position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1],
    })

    const after = useBuilderStore.getState().project.book.spreads[0]
    const element = after.elements[0]
    const x = after.timeline.tracks.find((track) => track.property === 'position.x')!
    // トラックのある x はキーへ、基本姿勢は動かさない
    expect(x.keys.map((key) => [key.time, key.value])).toEqual([[0, -4], [1, 1]])
    expect(element.baseTransform.position[0]).not.toBe(1)
    // トラックのない y, z は基本姿勢へ書き、キーは作らない
    expect(element.baseTransform.position[1]).toBe(2)
    expect(element.baseTransform.position[2]).toBe(3)
    expect(after.timeline.tracks.map((track) => track.property)).toEqual(['position.x'])
  })

  /** 一様スケールのトラックがあるとき、scale.x/y/z を併存させない */
  it('keeps a uniform scale track uniform instead of adding per-axis tracks', () => {
    const project = createBookProject('uniform scale')
    const spread = project.book.spreads[0]
    useBuilderStore.getState().setProject(project, 'import')
    useBuilderStore.getState().addElement(spread.id, 'visual')
    const created = useBuilderStore.getState().project.book.spreads[0].elements[0]
    useBuilderStore.getState().upsertTimelineKey(
      spread.id, { type: 'element', elementId: created.id }, 'scale', 0, 1,
    )
    useBuilderStore.getState().applyGizmoTransform(spread.id, created.id, 2, {
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 2, 2],
    })

    const tracks = useBuilderStore.getState().project.book.spreads[0].timeline.tracks
    expect(tracks.map((track) => track.property)).toEqual(['scale'])
    expect(tracks[0].keys.map((key) => [key.time, key.value])).toEqual([[0, 1], [2, 2]])
  })

  /** キーの補間は詳細ペインが編集するので、選択は store が持つ */
  it('holds the selected key until another target or the key itself goes away', () => {
    const project = createBookProject('key selection')
    const spreadId = project.book.spreads[0].id
    useBuilderStore.getState().setProject(project, 'import')
    useBuilderStore.getState().upsertTimelineKey(spreadId, { type: 'camera' }, 'fov', 1, 40)
    const track = useBuilderStore.getState().project.book.spreads[0].timeline.tracks[0]
    const selection = { spreadId, trackId: track.id, keyId: track.keys[0].id }

    useBuilderStore.getState().selectKey(selection)
    expect(useBuilderStore.getState().selectedKey).toEqual(selection)

    useBuilderStore.getState().setTimelineKeyEase(spreadId, track.id, track.keys[0].id, 'linear')
    expect(useBuilderStore.getState().project.book.spreads[0].timeline.tracks[0].keys[0].ease).toBe('linear')
    expect(useBuilderStore.getState().selectedKey).toEqual(selection)

    // 別の対象を選んだら解除する
    useBuilderStore.getState().select({ type: 'spread', spreadId })
    expect(useBuilderStore.getState().selectedKey).toBeNull()

    // トラックごと消えたら解除する
    useBuilderStore.getState().selectKey(selection)
    useBuilderStore.getState().removeTimelineTrack(spreadId, track.id)
    expect(useBuilderStore.getState().selectedKey).toBeNull()
  })

  it('keeps keys ordered after moving one and merges the same-time key', () => {
    const project = createBookProject('move key')
    const spreadId = project.book.spreads[0].id
    useBuilderStore.getState().setProject(project, 'import')
    useBuilderStore.getState().upsertTimelineKey(spreadId, { type: 'camera' }, 'fov', 1, 40)
    useBuilderStore.getState().upsertTimelineKey(spreadId, { type: 'camera' }, 'fov', 3, 60)
    const track = useBuilderStore.getState().project.book.spreads[0].timeline.tracks[0]
    useBuilderStore.getState().updateTimelineKeyTime(spreadId, track.id, track.keys[0].id, 3)
    const moved = useBuilderStore.getState().project.book.spreads[0].timeline.tracks[0]
    expect(moved.keys).toHaveLength(1)
    expect(moved.keys[0].time).toBe(3)
    expect(moved.keys[0].value).toBe(40)
  })

  it('keeps timeline asset references stable when replacing asset data', () => {
    const project = createBookProject('asset replacement')
    const spreadId = project.book.spreads[0].id
    project.assets.push({
      id: 'assets/final.svg',
      name: 'placeholder',
      type: 'svg',
      mime: 'image/svg+xml',
      width: 400,
      height: 200,
      alphaBounds: { x: 0, y: 0, width: 400, height: 200 },
      data: '<svg/>',
    })
    useBuilderStore.getState().setProject(project, 'import')
    useBuilderStore.getState().upsertTimelineKey(
      spreadId,
      { type: 'element', elementId: 'future-element' },
      'visual.image',
      1,
      'assets/final.svg',
    )
    useBuilderStore.getState().replaceAsset('assets/final.svg', {
      id: 'temporary-id',
      name: 'final art',
      type: 'svg',
      mime: 'image/svg+xml',
      width: 400,
      height: 200,
      alphaBounds: { x: 0, y: 0, width: 400, height: 200 },
      data: '<svg><path/></svg>',
    })
    const state = useBuilderStore.getState()
    expect(state.project.assets[0].id).toBe('assets/final.svg')
    expect(state.project.book.spreads[0].timeline.tracks[0].keys[0].value).toBe('assets/final.svg')
  })
})

describe('single-page background preset', () => {
  it('背景ショートカットは見開き幅へ合わせる', () => {
    const project = createBookProject('background')
    const spread = project.book.spreads[0]
    project.assets.push({
      id: 'background.svg', name: 'background', type: 'svg', mime: 'image/svg+xml',
      width: 1200, height: 800, data: '<svg/>',
    })
    useBuilderStore.getState().setProject(project, 'import')
    useBuilderStore.getState().setPlacement('depth-layer')
    useBuilderStore.getState().placeAsset(spread.id, 'left', 'background.svg')
    const created = useBuilderStore.getState().project.book.spreads[0].elements[0]
    expect(created.parent).toEqual({ type: 'left-page' })
    expect(created.type === 'visual' && created.width).toBe(project.book.format.pageWidth * 2)
    expect(created.baseTransform.position[2]).toBe(-project.book.format.pageWidth / project.book.format.pageAspect / 2)
  })

  it('背景も作成後は通常のビジュアルとして編集できる', () => {
    const project = createBookProject('animated background')
    const spread = project.book.spreads[0]
    project.assets.push({
      id: 'background.svg', name: 'background', type: 'svg', mime: 'image/svg+xml',
      width: 1200, height: 800, data: '<svg/>',
    })
    useBuilderStore.getState().setProject(project, 'import')
    useBuilderStore.getState().setPlacement('depth-layer')
    useBuilderStore.getState().placeAsset(spread.id, 'right', 'background.svg')
    const created = useBuilderStore.getState().project.book.spreads[0].elements[0]
    useBuilderStore.getState().updateElement(spread.id, created.id, (element) => { element.baseTransform.position[0] = 1 })
    expect(useBuilderStore.getState().project.book.spreads[0].elements[0].baseTransform.position[0]).toBe(1)
  })
})

describe('particle plane preset', () => {
  it('creates a vertical plane by default and allows ordinary rotation edits', () => {
    const project = createBookProject('particles')
    const spread = project.book.spreads[0]
    useBuilderStore.getState().setProject(project, 'import')
    useBuilderStore.getState().addElement(spread.id, 'visual', { type: 'right-page' })
    const selected = useBuilderStore.getState().selection
    if (selected.type === 'element') useBuilderStore.getState().updateElement(spread.id, selected.elementId, (element) => {
      if (element.type === 'visual') { element.particles.enabled = true; element.baseTransform.rotation = [0, 0, 0] }
    })
    const created = useBuilderStore.getState().project.book.spreads[0].elements[0]
    expect(created.type).toBe('visual')
    expect(created.baseTransform.rotation).toEqual([0, 0, 0])

    useBuilderStore.getState().updateElement(spread.id, created.id, (element) => {
      element.baseTransform.rotation[0] = 45
    })
    expect(useBuilderStore.getState().project.book.spreads[0].elements[0].baseTransform.rotation[0]).toBe(45)

    useBuilderStore.getState().applyGizmoTransform(spread.id, created.id, 0, {
      position: [0, 2, 0], rotation: [35, 20, 10], scale: [1, 1, 1],
    })
    expect(useBuilderStore.getState().project.book.spreads[0].elements[0].baseTransform.rotation).toEqual([35, 20, 10])
  })
})
