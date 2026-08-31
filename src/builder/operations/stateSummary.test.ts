import { describe, expect, it } from 'vitest'
import { createBookProject, createStageElement } from '../../schema/bookDefaults'
import { useBuilderStore } from '../store'
import { buildBuilderStateSummary } from './stateSummary'

describe('builder state summary', () => {
  it('distinguishes same-name parts by their saved ids', () => {
    const project = createBookProject('AI summary')
    const spread = project.book.spreads[0]
    const first = createStageElement('visual', { type: 'left-page' })
    const second = createStageElement('visual', { type: 'right-page' })
    first.name = 'Tree'
    second.name = 'Tree'
    spread.elements.push(first, second)
    useBuilderStore.getState().setProject(project, 'import')
    useBuilderStore.getState().select({ type: 'element', spreadId: spread.id, elementId: second.id })

    const summary = buildBuilderStateSummary(useBuilderStore.getState())
    expect(summary.selection).toEqual({ kind: 'element', id: second.id, label: 'Tree' })
    expect(summary.selectedElement?.id).toBe(second.id)
    expect(summary.selectedElement?.parent).toEqual({ type: 'right-page' })
  })

  it('counts references from book, parts, sound tracks, and image keys', () => {
    const project = createBookProject('AI assets')
    const spread = project.book.spreads[0]
    project.assets.push(
      { id: 'image.webp', name: 'image', type: 'image', mime: 'image/webp', data: 'data:image/webp;base64,AA' },
      { id: 'sound.wav', name: 'sound', type: 'audio', mime: 'audio/wav', data: 'data:audio/wav;base64,AA' },
    )
    const element = createStageElement('visual')
    if (element.type === 'visual') element.image = 'image.webp'
    spread.elements.push(element)
    spread.leftPage.backgroundAsset = 'image.webp'
    spread.timeline.tracks.push(
      { id: 'sound-track', target: { type: 'sound', assetId: 'sound.wav' }, property: 'cue', keys: [{ id: 'cue', time: 1, value: true, ease: 'hold' }] },
      { id: 'image-track', target: { type: 'element', elementId: element.id }, property: 'visual.image', keys: [{ id: 'image-key', time: 1, value: 'image.webp', ease: 'hold' }] },
    )
    useBuilderStore.getState().setProject(project, 'import')

    const assets = buildBuilderStateSummary(useBuilderStore.getState()).assets
    expect(assets.find((asset) => asset.id === 'image.webp')?.references).toBe(3)
    expect(assets.find((asset) => asset.id === 'sound.wav')?.references).toBe(1)
  })

  it('exposes every spread, part, track, and key for autonomous editing', () => {
    const project = createBookProject('AI production state')
    const first = project.book.spreads[0]
    first.name = 'Opening'
    first.sequence.holdSeconds = 4
    const element = createStageElement('visual', { type: 'right-page' })
    element.name = 'Train'
    first.elements.push(element)
    first.timeline.tracks.push({
      id: 'train-x',
      target: { type: 'element', elementId: element.id },
      property: 'position.x',
      keys: [{ id: 'train-x-0', time: 0, value: 0, ease: 'linear' }],
    })
    useBuilderStore.getState().setProject(project, 'import')

    const summary = buildBuilderStateSummary(useBuilderStore.getState())
    expect(summary.spreads).toHaveLength(1)
    expect(summary.spreads[0]).toMatchObject({ id: first.id, name: 'Opening', holdSeconds: 4 })
    expect(summary.spreads[0].elements[0]).toMatchObject({ id: element.id, name: 'Train' })
    expect(summary.spreads[0].timeline[0]).toMatchObject({ id: 'train-x', property: 'position.x' })
    expect(summary.spreads[0].timeline[0].keys).toEqual([{ id: 'train-x-0', time: 0, value: 0, ease: 'linear' }])
  })
})
