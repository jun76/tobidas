import { describe, expect, it } from 'vitest'
import { createBookProject, createStageElement } from './bookDefaults'
import { validateBookProject } from './bookValidate'
import { makeMechanism } from './mechanism'
import type { AssemblyElement, VisualElement } from './stageElement'
import type { TimelineProperty, TimelineValue } from './timeline'

function fixture(physical = false) {
  const project = createBookProject('機構検証')
  const parent = createStageElement('assembly') as AssemblyElement
  parent.name = '箱'
  parent.mechanism = makeMechanism('box', { deployment: { mode: physical ? 'page-constrained' : 'virtual' } })
  project.book.spreads[0].elements = [parent]
  return { project, parent, spread: project.book.spreads[0] }
}

describe('機構の接続参照とタイムライン検証', () => {
  it.each<TimelineProperty>([
    'position.x', 'position.y', 'position.z',
    'rotation.x', 'rotation.y', 'rotation.z',
    'scale', 'scale.x', 'scale.y', 'scale.z',
  ])('実ページへ接続した箱の%sトラックを拒否する', (property) => {
    const { project, parent, spread } = fixture(true)
    spread.timeline.tracks.push({ id: 'move-real-anchor', target: { type: 'element', elementId: parent.id }, property,
      keys: [{ id: 'key', time: 1, value: 2, ease: 'linear' }] })
    const validation = validateBookProject(project)
    expect(validation.ok).toBe(false)
    expect(validation.errors).toContain(`element:${parent.id}:${property}: real page anchors cannot use transform timeline tracks`)
  })

  it('表示トラックと明示的な支持付き演出を許し、仮想モードも接着点の移動トラックは拒否する', () => {
    const { project, parent, spread } = fixture(true)
    const virtual = createStageElement('assembly') as AssemblyElement
    virtual.mechanism = makeMechanism('box', { deployment: { mode: 'virtual' }, staging: { openScale: 2, openPosition: [0, .6, 0], floatAmplitude: [0, .2, 0] } })
    virtual.name = '浮く箱'; spread.elements.push(virtual)
    const add = (id: string, elementId: string, property: TimelineProperty, value: TimelineValue, ease: 'hold' | 'linear') => {
      spread.timeline.tracks.push({ id, target: { type: 'element', elementId }, property,
        keys: [{ id: `${id}-key`, time: 1, value, ease }] })
    }
    add('hide', parent.id, 'visible', false, 'hold')
    add('fade', parent.id, 'opacity', .4, 'linear')
    expect(validateBookProject(project).errors).toEqual([])
    add('move', virtual.id, 'position.x', 3, 'linear')
    add('enlarge', virtual.id, 'scale', 2, 'linear')
    expect(validateBookProject(project).errors).toEqual([
      `element:${virtual.id}:position.x: real page anchors cannot use transform timeline tracks`,
      `element:${virtual.id}:scale: real page anchors cannot use transform timeline tracks`,
    ])
  })

  it('存在しない面の素材指定を保存時に検出する', () => {
    const { project, parent } = fixture()
    parent.mechanism.surfaces['missing-roof'] = { color: '#fff', visible: true }
    expect(validateBookProject(project).errors).toContain('箱: unknown mechanism surface missing-roof')
  })

  it('折れる屋根を親箱のブリッジへ、人物を天面へ取り付けられる', () => {
    const { project, parent, spread } = fixture()
    const roof = createStageElement('assembly', { type: 'element', elementId: parent.id }) as AssemblyElement
    roof.name = '屋根'
    roof.mechanism = makeMechanism('v-fold', { mount: { type: 'bridge', elementId: parent.id, bridgeId: 'deck', v: .5 } })
    const person = createStageElement('visual', { type: 'element', elementId: parent.id }) as VisualElement
    person.name = '人物'; person.surfaceAttachment = { surfaceId: 'top-right', u: .5, v: .5, offset: 0 }
    spread.elements.push(roof, person)
    expect(validateBookProject(project).errors).toEqual([])

    parent.mechanism = makeMechanism('accordion')
    person.surfaceAttachment.surfaceId = 'also-missing'
    const errors = validateBookProject(project).errors
    expect(errors).toContain('屋根: unknown parent bridge deck')
    expect(errors).toContain('人物: unknown parent surface also-missing')
  })

  it('折り帯の面数変更で消える取り付け先を検出する', () => {
    const { project, parent, spread } = fixture()
    parent.mechanism = makeMechanism('accordion', { parameters: { segments: 6 } })
    const child = createStageElement('visual', { type: 'element', elementId: parent.id }) as VisualElement
    child.name = '葉'; child.surfaceAttachment = { surfaceId: 'fold-5', u: .5, v: .5, offset: 0 }
    spread.elements.push(child)
    expect(validateBookProject(project).errors).toEqual([])
    parent.mechanism.parameters.segments = 4
    expect(validateBookProject(project).errors).toContain('葉: unknown parent surface fold-5')
  })

  it('面の指定がない直下部品を黙って描画対象から落とさない', () => {
    const { project, parent, spread } = fixture()
    const child = createStageElement('visual', { type: 'element', elementId: parent.id })
    child.name = '人物'; spread.elements.push(child)
    expect(validateBookProject(project).errors).toContain('人物: assembly child requires a surface attachment')
  })

  it.each(['box', 'platform', 'v-fold'] as const)('実駆動%sの接着辺が有限な紙の外なら拒否する', (kind) => {
    const { project, parent } = fixture(true)
    parent.mechanism = makeMechanism(kind, { parameters: { width: 30 }, deployment: { mode: 'page-constrained' } })
    expect(validateBookProject(project).errors).toContain('箱: real gutter anchors exceed page width')
    parent.mechanism.parameters.width = 3
    parent.baseTransform.position[2] = 3
    expect(validateBookProject(project).errors).toContain('箱: real gutter anchor lines exceed page depth')
    parent.baseTransform.position[2] = -3
    expect(validateBookProject(project).errors).toContain('箱: real gutter anchor lines exceed page depth')
  })

  it.each(['box', 'platform', 'v-fold'] as const)('実駆動%sは接着点だけ収まっても畳んだ紙が外へ抜ける寸法を拒否する', (kind) => {
    const { project, parent } = fixture(true)
    parent.mechanism = makeMechanism(kind, { parameters: { width: 3, height: 9 }, deployment: { mode: 'page-constrained' } })
    const errors = validateBookProject(project).errors
    expect(errors).not.toContain('箱: real gutter anchors exceed page width')
    expect(errors).toContain('箱: rigid folded mechanism exceeds finite page reach')
  })

  it('有限の実接着点から明示的に巨大展開できるが、無指定の空中ルート移動は拒否する', () => {
    const { project, parent } = fixture(true)
    parent.mechanism = makeMechanism('box', { parameters: { width: 8, height: 4, depth: 6.4 }, deployment: { mode: 'page-constrained' } })
    expect(validateBookProject(project).errors).toEqual([])
    parent.mechanism = makeMechanism('v-fold', { parameters: { width: 6, height: 4, depth: 6.4 }, deployment: { mode: 'page-constrained' } })
    expect(validateBookProject(project).errors).toEqual([])
    parent.mechanism = makeMechanism('box', { parameters: { width: 6, height: 3, depth: 4 }, deployment: { mode: 'virtual' }, staging: { openScale: 5, openPosition: [0, 2, 0] } })
    expect(validateBookProject(project).errors).toEqual([])
    parent.baseTransform.position = [25, 10, 30]
    expect(validateBookProject(project).errors).toContain('箱: gutter anchors require x=0 and y=0')
    parent.baseTransform.position = [0, 0, 0]
    parent.mechanism.parameters.width = 30
    expect(validateBookProject(project).errors).toContain('箱: real gutter anchors exceed page width')
  })

  it('片面パネルの実寸ヒンジを親のUV範囲へ収め、折り線を跨ぐ配置は拒否する', () => {
    const { project, parent, spread } = fixture(true)
    parent.mechanism = makeMechanism('platform', { parameters: { width: 6, depth: 2 } })
    const rail = createStageElement('assembly', { type: 'element', elementId: parent.id }) as AssemblyElement
    rail.name = '欄干'
    rail.mechanism = makeMechanism('panel', { parameters: { width: 1 }, mount: { type: 'surface', elementId: parent.id, surfaceId: 'top', u: .25, v: .5, offset: 0 } })
    spread.elements.push(rail)
    expect(validateBookProject(project).errors).toEqual([])
    rail.mechanism.mount = { type: 'surface', elementId: parent.id, surfaceId: 'top', u: .5, v: .5, offset: 0 }
    expect(validateBookProject(project).errors).toContain('欄干: surface panel hinge cannot cross parent fold')
    rail.mechanism.mount = { type: 'surface', elementId: parent.id, surfaceId: 'wall-left', u: .1, v: .5, offset: 0 }
    expect(validateBookProject(project).errors).toContain('欄干: surface panel hinge exceeds parent face width')
  })

  it('片ページの実ヒンジと折り終わるパネルを、その紙の範囲へ限定する', () => {
    const { project, parent } = fixture(true)
    parent.mechanism = makeMechanism('panel', { parameters: { width: 3, height: 2 }, deployment: { mode: 'page-constrained' } })
    expect(validateBookProject(project).errors).toEqual([])
    parent.baseTransform.position = [3, 0, 0]
    expect(validateBookProject(project).errors).toContain('箱: real page hinge exceeds page width')
    parent.baseTransform.position = [0, 0, -2]
    expect(validateBookProject(project).errors).toContain('箱: folded real page panel exceeds page depth')
    parent.baseTransform.position = [0, 1, 0]
    expect(validateBookProject(project).errors).toContain('箱: real page hinge requires y=0')
  })
})
