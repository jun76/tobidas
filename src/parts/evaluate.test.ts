import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { evaluateBuiltin } from './builtins'
import { evaluatePartReference } from './evaluate'
import { faceCorners, openingAngle, pagePorts, type FoldPair } from './geometry'
import { newPartDefinition } from './schema'
import type { PaperShape } from './shape'
import { createPaperMotionInspector, inspectClosedLayout, inspectPaper, syncDefinitionRequirements, validatePartDefinition } from './validate'

const pairAt = (angle: number, rotation = 0) => pagePorts(8, 10, (angle + rotation) * Math.PI / 180, rotation * Math.PI / 180).gutter as FoldPair
describe('connected paper parts', () => {
  it('二本の足だけを接地させ、入れ子・拡縮・開閉でも同じ紙と接着区間を保つ', () => {
    const definition = newPartDefinition('机', { kind: 'fold-pair', maxOpeningAngleDeg: 90 })
    const shape: PaperShape = { outer: [[.1, 0], [.2, 0], [.2, .3], [.7, .3], [.7, 0], [.9, 0], [.9, 1], [.1, 1]], holes: [] }
    definition.nodes.push({ id: 'desk', name: '机', definition: { builtin: 'upright', version: 1 }, mount: { type: 'input' },
      parameters: { width: 2, height: 2, distance: 1, supportHeight: 1, supportWidth: .2 }, materials: {}, shapes: { panel: shape } })
    syncDefinitionRequirements(definition)
    for (const scale of [1, 1.7]) for (const rotation of [0, 36]) {
      const inspect = createPaperMotionInspector()
      for (const angle of [90, 60, 15, 0, 30, 90]) {
        const input = pairAt(angle, rotation)
        const result = evaluatePartReference({ custom: 'desk' }, input, { desk: definition }, {}, {}, 'scene', [], scale)
        expect(inspect(result, [input])).toEqual([])
        const panel = result.faces.find(face => face.id === 'scene/desk/panel')!
        expect(panel.shape).toEqual(shape)
        const feet = result.connections.filter(connection => connection.childFace === panel.id)
        expect(feet).toHaveLength(2)
        expect(feet.map(foot => foot.actual[0].distanceTo(foot.actual[1]))).toEqual([expect.closeTo(.2 * scale), expect.closeTo(.4 * scale)])
        const support = result.faces.find(face => face.support)!
        expect(support.width).toBeCloseTo(.2 * scale)
        expect(result.connections.filter(connection => connection.childFace === support.id)).toHaveLength(2)
      }
    }
    definition.nodes[0].shapes!.panel = { ...shape, holes: [[[.45, .45], [.55, .45], [.55, .55], [.45, .55]]] }
    expect(validatePartDefinition(definition).errors).toContainEqual(expect.stringContaining('Outline cuts through an attachment'))
    definition.nodes[0].shapes!.panel = { outer: [[.1, .1], [.9, .1], [.9, 1], [.1, 1]], holes: [] }
    expect(validatePartDefinition(definition).errors).toContainEqual(expect.stringContaining('ground attachment edge'))
  })
  it('家の裏からずらした支持を延ばし、孫の紙も同じ接着位置と材料で折る', () => {
    const inspect = createPaperMotionInspector()
    for (const angle of [180, 150, 90, 30, 0, 90, 180]) {
      const input = pairAt(angle)
      const background = evaluateBuiltin('backdrop', input, { width: 12, height: 2, offset: -2, splayAngle: 150 }, 'background', 2)
      const house = evaluateBuiltin('upright', background.ports['ground-backdrop'],
        { width: 2.4, height: 1.4, distance: .7, supportHeight: .6, supportWidth: .2 }, 'house')
      const tree = evaluateBuiltin('upright', house.ports['ground-panel'],
        { width: 1.2, height: 1, distance: .8, supportHeight: .4, supportWidth: .12, supportOffset: -.3 }, 'tree')
      const combined = { faces: [...background.faces, ...house.faces, ...tree.faces], ports: {},
        connections: [...background.connections, ...house.connections, ...tree.connections] }
      expect(inspect(combined, [input])).toEqual([])
      const support = tree.faces.find((face) => face.id === 'tree/support')!
      expect(support.width).toBeCloseTo(.12)
      expect(support.height).toBeCloseTo(.8)
      expect(tree.connections.some((edge) => edge.parentFace === 'house/panel' && edge.childFace === support.id)).toBe(true)
      const panel = tree.faces.find((face) => face.id === 'tree/panel')!
      const contact = tree.connections.find((edge) => edge.parentFace === panel.id)!.expected[0]
      expect(contact.clone().sub(panel.origin).dot(panel.u)).toBeCloseTo(.24)
    }
  })
  it('親の足の隙間を通る仮想交線を許可しても、背面支持が穴へ接着する配置は拒否する', () => {
    const definition = newPartDefinition('机と小物', { kind: 'fold-pair', maxOpeningAngleDeg: 90 })
    definition.nodes.push(
      { id: 'desk', name: '机', definition: { builtin: 'upright', version: 1 }, mount: { type: 'input' }, parameters: { width: 2, height: 2, distance: 1 }, materials: {},
        shapes: { panel: { outer: [[.1, 0], [.2, 0], [.2, .3], [.8, .3], [.8, 0], [.9, 0], [.9, 1], [.1, 1]], holes: [] } } },
      { id: 'child', name: '小物', definition: { builtin: 'upright', version: 1 }, materials: {}, parameters: { width: 1, height: 1, distance: 1, supportHeight: .8 },
        mount: { type: 'pair', a: { nodeId: '$input', portId: 'a' }, b: { nodeId: 'desk', portId: 'panel' },
          hingeA: [[4.5, 1], [5.5, 1]], hingeB: [[.5, 0], [1.5, 0]], directionA: 'positive', directionB: 'positive', foldSign: 1 } },
    )
    const input = pairAt(90), result = () => evaluatePartReference({ custom: 'scene' }, input, { scene: definition })
    expect(inspectPaper(result(), [input])).toEqual([])
    definition.nodes[1].parameters.supportHeight = .2
    expect(() => result()).toThrow('Attachment exceeds surface')
  })
  it('支持の横移動で紙から接着辺が外れる場合は拒否する', () => {
    expect(() => evaluateBuiltin('upright', pairAt(90), { width: 1, supportWidth: .3, supportOffset: .4 })).toThrow('Support must fit')
    expect(() => evaluateBuiltin('upright', pairAt(90), { width: 1, supportWidth: .3, supportOffset: -.4 })).toThrow('Support must fit')
  })
  it('第1改訂の四節起立と箱・台の内部リンクの接着と剛性を保つ', () => {
    for (const rotation of [0, 23, 91]) for (const angle of [0, .001, 15, 45, 90, 150, 180]) {
      const result = evaluateBuiltin('backdrop', pairAt(angle, rotation), { height: 2, distance: 1, width: 3 }, 'backdrop', 1)
      expect(inspectPaper(result)).toEqual([])
      const panel = result.faces[0]
      expect(faceCorners(panel)[0].distanceTo(faceCorners(panel)[3])).toBeCloseTo(2, 9)
      const output = result.ports['ground-backdrop'] as FoldPair
      if (angle === 180) expect(openingAngle(output)).toBeCloseTo(90, 8)
      if (angle === 0) expect(inspectClosedLayout(result, 8, 10, pairAt(0, rotation).rayA)).toEqual([])
    }
  })
  it('第1改訂に接続済みの縦置きも実際の支持面から駆動する', () => {
    for (const angle of [0, 30, 90, 120, 180]) {
      const background = evaluateBuiltin('backdrop', pairAt(angle), { height: 2, distance: 1, width: 3 }, 'backdrop', 1)
      const mounting = background.ports['ground-backdrop'] as FoldPair
      const person = evaluateBuiltin('upright', mounting, { height: 1.5, supportHeight: 1, distance: 1 })
      expect(inspectPaper({ ...person, faces: [...background.faces, ...person.faces] })).toEqual([])
      expect(person.faces[0].v.distanceTo(mounting.rayB)).toBeLessThan(1e-10)
      if (angle === 0) expect(inspectClosedLayout(person, 8, 10)).toEqual([])
    }
  })
  it('uses the actual 90 degree pose without expanding it to the reference 180 degrees', () => {
    const definition = newPartDefinition('Roof')
    definition.nodes.push({ id: 'roof', name: 'Roof', definition: { builtin: 'v-fold', version: 1 }, mount: { type: 'input' }, parameters: {}, materials: {} })
    syncDefinitionRequirements(definition)
    const half = evaluatePartReference({ custom: 'roof' }, pairAt(90), { roof: definition })
    const direct = evaluateBuiltin('v-fold', pairAt(90), {}, 'part/roof')
    expect(half.faces.map(faceCorners)).toEqual(direct.faces.map(faceCorners))
    definition.input = { kind: 'fold-pair', maxOpeningAngleDeg: 150 }
    expect(() => evaluatePartReference({ custom: 'roof' }, pairAt(180), { roof: definition })).toThrow('exceeds 150')
    expect(() => evaluatePartReference({ custom: 'roof' }, pairAt(90), { roof: definition })).not.toThrow()
  })
  it('validates the transformed inner angles instead of taking the minimum child limit', () => {
    const child = newPartDefinition('Person', { kind: 'fold-pair', maxOpeningAngleDeg: 90 })
    child.nodes.push({ id: 'figure', name: 'Figure', definition: { builtin: 'upright', version: 1 }, mount: { type: 'input' }, parameters: {}, materials: {} })
    syncDefinitionRequirements(child)
    const hash = 'a'.repeat(64), parent = newPartDefinition('Scene')
    parent.nodes.push(
      { id: 'backdrop', name: 'Backdrop', definition: { builtin: 'backdrop', version: 1 }, mount: { type: 'input' }, parameters: {}, materials: {} },
      { id: 'person', name: 'Person', definition: { custom: hash }, mount: { type: 'output', nodeId: 'backdrop', portId: 'ground-backdrop' }, parameters: {}, materials: {} },
    )
    syncDefinitionRequirements(parent)
    expect(validatePartDefinition(parent, { [hash]: child }).errors).toEqual([])
  })
  it('keeps the box and folding band faces rigid throughout a partial opening', () => {
    for (const id of ['folding-box', 'accordion', 'platform', 'v-fold', 'beak'] as const) for (const angle of [0, 15, 45, 90, 135, 180]) {
      const result = evaluateBuiltin(id, pairAt(angle))
      expect(inspectPaper(result)).toEqual([])
      for (const face of result.faces) expect(face.u.dot(face.v)).toBeCloseTo(0, 8)
    }
  })
  it('rejects detached dimensions and preserves the pose across evaluation order', () => {
    expect(() => evaluateBuiltin('upright', pairAt(90), { distance: 10 })).toThrow('exceeds surface')
    const first = evaluateBuiltin('backdrop', pairAt(46), {}, 'backdrop', 1)
    evaluateBuiltin('backdrop', pairAt(180), {}, 'backdrop', 1); evaluateBuiltin('backdrop', pairAt(0), {}, 'backdrop', 1)
    expect(evaluateBuiltin('backdrop', pairAt(46), {}, 'backdrop', 1).faces.map(faceCorners)).toEqual(first.faces.map(faceCorners))
    expect(first.faces[0].u).toEqual(new Vector3(0, 0, 1))
  })
  it('箱の90度姿勢を保ち、縦置きの足を分けた輪郭を許可し、未公開の素材指定を拒否する', () => {
    const definition = newPartDefinition('箱')
    definition.nodes.push({ id: 'box', name: '箱', definition: { builtin: 'folding-box', version: 1 }, mount: { type: 'input' }, parameters: {}, materials: {} })
    syncDefinitionRequirements(definition)
    const partial = evaluatePartReference({ custom: 'box' }, pairAt(90), { box: definition })
    expect(partial.faces.map(faceCorners)).toEqual(evaluateBuiltin('folding-box', pairAt(90), {}, 'part/box').faces.map(faceCorners))
    expect(partial.faces.map(faceCorners)).not.toEqual(evaluateBuiltin('folding-box', pairAt(180), {}, 'part/box').faces.map(faceCorners))
    expect(() => evaluatePartReference({ custom: 'box' }, pairAt(90), { box: definition }, {}, { hidden: { color: '#ffffff' } })).toThrow('Unknown public material slot')
    definition.input = { kind: 'fold-pair', maxOpeningAngleDeg: 90 }
    definition.nodes[0].definition = { builtin: 'upright', version: 1 }
    definition.nodes[0].outline = [[0, 0], [.3, 0], [.5, .4], [.7, 0], [1, 0], [1, 1], [0, 1]]
    syncDefinitionRequirements(definition)
    expect(validatePartDefinition(definition).errors).toEqual([])
  })
})
