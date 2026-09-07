import { describe, expect, it } from 'vitest'
import { createBookProject } from '../../schema/bookDefaults'
import { useBuilderStore } from '../store'
import { createTobidasWebMcpTools, registerTobidasWebMcpTools } from './tools'
import type { WebMcpModelContext, WebMcpTool } from './types'

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
    const names = registrations.map(({ tool }) => tool.name)
    expect(names).toEqual(expect.arrayContaining(['tobidas-get-part-catalog', 'tobidas-place-part', 'tobidas-update-placed-part', 'tobidas-get-state']))
    expect(names).not.toContain('tobidas-create-mechanism')
    expect(names).not.toContain('tobidas-create-composition')
    expect(names).not.toContain('tobidas-place-asset')
    expect(names).not.toContain('tobidas-add-part-node')
    expect(createTobidasWebMcpTools('part').map((tool) => tool.name)).toContain('tobidas-add-part-node')
    for (const screen of ['home', 'book', 'part', 'settings'] as const) {
      const registered = createTobidasWebMcpTools(screen)
      expect(registered.length).toBeLessThan(50)
      expect(JSON.stringify(registered).length).toBeLessThan(60000)
    }
    expect(registrations.every(({ signal }) => signal === controller.signal)).toBe(true)
    controller.abort()
    expect(controller.signal.aborted).toBe(true)
  })

  it('places an asset through the normal command and returns the reflected element', async () => {
    const spreadId = setup()
    const beforeUndo = useBuilderStore.getState().undoStack.length
    const result = payload(await invoke('tobidas-place-part', {
      spreadId, name: 'Tree', definition: { builtin: 'flat', version: 1 }, mount: { type: 'output', nodeId: '$book', portId: 'right-page' }, materials: { face: { image: 'tree.webp' } },
    }))

    expect(result.ok).toBe(true)
    const created = useBuilderStore.getState().project.book.spreads[0].elements.find((element) => element.id === result.target.id)!
    expect(created.type === 'part' && created.part.materials.face.image).toBe('tree.webp')
    expect(useBuilderStore.getState().undoStack.length).toBe(beforeUndo + 1)
  })

  it('二面駆動の部品を作り、未定義入力と接続の破壊を拒否する', async () => {
    const spreadId = setup()
    const parent = payload(await invoke('tobidas-place-part', { spreadId, name: '背景', definition: { builtin: 'backdrop', version: 1 }, mount: { type: 'output', nodeId: '$book', portId: 'gutter' } }))
    expect(parent.ok).toBe(true)
    const child = payload(await invoke('tobidas-place-part', { spreadId, name: '看板', definition: { builtin: 'upright', version: 1 },
      mount: { type: 'output', nodeId: parent.target.id, portId: 'ground-backdrop' }, parameters: { width: 1, height: 1, distance: 1, supportHeight: .5 } }))
    expect(child.ok).toBe(true)
    const before = useBuilderStore.getState().project
    expect(payload(await invoke('tobidas-update-placed-part', { spreadId, elementId: child.target.id, changes: { arbitraryJSON: {} } })).ok).toBe(false)
    expect(payload(await invoke('tobidas-update-placed-part', { spreadId, elementId: child.target.id,
      changes: { mount: { type: 'output', nodeId: '$book', portId: 'gutter' } } })).ok).toBe(false)
    expect(useBuilderStore.getState().project).toBe(before)
  })

  it('reads and updates the current work authoring guide', async () => {
    setup()
    const guide = payload(await invoke('tobidas-get-authoring-guide', { locale: 'en', keys: ['spreadGround'] }))
    expect(guide.after.locale).toBe('en')
    expect(guide.after.items).toEqual([expect.objectContaining({
      key: 'spreadGround',
      label: 'Spread ground',
      text: expect.stringContaining('ground surfaces'),
    })])

    const updated = payload(await invoke('tobidas-update-authoring-guide', {
      locale: 'en', changes: { spreadGround: 'Use a painted floor as the scene ground.' },
    }))
    expect(updated.ok).toBe(true)
    expect(updated.after.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'spreadGround', text: 'Use a painted floor as the scene ground.' }),
    ]))
    expect(useBuilderStore.getState().project.authoringGuide.en.spreadGround)
      .toBe('Use a painted floor as the scene ground.')
    expect(useBuilderStore.getState().project.authoringGuide.ja.spreadGround)
      .not.toBe('Use a painted floor as the scene ground.')
  })

  it('rejects unknown authoring-guide keys', async () => {
    setup()
    const before = useBuilderStore.getState().project.authoringGuide.en.spreadGround
    const result = payload(await invoke('tobidas-update-authoring-guide', {
      changes: { unknownRule: 'do not accept this' },
    }))
    expect(result.ok).toBe(false)
    expect(useBuilderStore.getState().project.authoringGuide.en.spreadGround).toBe(before)
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
    const created = payload(await invoke('tobidas-place-part', { spreadId, name: 'Text', definition: { builtin: 'text', version: 1 }, mount: { type: 'output', nodeId: '$book', portId: 'right-page' } }))
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
    const invalid = payload(await invoke('tobidas-place-part', {
      spreadId, name: 'Missing', definition: { builtin: 'flat', version: 1 }, mount: { type: 'output', nodeId: '$book', portId: 'right-page' }, materials: { face: { image: 'missing.webp' } },
    }))
    expect(invalid.ok).toBe(false)
    expect(useBuilderStore.getState().project).toBe(before)

    useBuilderStore.getState().setMode('play')
    const readOnly = payload(await invoke('tobidas-place-part', { spreadId, name: 'Text', definition: { builtin: 'text', version: 1 }, mount: { type: 'output', nodeId: '$book', portId: 'right-page' } }))
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
