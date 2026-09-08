import { describe, expect, it } from 'vitest'
import { evaluateBuiltin } from './builtins'
import { evaluatePartReference } from './evaluate'
import { backdropForBook } from './backdrop'
import { builtinPart } from './catalog'
import { faceContainsLine, faceCorners, openingAngle, pagePorts, pointOnFace, type FoldPair } from './geometry'
import { inspectClosedLayout, inspectPaper } from './validate'
import { planPartPlacement } from './placement'
import { createBookProject, createStageElement } from '../schema/bookDefaults'
import { evaluateBookParts, validateBookParts } from './book'
import type { PartElement } from '../schema/stageElement'
import { bookPaperDisplay, paperDisplayFace, paperMeshData } from './paperDisplay'

const reference = { builtin: 'backdrop', version: 2 }
const bookPair = (angle: number, rotation = 0) => pagePorts(8, 6.4, (angle + rotation) * Math.PI / 180, rotation * Math.PI / 180).gutter as FoldPair
describe('見開きの奥に立つ二枚の背景', () => {
  it('左右の下辺と中央の縦辺を接続し、全開で直立、全閉で重なる剛体面になる', () => {
    const parameters = backdropForBook(8, 6.4)
    for (const rotation of [0, 23, 91]) for (const angle of [0, .000001, .001, 1, 15, 45, 90, 150, 179.999999, 180]) {
      const input = bookPair(angle, rotation), result = evaluatePartReference(reference, input, {}, parameters)
      expect(result.faces).toHaveLength(2)
      expect(result.faces.every((face) => !face.support)).toBe(true)
      expect(inspectPaper({ ...result, contactSurfaces: [input.a, input.b] })).toEqual([])
      const [a, b] = result.faces
      expect([a.width + b.width, a.height, b.height]).toEqual([parameters.width, parameters.height, parameters.height])
      for (const [face, ground] of [[a, input.a], [b, input.b]]) expect(faceContainsLine(ground, pointOnFace(face, 0, 0), pointOnFace(face, face.width, 0))).toBe(true)
      expect(pointOnFace(a, 0, a.height).distanceTo(pointOnFace(b, b.width, b.height))).toBeLessThan(1e-7)
      for (const id of ['ground-backdrop', 'ground-backdrop-b']) {
        const pair = result.ports[id] as FoldPair
        if (angle === 180) expect(openingAngle(pair)).toBeCloseTo(90, 6)
        if (angle === 0) expect(openingAngle(pair)).toBeCloseTo(0, 5)
      }
      if (angle === 0) {
        expect(inspectClosedLayout(result, 8, 6.4, input.rayA)).toEqual([])
        for (const corner of faceCorners(a)) expect(Math.min(...faceCorners(b).map((other) => corner.distanceTo(other)))).toBeLessThan(1e-7)
      }
      if (angle === 180 && rotation === 0) {
        const points = result.faces.flatMap(faceCorners)
        expect(Math.min(...points.map((p) => p.x))).toBeLessThan(-6.5)
        expect(Math.max(...points.map((p) => p.x))).toBeGreaterThan(6.5)
        expect(Math.max(...points.map((p) => p.z))).toBeLessThan(-1)
        expect(a.v.y).toBeCloseTo(1, 8)
      }
    }
  })
  it('クリック順と位置によらず左右ページから大きな屏風を配置し、異なる判型でも収納する', () => {
    for (const aspect of [.7, 1.25, 4]) for (const reverse of [false, true]) {
      const project = createBookProject(), spread = project.book.spreads[0]
      project.book.format.pageAspect = aspect
      const depth = 8 / aspect
      const pick = (side: string, u: number, v: number) => ({ surface: { nodeId: '$book', portId: `${side}-page` }, point: [u, v] as [number, number] })
      const plan = planPartPlacement(project, spread.id, reference, pick(reverse ? 'left' : 'right', .01, 7.99), pick(reverse ? 'right' : 'left', depth - .01, .01))
      expect(plan.ok, JSON.stringify(plan)).toBe(true)
      if (!plan.ok) continue
      expect(plan.bridgeCount).toBe(0)
      expect(plan.instance.parameters).toEqual(backdropForBook(8, depth))
      spread.elements.push({ ...createStageElement('part'), id: 'screen', part: plan.instance } as PartElement)
      expect(validateBookParts(project)).toEqual([])
      const geometry = evaluateBookParts(project, spread, Math.PI, 0)
      expect(geometry.faces).toHaveLength(2)
    }
  })
  it('左右それぞれの地面と背景から縦置き部品を駆動する', () => {
    const parameters = backdropForBook(8, 6.4)
    for (const angle of [0, .001, 1, 30, 90, 150, 180]) {
      const screen = evaluatePartReference(reference, bookPair(angle), {}, parameters)
      for (const port of ['ground-backdrop', 'ground-backdrop-b']) {
        const input = screen.ports[port] as FoldPair
        const child = evaluateBuiltin('upright', input, { width: 2, height: 1.5, supportHeight: 1, distance: 1 })
        expect(inspectPaper({ ...child, faces: [...screen.faces, ...child.faces] })).toEqual([])
        if (angle === 0) expect(inspectClosedLayout(child, 8, 6.4)).toEqual([])
        if (angle === 180) expect(child.faces[0].v.y).toBeCloseTo(1)
      }
    }
  })
  it('キャンバスの実面を選ぶ経路でも、左右の背景へ縦置きを取り付ける', () => {
    const project = createBookProject(), spread = project.book.spreads[0]
    spread.elements.push({ ...createStageElement('part'), id: 'screen', part: { definition: reference,
      mount: { type: 'output', nodeId: '$book', portId: 'gutter' }, parameters: backdropForBook(8, 6.4), materials: {} } } as PartElement)
    for (const [page, panel] of [['right-page', 'panel'], ['left-page', 'panel-b']]) {
      const plan = planPartPlacement(project, spread.id, { builtin: 'upright', version: 1 },
        { surface: { nodeId: '$book', portId: page }, point: [3.2, 3] }, { surface: { nodeId: 'screen', portId: panel }, point: [3.5, 1] })
      expect(plan.ok, JSON.stringify(plan)).toBe(true)
      if (plan.ok) spread.elements.push({ ...createStageElement('part'), id: page, part: plan.instance } as PartElement)
    }
    expect(validateBookParts(project)).toEqual([])
  })
  it('保存済みの四節起立と新しい背景の改訂を混同しない', () => {
    expect(builtinPart('backdrop').version).toBe(2)
    const old = evaluatePartReference({ builtin: 'backdrop', version: 1 }, bookPair(180), {}, { width: 2, height: 1.5, distance: 1 })
    expect(old.faces.filter((face) => face.support)).toHaveLength(1)
    expect(old.faces[0].u.z).toBe(1)
  })
  it('屏風の開き角を変えても剛体を保ち、90度の入力を全開へ換算しない', () => {
    for (const splayAngle of [20, 90, 150, 170]) {
      const p = { width: 4, height: 2, offset: 0, splayAngle }
      const first = evaluatePartReference(reference, bookPair(90), {}, p)
      for (const angle of [0, .001, 30, 90, 150, 180]) {
        const result = evaluatePartReference(reference, bookPair(angle), {}, p)
        expect(inspectPaper(result)).toEqual([])
        for (const face of result.faces) expect([face.width, face.height]).toEqual([2, 2])
      }
      expect(openingAngle(first.ports['ground-backdrop'] as FoldPair)).toBeLessThan(45)
      expect(evaluatePartReference(reference, bookPair(90), {}, p).faces.map(faceCorners)).toEqual(first.faces.map(faceCorners))
    }
  })
  it('背景全体の絵は中央で連続し、面ごとの絵はその面へ収める', () => {
    const screen = evaluatePartReference(reference, bookPair(180), {}, backdropForBook(8, 6.4), { '*': { image: 'panorama' } })
    for (const face of screen.faces) {
      const us = paperMeshData(face).uvs.filter((_, i) => i % 2 === 0)
      expect([Math.min(...us), Math.max(...us)]).toEqual(face.artworkSpan)
      expect(face.material.image).toBe('panorama')
    }
    const separate = evaluatePartReference(reference, bookPair(180), {}, backdropForBook(8, 6.4), { panel: { image: 'right' }, 'panel-b': { image: 'left' } })
    expect(separate.faces.every((face) => face.artworkSpan === undefined)).toBe(true)
  })
  it('閉じ側の背景を実紙面で遮り、開閉の両向きで貫通させない', () => {
    for (const closing of [false, true]) for (const angle of [1, 3, 5, 15, 45, 90, 150, 180]) {
      const left = closing ? Math.PI : angle * Math.PI / 180, right = closing ? Math.PI - angle * Math.PI / 180 : 0
      const display = bookPaperDisplay({ width: 8, depth: 6.4, thickness: .015, index: 1, count: 4, leftAngle: left, rightAngle: right, frontCoverY: .015 })
      const screen = evaluatePartReference(reference, pagePorts(8, 6.4, left, right).gutter, {}, backdropForBook(8, 6.4))
      let vertices = 0
      for (const raw of screen.faces) {
        const face = paperDisplayFace(raw, display), data = paperMeshData(face, display.surfaces)
        vertices += data.positions.length / 3
        for (let i = 0; i < data.positions.length; i += 3) {
          const point = pointOnFace(face, data.positions[i], data.positions[i + 1])
          for (const surface of display.surfaces) expect(surface.plane.distanceToPoint(point)).toBeGreaterThanOrEqual(-1e-7)
        }
      }
      // 閉じ切る直前に紙厚で覆われる部分以外は、途中角で面が失われない。
      if (angle >= 5) expect(vertices).toBeGreaterThan(0)
    }
  })
})
