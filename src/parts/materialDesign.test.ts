import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { BUILTIN_PARTS, builtinPart } from './catalog'
import { evaluatePartGraph, evaluatePartReference } from './evaluate'
import { makeFace, pagePorts, pointOnFace, type PaperEvaluation } from './geometry'
import { createPaperMotionInspector, inspectPaper } from './validate'
import type { PartNode } from './schema'

const paper = (width = 2): PaperEvaluation => ({ faces: [makeFace('sheet', new Vector3(), new Vector3(1, 0, 0), new Vector3(0, 1, 0), width, 2, true)], ports: {}, connections: [] })
function pasted(offset = 0): PaperEvaluation {
  const parent = makeFace('parent', new Vector3(), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 10, 10)
  const child = makeFace('child', new Vector3(2 + offset, 2, 0), parent.u, parent.v, 2, 2)
  const line = [pointOnFace(child, 0, 0), pointOnFace(child, 2, 0)]
  return { faces: [child], ports: {}, inputPort: { kind: 'surface', face: parent },
    connections: [{ parentFace: parent.id, childFace: child.id, actual: line, expected: line.map((p) => p.clone()) }] }
}

describe('開閉を通じて固定する紙の設計', () => {
  it('全基本部品と旧背景の固定寸法・輪郭・接着線を、実角度と全体姿勢が変わっても保つ', () => {
    for (const spec of [...BUILTIN_PARTS, builtinPart('backdrop', 1)]) for (const uniformScale of [1, 1.3]) {
      const inspect = createPaperMotionInspector(), limit = spec.input.kind === 'fold-pair' ? spec.input.maxOpeningAngleDeg : 180
      for (const rotation of [0, 23, 91]) for (const angle of [limit, 0, limit / 2, .001, limit * .9, limit / 3, limit, 0]) {
        const ports = pagePorts(80, 80, (angle + rotation) * Math.PI / 180, rotation * Math.PI / 180)
        const input = spec.input.kind === 'surface' ? ports['left-page'] : ports.gutter
        const result = evaluatePartReference({ builtin: spec.id, version: spec.version }, input, {}, {}, {}, 'part', [], uniformScale)
        expect(inspect(result, [input]), `${spec.id}@${spec.version}/${uniformScale}/${angle}/${rotation}`).toEqual([])
      }
    }
  })

  it('青いカードの三角支持は、左右のめくりと評価順が変わっても同じ紙として折れる', () => {
    const nodes: PartNode[] = [
      { id: 'backdrop', name: '屏風', definition: { builtin: 'backdrop', version: 2 }, mount: { type: 'output', nodeId: '$book', portId: 'gutter' }, parameters: { width: 9, height: 2, offset: -1 }, materials: {} },
      { id: 'card', name: '青いカード', definition: { builtin: 'angled-upright', version: 1 }, mount: { type: 'output', nodeId: 'backdrop', portId: 'ground-backdrop-b' }, parameters: { width: 1.3, height: 1, yawAngle: 45, offset: -.8 }, materials: {} },
    ]
    const inspect = createPaperMotionInspector()
    for (const direction of ['left', 'right']) for (const angle of [180, 0, .001, 30, 90, 179.9, 180, 150, 30, 0]) {
      const ports = pagePorts(8, 6.4, direction === 'left' ? angle * Math.PI / 180 : Math.PI, direction === 'right' ? (180 - angle) * Math.PI / 180 : 0)
      const result = evaluatePartGraph(nodes, {}, undefined, { $book: ports })
      expect(inspect(result), `${direction}/${angle}`).toEqual([])
      const support = result.nodes.card.faces.find((f) => f.support)!
      const a = support.origin, b = pointOnFace(support, 1, 0), c = pointOnFace(support, 1, support.height)
      expect(a.distanceTo(b)).toBeCloseTo(1, 9)
      expect(b.distanceTo(c)).toBeCloseTo(Math.tan(Math.PI / 8), 9)
      expect(a.distanceTo(c)).toBeCloseTo(1 / Math.cos(Math.PI / 8), 9)
    }
  })

  it('単一姿勢では整っていても、途中で支持紙の寸法が変わる候補を拒否する', () => {
    const inspect = createPaperMotionInspector(), first = paper(), changed = paper(2.2)
    expect(inspect(first)).toEqual([]); expect(inspectPaper(changed)).toEqual([])
    expect(inspect(changed)).toContain('Paper material changes during folding: sheet')
    expect(inspect(paper())).toEqual([])
  })

  it('外接寸法が同じでも、紙の輪郭が変わる候補を拒否する', () => {
    const inspect = createPaperMotionInspector(), first = paper(), changed = paper()
    first.faces[0].outline = [[0, 0], [1, 0], [1, 1], [0, 1], [.1, .5]]
    changed.faces[0].outline = [[0, 0], [1, 0], [1, 1], [0, 1], [.3, .5]]
    expect(inspect(first)).toEqual([]); expect(inspectPaper(changed)).toEqual([])
    expect(inspect(changed)).toContain('Paper material changes during folding: sheet')
  })

  it('接続が瞬間ごとに一致していても、親面の上を滑る配置を拒否する', () => {
    const inspect = createPaperMotionInspector()
    expect(inspect(pasted())).toEqual([]); expect(inspectPaper(pasted(.2))).toEqual([])
    expect(inspect(pasted(.2))).toContain('Paper attachment moves during folding: parent / child')
  })

  it('紙が移動しなくても、接着線だけが材料の上を滑る候補を拒否する', () => {
    const inspect = createPaperMotionInspector(), changed = pasted()
    expect(inspect(pasted())).toEqual([])
    for (const points of [changed.connections[0].actual, changed.connections[0].expected]) for (const p of points) p.y += .2
    expect(inspectPaper(changed)).toEqual([])
    expect(inspect(changed)).toContain('Paper attachment moves during folding: parent / child')
  })

  it('同じ評価オブジェクトを書き換えても基準寸法と接着位置を失わない', () => {
    const inspect = createPaperMotionInspector(), result = pasted()
    expect(inspect(result)).toEqual([])
    result.faces[0].height += .2
    expect(inspect(result)).toContain('Paper material changes during folding: child')
    result.faces[0].height -= .2
    result.connections[0].actual[0].x += .1; result.connections[0].expected[0].x += .1
    expect(inspect(result)).toContain('Paper attachment moves during folding: parent / child')
  })

  it('支持紙や接続が途中で消える候補と、解決できない接着面を拒否する', () => {
    const inspect = createPaperMotionInspector(), missing = pasted()
    expect(inspect(missing)).toEqual([])
    expect(inspect({ ...missing, faces: [] })).toContain('Missing paper attachment surface: child')
    expect(inspect({ ...missing, connections: [] })).toContain('Paper connections change during folding')
    const added = { ...missing, faces: [...missing.faces, paper().faces[0]] }
    expect(inspect(added)).toContain('Paper topology changes during folding')
  })

  it('絵柄と描画層、接着線の列挙方向は紙の形状変更とみなさない', () => {
    const inspect = createPaperMotionInspector(), changed = pasted()
    expect(inspect(pasted())).toEqual([])
    changed.faces[0].material = { color: '#809bc9', text: 'カード' }
    changed.faces[0].surfaceStack = { base: changed.faces[0], layers: ['front'] }
    changed.connections[0].actual.reverse(); changed.connections[0].expected.reverse()
    expect(inspect(changed)).toEqual([])
  })
})
