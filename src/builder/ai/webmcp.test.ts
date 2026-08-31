import { describe, expect, it } from 'vitest'
import { createBookProject } from '../../schema/bookDefaults'
import { useBuilderStore } from '../store'
import { createTobidasWebMcpTools, registerTobidasWebMcpTools } from './webmcp'
import type { WebMcpModelContext, WebMcpTool } from './webmcpTypes'

function setup() {
  const project = createBookProject('WebMCP test')
  project.assets.push({
    id: 'tree.webp',
    name: 'Tree',
    type: 'image',
    mime: 'image/webp',
    width: 100,
    height: 200,
    data: 'data:image/webp;base64,AA',
  })
  useBuilderStore.getState().setProject(project, 'import')
  return project.book.spreads[0].id
}

function tool(name: string): WebMcpTool {
  const found = createTobidasWebMcpTools().find((item) => item.name === name)
  if (!found) throw new Error(`tool not found: ${name}`)
  return found
}

async function invoke(name: string, input: Record<string, unknown> = {}) {
  return tool(name).execute(input, { signal: new AbortController().signal }) as Promise<{ content: [{ text: string }] }>
}

function payload(result: { content: [{ text: string }] }) {
  return JSON.parse(result.content[0].text) as Record<string, any>
}

describe('WebMCP adapter', () => {
  it('does nothing when the browser has no model context', async () => {
    const signal = new AbortController().signal
    expect(await registerTobidasWebMcpTools(null, signal)).toBe(false)
  })

  it('registers the fixed tool set with one cleanup signal', async () => {
    const registrations: Array<{ tool: WebMcpTool; signal?: AbortSignal }> = []
    const context: WebMcpModelContext = {
      registerTool: async (registered, options) => { registrations.push({ tool: registered, signal: options?.signal }) },
    }
    const controller = new AbortController()
    expect(await registerTobidasWebMcpTools(context, controller.signal)).toBe(true)
    expect(registrations.map(({ tool: registered }) => registered.name)).toEqual([
      'tobidas-get-state', 'tobidas-get-spread', 'tobidas-get-element', 'tobidas-list-assets', 'tobidas-validate-book',
      'tobidas-audit-layout',
      'tobidas-select-target', 'tobidas-set-preview', 'tobidas-enter-play', 'tobidas-enter-edit',
      'tobidas-place-asset', 'tobidas-set-page-background', 'tobidas-clear-page-background',
      'tobidas-create-visual', 'tobidas-update-element', 'tobidas-move-element', 'tobidas-set-element-parent',
      'tobidas-delete-element', 'tobidas-add-timeline-key', 'tobidas-list-timeline-keys',
      'tobidas-update-timeline-key', 'tobidas-delete-timeline-key', 'tobidas-set-camera',
      'tobidas-add-camera-key', 'tobidas-assign-bgm', 'tobidas-clear-bgm', 'tobidas-add-spread',
      'tobidas-duplicate-spread', 'tobidas-reorder-spread', 'tobidas-delete-spread',
      'tobidas-undo', 'tobidas-redo',
    ])
    expect(registrations.every(({ signal }) => signal === controller.signal)).toBe(true)
    controller.abort()
    expect(controller.signal.aborted).toBe(true)
  })

  it('places an asset through the normal command and returns the reflected element', async () => {
    const spreadId = setup()
    const beforeUndo = useBuilderStore.getState().undoStack.length
    const result = payload(await invoke('tobidas-place-asset', {
      spreadId, side: 'right', assetId: 'tree.webp', presetId: 'bottom-upright', u: .5, v: .5,
    }))

    expect(result.ok).toBe(true)
    expect(result.after.id).toBe(result.target.id)
    expect(result.after.image).toBe('tree.webp')
    expect(useBuilderStore.getState().undoStack.length).toBe(beforeUndo + 1)
  })

  it('assigns full-page artwork without creating a flat element', async () => {
    const spreadId = setup()
    const setResult = payload(await invoke('tobidas-set-page-background', {
      spreadId, side: 'left', assetId: 'tree.webp',
    }))

    expect(setResult.ok).toBe(true)
    expect(useBuilderStore.getState().project.book.spreads[0].leftPage.backgroundAsset).toBe('tree.webp')
    expect(useBuilderStore.getState().project.book.spreads[0].elements).toHaveLength(0)

    const clearResult = payload(await invoke('tobidas-clear-page-background', { spreadId, side: 'left' }))
    expect(clearResult.ok).toBe(true)
    expect(useBuilderStore.getState().project.book.spreads[0].leftPage.backgroundAsset).toBeUndefined()
  })

  it('exposes explicit destructive and spread tools with confirmation', async () => {
    const spreadId = setup()
    const created = payload(await invoke('tobidas-create-visual', { spreadId, side: 'right', presetId: 'page-text' }))
    const rejected = payload(await invoke('tobidas-delete-element', {
      spreadId, elementId: created.target.id, confirm: false,
    }))
    expect(rejected.ok).toBe(false)
    expect(useBuilderStore.getState().project.book.spreads[0].elements).toHaveLength(1)

    expect(payload(await invoke('tobidas-delete-element', {
      spreadId, elementId: created.target.id, confirm: true,
    })).ok).toBe(true)
    expect(useBuilderStore.getState().project.book.spreads[0].elements).toHaveLength(0)

    const duplicate = payload(await invoke('tobidas-duplicate-spread', { spreadId }))
    expect(duplicate.ok).toBe(true)
    expect(useBuilderStore.getState().project.book.spreads).toHaveLength(2)
    expect(payload(await invoke('tobidas-delete-spread', {
      spreadId: duplicate.target.id, confirm: true,
    })).ok).toBe(true)
    expect(useBuilderStore.getState().project.book.spreads).toHaveLength(1)
  })

  it('lists, updates, and deletes typed timeline keys and complete camera keys', async () => {
    const spreadId = setup()
    expect(payload(await invoke('tobidas-add-camera-key', {
      spreadId, time: 1, position: [0, 4, 10], target: [0, 0, 0], fov: 40,
    })).ok).toBe(true)
    const listed = payload(await invoke('tobidas-list-timeline-keys', { spreadId }))
    expect(listed.after).toHaveLength(3)
    const track = listed.after.find((item: any) => item.property === 'fov')
    const key = track.keys[0]
    expect(payload(await invoke('tobidas-update-timeline-key', {
      spreadId, trackId: track.id, keyId: key.id, value: 55, ease: 'easeInOut',
    })).ok).toBe(true)
    expect(payload(await invoke('tobidas-delete-timeline-key', {
      spreadId, trackId: track.id, keyId: key.id,
    })).ok).toBe(true)
    expect(useBuilderStore.getState().project.book.spreads[0].timeline.tracks.some((item) => item.property === 'fov')).toBe(false)
  })

  it('returns a structural layout audit separately from visual review', async () => {
    const spreadId = setup()
    const result = payload(await invoke('tobidas-audit-layout', { spreadId }))
    expect(result.ok).toBe(true)
    expect(result.after.spreads[0].spreadId).toBe(spreadId)
    expect(result.after.visualReviewRequired).toBe(true)
  })

  it('rejects invalid IDs and edits in play mode without changing the project', async () => {
    const spreadId = setup()
    const before = useBuilderStore.getState().project
    const invalid = payload(await invoke('tobidas-place-asset', {
      spreadId, side: 'right', assetId: 'missing.webp', presetId: 'bottom-upright', u: .5, v: .5,
    }))
    expect(invalid.ok).toBe(false)
    expect(useBuilderStore.getState().project).toBe(before)

    useBuilderStore.getState().setMode('play')
    const readOnly = payload(await invoke('tobidas-create-visual', { spreadId, side: 'right', presetId: 'page-text' }))
    expect(readOnly.ok).toBe(false)
    expect(useBuilderStore.getState().project).toBe(before)
  })

  it('exposes state without asset binary data and honors cancellation', async () => {
    setup()
    const state = payload(await invoke('tobidas-get-state'))
    expect(state.ok).toBe(true)
    expect(state.after.assets[0].id).toBe('tree.webp')
    expect(state.after.assets[0].data).toBeUndefined()

    const controller = new AbortController()
    controller.abort()
    await expect(tool('tobidas-get-state').execute({}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('supports selection and preview session controls without creating undo entries', async () => {
    const spreadId = setup()
    const beforeUndo = useBuilderStore.getState().undoStack.length
    expect(payload(await invoke('tobidas-select-target', { type: 'spread', id: spreadId })).after.selection.id).toBe(spreadId)
    expect(payload(await invoke('tobidas-set-preview', { spreadId, seconds: 0 })).after.spreadTime).toBe(0)
    expect(payload(await invoke('tobidas-enter-play')).after.mode).toBe('play')
    expect(payload(await invoke('tobidas-enter-edit')).after.mode).toBe('edit')
    expect(useBuilderStore.getState().undoStack.length).toBe(beforeUndo)
  })
})
