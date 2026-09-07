import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { evaluateBuiltin } from './builtins'
import { faceCorners, makeFace, pagePorts, type FoldPair, type PaperFace } from './geometry'
import { bookPaperDisplay, paperDisplayFace, paperMeshData, type BookPaperDisplay } from './paperDisplay'

const width = 8, depth = 6.4, thickness = .015
const displayAt = (left: number, right: number, index = 1, count = 4, frontCoverY = thickness) => bookPaperDisplay({
  width, depth, thickness, index, count, frontCoverY, leftAngle: left * Math.PI / 180, rightAngle: right * Math.PI / 180,
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
        const result = evaluateBuiltin(id, ports.gutter), before = result.faces.map(faceCorners)
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
