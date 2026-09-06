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

  it('実接続の表示演出と、仮想機構の移動演出は有効なままにする', () => {
    const { project, parent, spread } = fixture(true)
    const virtual = createStageElement('assembly') as AssemblyElement
    virtual.name = '浮く箱'; spread.elements.push(virtual)
    const add = (id: string, elementId: string, property: TimelineProperty, value: TimelineValue, ease: 'hold' | 'linear') => {
      spread.timeline.tracks.push({ id, target: { type: 'element', elementId }, property,
        keys: [{ id: `${id}-key`, time: 1, value, ease }] })
    }
    add('hide', parent.id, 'visible', false, 'hold')
    add('fade', parent.id, 'opacity', .4, 'linear')
    add('move', virtual.id, 'position.x', 3, 'linear')
    add('enlarge', virtual.id, 'scale', 2, 'linear')
    expect(validateBookProject(project).errors).toEqual([])
  })

  it('存在しない面の素材指定を保存時に検出する', () => {
    const { project, parent } = fixture()
    parent.mechanism.surfaces['missing-roof'] = { color: '#fff', visible: true }
    expect(validateBookProject(project).errors).toContain('箱: unknown mechanism surface missing-roof')
  })

  it('親箱の実在する天面へ子機構と人物を取り付けられる', () => {
    const { project, parent, spread } = fixture()
    const roof = createStageElement('assembly', { type: 'element', elementId: parent.id }) as AssemblyElement
    roof.name = '屋根'
    roof.mechanism = makeMechanism('v-fold', { mount: { type: 'surface', elementId: parent.id, surfaceId: 'top-left', u: .5, v: .5, offset: 0 } })
    const person = createStageElement('visual', { type: 'element', elementId: parent.id }) as VisualElement
    person.name = '人物'; person.surfaceAttachment = { surfaceId: 'top-right', u: .5, v: .5, offset: 0 }
    spread.elements.push(roof, person)
    expect(validateBookProject(project).errors).toEqual([])

    roof.mechanism.mount = { type: 'surface', elementId: parent.id, surfaceId: 'not-a-face', u: .5, v: .5, offset: 0 }
    person.surfaceAttachment.surfaceId = 'also-missing'
    const errors = validateBookProject(project).errors
    expect(errors).toContain('屋根: unknown parent surface not-a-face')
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

  it('実接続で成立する境界寸法を許し、仮想の巨大作品には同じ上限を強制しない', () => {
    const { project, parent } = fixture(true)
    parent.mechanism = makeMechanism('box', { parameters: { width: 8, height: 4, depth: 6.4 }, deployment: { mode: 'page-constrained' } })
    expect(validateBookProject(project).errors).toEqual([])
    parent.mechanism = makeMechanism('v-fold', { parameters: { width: 6, height: 4, depth: 6.4 }, deployment: { mode: 'page-constrained' } })
    expect(validateBookProject(project).errors).toEqual([])
    parent.mechanism = makeMechanism('box', { parameters: { width: 30, height: 40, depth: 50 } })
    parent.baseTransform.position = [25, 10, 30]
    expect(validateBookProject(project).errors).toEqual([])
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
