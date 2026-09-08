import { describe, expect, it } from 'vitest'
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { evaluateBuiltin } from './builtins'
import { faceCorners, makeFace, pagePorts, pointOnFace, type FoldPair, type PaperFace } from './geometry'
import { bookPaperDisplay, paperDisplayFace, paperDisplayFaces, paperMeshData, type BookPaperDisplay } from './paperDisplay'
import { evaluatePartGraph, resolveBinding } from './evaluate'
import { inspectPaper } from './validate'
import { backdropForBook } from './backdrop'
import type { PartNode } from './schema'

const width = 8, depth = 6.4, thickness = .015
const displayAt = (left: number, right: number, index = 1, count = 4, frontCoverY = thickness, paperThickness = thickness) => bookPaperDisplay({
  width, depth, thickness: paperThickness, index, count, frontCoverY, leftAngle: left * Math.PI / 180, rightAngle: right * Math.PI / 180,
})

describe('親面と貼り紙の描画順', () => {
  const flat = (parent: PaperFace, id: string, parameters: Record<string, number> = {}) =>
    evaluateBuiltin('flat', { kind: 'surface', face: parent }, { width: 1, height: 1, v: parent.height / 2, ...parameters }, id).faces[0]

  it('立った面への重ね貼りと兄弟の貼り紙を分離し、剛体の寸法と材料座標を保つ', () => {
    const parent = makeFace('wall', new Vector3(1, 2, 3), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 4, 4)
    const first = flat(parent, 'first', { width: 2, height: 2, rotation: 23 })
    const child = flat(first, 'child'), sibling = flat(parent, 'sibling')
    const faces = [parent, first, child, sibling], before = faces.map(faceCorners)
    const drawn = paperDisplayFaces(faces)
    for (let i = 1; i < faces.length; i++) {
      const offset = drawn[i].origin.clone().sub(faces[i].origin)
      expect(offset.x).toBeCloseTo(0, 10); expect(offset.y).toBeCloseTo(0, 10)
      expect(drawn[i].origin.z).toBeGreaterThan(drawn[i - 1].origin.z)
      expect(drawn[i].renderOrder!).toBeGreaterThan(drawn[i - 1].renderOrder!)
      for (const [j, corner] of faceCorners(drawn[i]).entries()) expect(corner.distanceTo(before[i][j])).toBeCloseTo(offset.length(), 10)
      expect(drawn[i].width).toBe(faces[i].width); expect(drawn[i].height).toBe(faces[i].height)
    }
    expect(faces.map(faceCorners)).toEqual(before)
  })

  it('重ねた紙をクリックすると最上面に当たり、回転した部品の材料位置を取得できる', () => {
    const parent = makeFace('wall', new Vector3(1, 2, 3), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 4, 4)
    const first = flat(parent, 'first', { width: 2, height: 2, rotation: 23 }), child = flat(first, 'child')
    const meshes = paperDisplayFaces([parent, first, child]).map((face) => {
      const geometry = new BufferGeometry(), data = paperMeshData(face)
      geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3))
      const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }))
      mesh.name = face.id; mesh.matrixAutoUpdate = false
      mesh.matrix.makeBasis(face.u, face.v, face.u.clone().cross(face.v)).setPosition(face.origin)
      mesh.updateMatrixWorld(true)
      return mesh
    })
    const target = pointOnFace(child, .3, .7)
    const hits = new Raycaster(target.clone().add(new Vector3(0, 0, 5)), new Vector3(0, 0, -1)).intersectObjects(meshes)
    expect(hits[0].object.name).toBe(child.id)
    const local = hits[0].object.worldToLocal(hits[0].point.clone())
    expect(local.x).toBeCloseTo(.3, 6); expect(local.y).toBeCloseTo(.7, 6)
    meshes.forEach((mesh) => { mesh.geometry.dispose(); mesh.material.dispose() })
  })

  it('左・右ページを開閉しても内向きの法線に重ね、100枚でも紙厚内に収める', () => {
    for (const paperThickness of [.006, thickness]) for (const closing of [false, true]) for (const angle of [10, 45, 90, 150, 180]) for (const side of ['left-page', 'right-page']) {
      const left = closing ? 180 : angle, right = closing ? 180 - angle : 0
      const port = pagePorts(width, depth, left * Math.PI / 180, right * Math.PI / 180)[side]
      if (port.kind !== 'surface') throw new Error('Expected page')
      const faces: PaperFace[] = []
      for (let i = 0; i < 100; i++) faces.push(flat(faces[i - 1] ?? port.face, `flat-${i}`))
      const display = displayAt(left, right, 1, 4, paperThickness, paperThickness), surface = display.surfaces[side === 'left-page' ? 0 : 1]
      let previous = 0
      for (const face of paperDisplayFaces(faces, display)) {
        const height = surface.plane.distanceToPoint(face.origin)
        expect(height).toBeGreaterThan(previous)
        expect(height).toBeLessThanOrEqual(paperThickness / 2 + 1e-9)
        expect(area(face, display)).toBeCloseTo(1, 7)
        previous = height
      }
    }
  })

  it('補完ブリッジと仮想接続面を介した貼り紙も順序を保ち、閉じ側の紙を突き抜けない', () => {
    const node = (id: string, builtin: string, mount: PartNode['mount'], parameters: Record<string, number> = {}): PartNode =>
      ({ id, name: id, definition: { builtin, version: builtin === 'backdrop' ? 2 : 1 }, mount, parameters, materials: {} })
    const output = (nodeId: string, portId: string): PartNode['mount'] => ({ type: 'output', nodeId, portId })
    const nodes = [
      node('background', 'backdrop', output('$book', 'gutter'), backdropForBook(width, depth)),
      node('upright', 'upright', output('background', 'ground-backdrop'), { width: 2, height: 1.5, distance: 1 }),
      node('flat', 'flat', { type: 'output', nodeId: 'upright', portId: 'panel',
        extension: { min: [0, 0], max: [2.5, 1.5], panels: [{ min: [2, 0], max: [2.5, 1.5] }] } }, { width: 2, height: 1, v: .75 }),
      node('text', 'text', output('flat', 'face'), { width: 1, height: .5, v: .5 }),
    ]
    const scene = (angle: number, closing = true) => {
      const left = closing ? 180 : angle, right = closing ? 180 - angle : 0
      const graph = evaluatePartGraph(nodes, {}, undefined, { $book: pagePorts(width, depth, left * Math.PI / 180, right * Math.PI / 180) })
      const before = graph.faces.map(faceCorners), display = displayAt(left, right)
      const drawn = paperDisplayFaces(graph.faces, display), byId = new Map(drawn.map((face) => [face.id, face]))
      const panel = byId.get('upright/panel')!, bridge = byId.get('flat/mount/surface/bridge-0')!, sheet = byId.get('flat/face')!, text = byId.get('text/face')!
      const normal = panel.u.clone().cross(panel.v)
      const levels = [panel, bridge, sheet, text].map((face) => normal.dot(face.origin.clone().sub(panel.origin)))
      for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1] + .0009)
      // カスタム部品用に入力枠を付け替えても、支持紙までの層を失わない。
      const framed = resolveBinding({ type: 'output', nodeId: 'flat', portId: 'face', frame: { origin: [0, 0], width: 2, height: 1 } },
        undefined, () => graph.nodes.flat.ports.face)
      const label = evaluateBuiltin('text', framed, { width: .5, height: .5, v: .5 }, 'framed-text').faces[0]
      const framedDrawn = paperDisplayFaces([...graph.faces, label], display).at(-1)!
      expect(normal.dot(framedDrawn.origin.clone().sub(sheet.origin))).toBeGreaterThan(0)
      let vertices = 0
      for (const face of drawn) for (const point of drawnVertices(face, display)) {
        vertices++
        for (const surface of display.surfaces) expect(surface.plane.distanceToPoint(point)).toBeGreaterThanOrEqual(-1e-7)
      }
      if (angle >= 15) expect(vertices).toBeGreaterThan(0)
      expect(inspectPaper(graph)).toEqual([])
      expect(graph.faces.map(faceCorners)).toEqual(before)
      return drawn.map((face) => ({ origin: face.origin.toArray(), order: face.renderOrder, mesh: paperMeshData(face, display.surfaces) }))
    }
    const expected = scene(55)
    for (const closing of [true, false]) for (const angle of [0, 1, 3, 15, 90, 150, 180]) scene(angle, closing)
    expect(scene(55)).toEqual(expected)
  })
})
function drawnVertices(face: PaperFace, display: BookPaperDisplay): Vector3[] {
  const data = paperMeshData(face, display.surfaces)
  return Array.from({ length: data.positions.length / 3 }, (_, i) => face.origin.clone()
    .addScaledVector(face.u, data.positions[i * 3]).addScaledVector(face.v, data.positions[i * 3 + 1]))
}
function area(face: PaperFace, display?: BookPaperDisplay) {
  const data = paperMeshData(face, display?.surfaces), points = data.positions
  let sum = 0
  for (let i = 0; i < points.length; i += 9) sum += Math.abs((points[i + 3] - points[i]) * (points[i + 7] - points[i + 1])
    - (points[i + 4] - points[i + 1]) * (points[i + 6] - points[i])) / 2
  return sum
}

