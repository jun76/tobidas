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
      'tobidas-select-target', 'tobidas-set-preview', 'tobidas-enter-play', 'tobidas-enter-edit',
      'tobidas-place-asset', 'tobidas-create-visual', 'tobidas-update-element', 'tobidas-move-element',
      'tobidas-add-timeline-key', 'tobidas-assign-bgm', 'tobidas-clear-bgm', 'tobidas-add-spread',
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
