import { describe, expect, it } from 'vitest'
import { createBookProject } from '../../schema/bookDefaults'
import { useBuilderStore } from '../store'
import { createAiVisual, placeAiAsset, updateAiElement } from './commands'

function setup() {
  const project = createBookProject('AI commands')
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

describe('AI commands', () => {
  it('places an existing asset with spine-based normalized coordinates as one undo operation', () => {
    const spreadId = setup()
    const before = useBuilderStore.getState().undoStack.length
    const result = placeAiAsset({
      spreadId,
      side: 'left',
      assetId: 'tree.webp',
      presetId: 'bottom-upright',
      u: .25,
      v: .5,
    })

    expect(result.ok).toBe(true)
    const state = useBuilderStore.getState()
    const created = state.project.book.spreads[0].elements[0]
    expect(created.parent).toEqual({ type: 'left-page' })
    expect(created.baseTransform.position[0]).toBe(2)
    expect(state.undoStack.length).toBe(before + 1)
    expect(state.selection).toEqual({ type: 'element', spreadId, elementId: created.id })
  })

  it('rejects invalid normalized coordinates without changing the project', () => {
    const spreadId = setup()
    const before = useBuilderStore.getState().project
    const result = placeAiAsset({
      spreadId,
      side: 'right',
      assetId: 'tree.webp',
      presetId: 'paper-stack',
      u: Number.NaN,
      v: 2,
    })

    expect(result.ok).toBe(false)
    expect(useBuilderStore.getState().project).toBe(before)
    expect(useBuilderStore.getState().project.book.spreads[0].elements).toHaveLength(0)
  })

  it('creates an immediate text part in one undo operation', () => {
    const spreadId = setup()
    const before = useBuilderStore.getState().undoStack.length
    const result = createAiVisual({ spreadId, side: 'right', presetId: 'page-text' })

    expect(result.ok).toBe(true)
    const state = useBuilderStore.getState()
    const created = state.project.book.spreads[0].elements[0]
    expect(created.type === 'visual' && created.text.length).toBeGreaterThan(0)
    expect(state.undoStack.length).toBe(before + 1)
  })

  it('creates an independent particle part without visual content fields', () => {
    const spreadId = setup()
    const result = createAiVisual({ spreadId, side: 'right', presetId: 'light-particles' })

    expect(result.ok).toBe(true)
    const created = useBuilderStore.getState().project.book.spreads[0].elements[0]
    expect(created.type).toBe('particle')
    expect(created.type === 'particle' && created.particles.count).toBe(6)
    expect(created.type === 'particle' && 'image' in created).toBe(false)
    expect(created.type === 'particle' && 'text' in created).toBe(false)
  })

  it('updates a part through the normal constraint and validation path', () => {
    const spreadId = setup()
    const placed = placeAiAsset({
      spreadId,
      side: 'right',
      assetId: 'tree.webp',
      presetId: 'bottom-upright',
      u: .5,
      v: .5,
    })
    if (!placed.ok || !placed.target) throw new Error('part was not created')
    const result = updateAiElement(spreadId, placed.target.id, {
      name: 'Updated tree',
      position: [0, -5, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      pivot: [.25, .75],
      layer: 2,
      visible: true,
      opacity: .7,
      width: 2,
      height: 4,
      billboard: true,
      image: null,
      backImage: 'tree.webp',
      backgroundColor: '#11223344',
      foregroundColor: '#ffeedd',
      text: '',
      fontSize: .5,
      font: 'serif',
      align: 'right',
      bold: false,
      italic: true,
      underline: true,
      particles: { enabled: true, color: '#aabbcc', count: 12, size: .2, drift: .3, period: 4 },
      motion: [{ type: 'spin', axis: 'y', speed: .5 }],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.message)
    expect(result.corrections[0]).toContain('0,-5,0')
    const updated = useBuilderStore.getState().project.book.spreads[0].elements[0]
    expect(updated.name).toBe('Updated tree')
    expect(updated.baseTransform.position[1]).toBeGreaterThanOrEqual(0)
    expect(updated.pivot).toEqual([.25, .75])
    expect(updated.type === 'visual' && updated.backImage).toBe('tree.webp')
    expect(updated.type === 'visual' && updated.billboard).toBe(true)
    expect(updated.type === 'visual' && updated.font).toBe('serif')
    expect(updated.type === 'visual' && updated.particles.count).toBe(12)
    expect(updated.motion[0]?.type).toBe('spin')
    expect(useBuilderStore.getState().issues.ok).toBe(true)
  })
})