describe('実紙面による部品の表示と遮蔽', () => {
  it('本文は裏返る紙の内側を向く法線へ載せ、世界Y方向へ持ち上げない', () => {
    for (const right of [0, 60, 90, 110, 135, 160, 175]) {
      const ports = pagePorts(width, depth, Math.PI, right * Math.PI / 180)
      const caption = evaluateBuiltin('text', ports['right-page'], { width: 2, height: .5, v: 4 }).faces[0]
      const display = displayAt(180, right), drawn = paperDisplayFace(caption, display)
      const rotate = new Matrix4().makeRotationZ(right * Math.PI / 180)
      // PaperSlabの紙葉中心t/2、表面t/2、印刷面0.003を独立に合成する。
      for (const point of faceCorners(drawn)) {
        const local = point.clone().sub(new Vector3(0, thickness / 2, 0)).applyMatrix4(rotate.clone().invert())
        expect(local.y).toBeCloseTo(thickness / 2 + .003 + .001, 9)
      }
      expect(area(drawn, display)).toBeCloseTo(caption.width * caption.height, 8)
      if (right > 90) {
        const old = caption.origin.clone().add(new Vector3(0, thickness + .004, 0))
        expect(display.surfaces[1].plane.distanceToPoint(old)).toBeLessThan(0)
      }
    }
  })

  it('表表紙の裏と最後の紙面も、それぞれの実際の紙面高へ固定する', () => {
    const ports = pagePorts(width, depth, Math.PI, 0)
    for (const [index, side, expectedY] of [[0, 'left-page', .005 + .003 + .001], [3, 'right-page', thickness + .003 + .001]] as const) {
      const face = evaluateBuiltin('flat', ports[side], { width: 2, height: 1, v: 3 }).faces[0]
      const display = displayAt(180, 0, index, 4, .005), drawn = paperDisplayFace(face, display)
      expect(faceCorners(drawn).every((point) => Math.abs(point.y - expectedY) < 1e-9)).toBe(true)
      expect(area(drawn, display)).toBeCloseTo(2, 9)
    }
  })

  it('全開時も左右を区別し、表紙と紙葉の高さを取り違えない', () => {
    const ports = pagePorts(width, depth, Math.PI, 0), display = displayAt(180, 0, 0, 4, .025)
    for (const [side, expectedY] of [['left-page', .025 + .003 + .001], ['right-page', thickness + .003 + .001]] as const) {
      const face = evaluateBuiltin('text', ports[side], { width: 2, height: .5, v: 4 }).faces[0]
      const drawn = paperDisplayFace(face, display)
      expect(faceCorners(drawn).every((point) => Math.abs(point.y - expectedY) < 1e-9)).toBe(true)
      expect(area(drawn, display)).toBeCloseTo(1, 9)
    }
  })

  it('閉じる側の箱・台・支持材の描画頂点が、実紙面の外へ貫通しない', () => {
    for (const right of [100, 125, 145, 160, 170, 177, 178.8]) {
      const ports = pagePorts(width, depth, Math.PI, right * Math.PI / 180), display = displayAt(180, right)
      for (const id of ['folding-box', 'platform', 'backdrop'] as const) {
        const result = evaluateBuiltin(id, ports.gutter, {}, id, 1), before = result.faces.map(faceCorners)
        let vertices = 0
        for (const face of result.faces) for (const point of drawnVertices(paperDisplayFace(face, display), display)) {
          vertices++
          for (const surface of display.surfaces) expect(surface.plane.distanceToPoint(point)).toBeGreaterThanOrEqual(-1e-7)
        }
        expect(vertices).toBeGreaterThan(0)
        expect(result.faces.map(faceCorners)).toEqual(before)
      }
    }
  })

  it('面を丸ごと消さずに覆われた部分だけを除き、紙端から外れる部分と材料UVを保つ', () => {
    const face = makeFace('crossing', new Vector3(1, -.5, -1), new Vector3(0, 1, 0), new Vector3(0, 0, 1), 1, 2)
    const display = displayAt(180, 0), data = paperMeshData(face, display.surfaces)
    expect(area(face, display)).toBeGreaterThan(0)
    expect(area(face, display)).toBeLessThan(area(face))
    for (let i = 0; i < data.uvs.length / 2; i++) {
      expect(data.positions[i * 3]).toBeCloseTo(data.uvs[i * 2] * face.width, 9)
      expect(data.positions[i * 3 + 1]).toBeCloseTo(data.uvs[i * 2 + 1] * face.height, 9)
    }
    const outside = { ...face, origin: face.origin.clone().setZ(depth / 2 + 1) }
    expect(area(outside, display)).toBeCloseTo(area(outside), 9)
  })

  it('順送り・逆送り・ランダムアクセスで同じ遮蔽形状を返す', () => {
    const scene = (angle: number) => {
      const display = displayAt(180, angle), pair = pagePorts(width, depth, Math.PI, angle * Math.PI / 180).gutter as FoldPair
      return evaluateBuiltin('folding-box', pair).faces.map((face) => paperMeshData(paperDisplayFace(face, display), display.surfaces))
    }
    const expected = scene(136)
    scene(30); scene(178); scene(0)
    expect(scene(136)).toEqual(expected)
  })
})
