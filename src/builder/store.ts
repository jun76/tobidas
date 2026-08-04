import { create } from 'zustand'
import type { BookProject } from '../schema/bookPackage'
import { bookId, createBookProject, createSpread, createStageElement } from '../schema/bookDefaults'
import { compileBookBeats, evaluateBookSignals } from '../runtime/signals'
import { validateBookProject } from '../schema/bookValidate'
import { measureTextBox } from '../runtime/textStyle'
import { t } from './i18n'
import { ProjectAutosave } from './persistence/autosave'
import { saveProject } from './persistence/projectRepository'
import { containerElementIds, elementDescendantIds, reparentElement } from './hierarchy'
import type { EditorState } from './state/editorState'
import { normalizeElementLayout } from './state/elementConstraints'
import { PART_PRESETS, type VisualPresetId } from './presets'
import { BGM_VOLUME } from '../audio/playback'
import { createTimelineCommands } from './state/timelineCommands'

/**
 * 編集ビューで一時的に隠すものの識別子。
 * 作品データではなく編集セッションの状態なので、保存も書き出しもしない。
 */
export const hiddenKey = {
  element: (elementId: string) => `element:${elementId}`,
  page: (spreadId: string, side: 'left' | 'right') => `page:${spreadId}:${side}`,
  space: (spreadId: string) => `space:${spreadId}`,
  camera: 'camera',
  light: 'light',
} as const

const LIMIT = 60

const clone = (project: BookProject) => structuredClone(project)
const autosave = new ProjectAutosave(saveProject)

/**
 * 表示言語に合わせた既定の名前を持つ新規作品。
 * 名前は作品データなので、後から言語を切り替えても追従しない (作った時点の言葉が残る)。
 */
export function createLocalizedBookProject(): BookProject {
  const project = createBookProject(t().defaults.bookName)
  project.book.spreads[0].name = t().defaults.spreadName(1)
  return project
}

/**
 * 起動直後と作品を差し替えた直後にビュワーが見せる場所。
 *
 * 1つめの見開きがあればそれを開いた姿で見せる。進行値0は本が閉じた姿なので、
 * 見開きを選んだ扱いのまま0で始めると、ナビゲーターの選択と画面が食い違う。
 * 見開きが無い作品は表紙しか見るものがないので表表紙を選ぶ (タイムラインは出ない)。
 * 保存形式は見開きを1つ以上要求するので後者は本来起こらないが、
 * 壊れた作品を読んだときにここで落ちないようにしておく。
 */
function initialView(project: BookProject): Pick<EditorState, 'activeSpreadId' | 'selection' | 'previewProgress'> {
  const first = project.book.spreads[0]
  if (!first) return { activeSpreadId: '', selection: { type: 'cover', side: 'front' }, previewProgress: 0 }
  const hold = compileBookBeats(project.book).find((beat) => beat.kind === 'hold' && beat.spreadId === first.id)
  return {
    activeSpreadId: first.id,
    selection: { type: 'spread', spreadId: first.id },
    previewProgress: hold?.start ?? 0,
  }
}

export const useBuilderStore = create<EditorState>((set, get) => {
  const initial = createLocalizedBookProject()

  const commit = (change: (project: BookProject) => void) => {
    const previous = get().project
    const next = clone(previous)
    change(next)
    next.updatedAt = new Date().toISOString()
    set({
      project: next,
      undoStack: [...get().undoStack, previous].slice(-LIMIT),
      redoStack: [],
      issues: validateBookProject(next),
    })
    autosave.schedule(next)
  }

  const placeAssetWithPreset = (
    spreadId: string,
    side: 'left' | 'right',
    assetId: string,
    presetId: Extract<VisualPresetId, 'paper-stack' | 'bottom-upright' | 'depth-layer'>,
    point?: { x: number; y: number },
  ): string | null => {
    const preset = PART_PRESETS.find((item) => item.id === presetId)
    const state = get()
    const spread = state.project.book.spreads.find((item) => item.id === spreadId)
    const asset = state.project.assets.find((item) => item.id === assetId)
    if (!spread || !asset || (asset.type !== 'image' && asset.type !== 'svg') || !preset?.requiresAsset) return null

    const parent = { type: `${side}-page` as const }
    const created = createStageElement('visual', parent)
    if (created.type !== 'visual') return null
    const flat = preset.id === 'paper-stack'
    created.image = assetId
    created.name = asset.name
    if (asset.width && asset.height) created.height = created.width * asset.height / asset.width
    created.pivot = flat ? [.5, .5] : [.5, 0]
    const width = state.project.book.format.pageWidth
    const depth = width / state.project.book.format.pageAspect
    const x = ((point?.x ?? .5) - .5) * width
    created.baseTransform.position = [x, flat ? .005 : 0, ((point?.y ?? .5) - .5) * depth]
    created.baseTransform.rotation = flat ? [-90, 0, 0] : [0, 0, 0]
    if (preset.id === 'depth-layer') {
      created.width = width * 2
      created.height = asset.width && asset.height ? created.width * asset.height / asset.width : depth
      created.pivot = [.5, 0]
      created.baseTransform.position = [side === 'left' ? width / 2 : -width / 2, 0, -depth / 2]
    }
    commit((project) => {
      const target = project.book.spreads.find((item) => item.id === spreadId)
      if (!target) return
      target.elements.push(created)
      normalizeElementLayout(target, created.id, width)
    })
    set({ selection: { type: 'element', spreadId, elementId: created.id } })
    return created.id
  }

  const addPresetVisual = (
    spreadId: string,
    side: 'left' | 'right',
    presetId: Extract<VisualPresetId, 'light-particles' | 'page-text'>,
  ): string | null => {
    const state = get()
    if (!state.project.book.spreads.some((item) => item.id === spreadId)) return null
    const created = createStageElement('visual', { type: `${side}-page` })
    if (created.type !== 'visual') return null
    if (presetId === 'light-particles') {
      created.name = t().presets[presetId]
      created.particles.enabled = true
      created.width = 2
      created.height = 2
      created.pivot = [.5, 0]
      created.baseTransform.rotation = [0, 0, 0]
    } else {
      created.name = t().defaults.text
      created.text = t().defaults.text
      created.pivot = [.5, .5]
      created.baseTransform.rotation = [-90, 0, 0]
      const measured = measureTextBox(created, created.fontSize)
      created.width = measured.width
      created.height = measured.height
    }
    commit((project) => {
      const target = project.book.spreads.find((item) => item.id === spreadId)
      if (!target) return
      target.elements.push(created)
      normalizeElementLayout(target, created.id, project.book.format.pageWidth)
    })
    set({ selection: { type: 'element', spreadId, elementId: created.id } })
    return created.id
  }

  return {
    project: initial,
    projectSession: 0,
    ...initialView(initial),
    selectedKey: null,
    hidden: new Set<string>(),
    mode: 'edit',
    placement: null,
    gizmo: 'translate',
    undoStack: [],
    redoStack: [],
    issues: validateBookProject(initial),
    source: 'new',
    commit,

    setProject: (incoming, source) => {
      const project = clone(incoming)
      set({
        project,
        projectSession: get().projectSession + 1,
        source,
        ...initialView(project),
        selectedKey: null,
        hidden: new Set<string>(),
        mode: 'edit',
        placement: null,
        gizmo: 'translate',
        undoStack: [],
        redoStack: [],
        issues: validateBookProject(project),
      })
      if (source !== 'idb') autosave.schedule(project)
    },
    undo: () => {
      const state = get()
      const project = state.undoStack.at(-1)
      if (!project) return
      set({
        project,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, state.project],
        selection: { type: 'book' },
        issues: validateBookProject(project),
      })
      autosave.schedule(project)
    },
    redo: () => {
      const state = get()
      const project = state.redoStack.at(-1)
      if (!project) return
      set({
        project,
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, state.project],
        selection: { type: 'book' },
        issues: validateBookProject(project),
      })
      autosave.schedule(project)
    },
    // 別の対象を選び直したらキーの選択は解く。詳細ペインに
    // 無関係な部品のキーが残らないようにする
    select: (selection) => set((state) => {
      // 表紙は見開きの外にあり保持区間を持たないので、閉じた本の両端へ寄せる。
      // 進行値0は表表紙が正面、1は最後までめくって裏表紙が正面
      if (selection.type === 'cover') {
        return { selection, selectedKey: null, previewProgress: selection.side === 'front' ? 0 : 1 }
      }
      if (!('spreadId' in selection)) return { selection, selectedKey: null }
      // 別の見開きへ移るなら進行値もその保持区間へ運ぶ。完全展開でない見開きは
      // ギズモが出ないので、選んだのに触れない状態になってしまう
      const hold = selection.spreadId === state.activeSpreadId ? undefined
        : compileBookBeats(state.project.book).find(
          (beat) => beat.kind === 'hold' && beat.spreadId === selection.spreadId,
        )
      return {
        selection,
        activeSpreadId: selection.spreadId,
        selectedKey: null,
        ...(hold ? { previewProgress: hold.start } : {}),
      }
    }),
    selectKey: (selectedKey) => set({ selectedKey }),
    toggleHidden: (key) => set((state) => {
      const hidden = new Set(state.hidden)
      if (!hidden.delete(key)) hidden.add(key)
      return { hidden }
    }),
    ...createTimelineCommands({ commit, get, set }),
    setMode: (mode) => {
      if (mode === 'play') {
        set({ mode, previewProgress: 0 })
        return
      }
      // 戻り先は「直前に再生で見ていた見開き」。最後に編集していた見開きへ
      // 戻すと、再生でめくった先を直したいときに必ず選び直すことになる
      const state = get()
      const book = state.project.book
      const shown = book.spreads[evaluateBookSignals(book, state.previewProgress).activeSpreadIndex]
      const activeSpreadId = shown?.id ?? state.activeSpreadId
      // 再生中に進めた進行値のまま編集へ戻ると、見開きが完全展開でないため
      // ギズモが出ない。その見開きの保持区間の外にいるときは引き戻す
      const hold = compileBookBeats(book).find(
        (beat) => beat.kind === 'hold' && beat.spreadId === activeSpreadId,
      )
      const inside = hold && state.previewProgress >= hold.start && state.previewProgress <= hold.end
      const moved = activeSpreadId !== state.activeSpreadId
      set({
        mode,
        activeSpreadId,
        ...(inside ? {} : { previewProgress: hold?.start ?? 0 }),
        // 別の見開きへ移ったなら、前の見開きの部品を選んだままにしない
        ...(moved ? { selection: { type: 'spread', spreadId: activeSpreadId }, selectedKey: null } : {}),
      })
    },
    setPlacement: (placement) => set({ placement }),
    setGizmo: (gizmo) => set({ gizmo }),
    setPreviewProgress: (previewProgress) => set({ previewProgress: Math.min(1, Math.max(0, previewProgress)) }),
    setActiveSpread: (id) => {
      const book = get().project.book
      const hold = compileBookBeats(book).find((beat) => beat.kind === 'hold' && beat.spreadId === id)
      set({
        activeSpreadId: id,
        selection: { type: 'spread', spreadId: id },
        selectedKey: null,
        previewProgress: hold ? hold.start : get().previewProgress,
      })
    },
    addSpread: () => {
      const spread = createSpread(t().defaults.spreadName(get().project.book.spreads.length + 1))
      commit((project) => project.book.spreads.push(spread))
      get().setActiveSpread(spread.id)
    },
    duplicateSpread: (id) => {
      const source = get().project.book.spreads.find((spread) => spread.id === id)
      if (!source) return
      const copy = structuredClone(source)
      copy.id = createSpread().id
      copy.name = t().defaults.copySuffix(copy.name)
      const remap = new Map(copy.elements.map((element) => [element.id, createStageElement('group').id]))
      copy.elements.forEach((element) => {
        element.id = remap.get(element.id)!
        if (element.parent.type === 'element') element.parent.elementId = remap.get(element.parent.elementId) ?? element.parent.elementId
      })
      copy.timeline.tracks.forEach((track) => {
        track.id = bookId('track')
        track.keys.forEach((key) => { key.id = bookId('key') })
        if (track.target.type === 'element') track.target.elementId = remap.get(track.target.elementId) ?? track.target.elementId
      })
      commit((project) => {
        project.book.spreads.splice(project.book.spreads.findIndex((spread) => spread.id === id) + 1, 0, copy)
      })
      get().setActiveSpread(copy.id)
    },
    moveSpread: (id, direction) => commit((project) => {
      const index = project.book.spreads.findIndex((spread) => spread.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= project.book.spreads.length) return
      const [spread] = project.book.spreads.splice(index, 1)
      project.book.spreads.splice(target, 0, spread)
    }),
    removeSpread: (id) => {
      if (get().project.book.spreads.length < 2) return
      commit((project) => { project.book.spreads = project.book.spreads.filter((spread) => spread.id !== id) })
      get().setActiveSpread(get().project.book.spreads[0].id)
    },
    addElement: (spreadId, type, parent = { type: 'right-page' }, assetId) => {
      const element = createStageElement(type, parent)
      element.name = t().defaults.part
      if (element.type === 'visual') {
        element.image = assetId
        element.name = get().project.assets.find((asset) => asset.id === assetId)?.name ?? t().defaults.imagePart
      }
      commit((project) => {
        const spread = project.book.spreads.find((item) => item.id === spreadId)
        if (!spread) return
        spread.elements.push(element)
        normalizeElementLayout(spread, element.id, project.book.format.pageWidth)
      })
      set({ selection: { type: 'element', spreadId, elementId: element.id } })
    },
    moveElement: (spreadId, id, parent) => commit((project) => {
      const spread = project.book.spreads.find((item) => item.id === spreadId)
      const element = spread?.elements.find((item) => item.id === id)
      if (!spread || !element) return
      reparentElement(spread, id, parent, project.book.format.pageWidth)
      normalizeElementLayout(spread, id, project.book.format.pageWidth)
    }),
    /**
     * 選択中のプリセットで紙面へ置く。
     *
     * どの型で置くかはプリセットが決める。プリセットを選ばずに置ける経路を
     * 残すと、結局「押した瞬間に出る」経路と二本立てに戻るので、
     * 選択が無いときは何もしない (呼ぶ側がドロップ先を出さない)。
     */
    placeAsset: (spreadId, side, assetId, point) => {
      const placement = get().placement
      const preset = PART_PRESETS.find((item) => item.id === placement)
      if (!preset || !preset.requiresAsset) return
      placeAssetWithPreset(spreadId, side, assetId, preset.id as Extract<VisualPresetId, 'paper-stack' | 'bottom-upright' | 'depth-layer'>, point)
    },
    placeAssetWithPreset,
    addPresetVisual,
    updateElement: (spreadId, id, change) => commit((project) => {
      const element = project.book.spreads.find((spread) => spread.id === spreadId)?.elements.find((item) => item.id === id)
      if (element) {
        change(element)
        const spread = project.book.spreads.find((item) => item.id === spreadId)
        if (spread) normalizeElementLayout(spread, id, project.book.format.pageWidth)
      }
    }),
    removeElement: (spreadId, id) => {
      commit((project) => {
        const spread = project.book.spreads.find((item) => item.id === spreadId)
        if (!spread) return
        const removed = elementDescendantIds(spread, id)
        removed.add(id)
        spread.elements = spread.elements.filter((element) => !removed.has(element.id))
        spread.timeline.tracks = spread.timeline.tracks.filter(
          (track) => track.target.type !== 'element' || !removed.has(track.target.elementId),
        )
      })
      set({ selection: { type: 'spread', spreadId } })
    },
    clearContainerElements: (spreadId, parentType) => {
      commit((project) => {
        const spread = project.book.spreads.find((item) => item.id === spreadId)
        if (!spread) return
        const removed = containerElementIds(spread, parentType)
        spread.elements = spread.elements.filter((element) => !removed.has(element.id))
        spread.timeline.tracks = spread.timeline.tracks.filter(
          (track) => track.target.type !== 'element' || !removed.has(track.target.elementId),
        )
      })
      set({ selection: { type: 'page', spreadId, side: parentType === 'left-page' ? 'left' : 'right' } })
    },
    addAsset: (asset) => commit((project) => project.assets.push(asset)),
    /**
     * BGMは作品に一つ。冒頭からループ再生する。
     * 既にあるときは差し替える。取り込みと割り当てを一度の操作にするので、
     * 取り消しも一度で戻る。
     */
    assignBgm: (asset) => commit((project) => {
      if (!project.assets.some((item) => item.id === asset.id)) project.assets.push(asset)
      project.audio = { bgmAsset: asset.id, volume: BGM_VOLUME, loop: true }
    }),
    clearBgm: () => commit((project) => { project.audio = undefined }),
    replaceAsset: (id, asset) => commit((project) => {
      const index = project.assets.findIndex((item) => item.id === id)
      if (index >= 0) project.assets[index] = { ...asset, id }
    }),
    removeAsset: (id) => commit((project) => { project.assets = project.assets.filter((asset) => asset.id !== id) }),
  }
})

export const ELEMENT_DND_MIME = 'application/x-tobidas-stage-element'
