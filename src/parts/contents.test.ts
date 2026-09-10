import { describe, expect, it } from 'vitest'
import { Box3, Matrix4, Vector3 } from 'three'
import { connectedContentSchema } from '../schema/content'
import { createBookProject, createStageElement } from '../schema/bookDefaults'
import { bookProjectSchema } from '../schema/bookPackage'
import { projectFileJson } from '../package/serialize'
import { compileSpreadStow } from '../runtime/stow/assign'
import { bindBookContents, contentAsStage, contentExitScale, evaluateContents } from './contents'
import { contentMeshData } from './contentDisplay'
import { evaluatePartGraph, evaluatePartReference } from './evaluate'
import { evaluateBookParts, validateBookParts } from './book'
import { faceContains, faceContainsLine, makeFace, pagePorts, pointOnFace, type BoundPaperContent } from './geometry'
import { inspectShape, shapeTriangles, type PaperShape } from './shape'
import { capturePaperDesign, comparePaperDesign } from './materialDesign'
import { paperMeshData } from './paperDisplay'
import { newPartDefinition, type PartNode } from './schema'
import { importPartFiles, partBundleFiles, snapshotPartBundle } from './package'
import { inspectContentBindings, inspectContentIntersections } from './contentValidation'
import { contentMotionEnvelopes } from './contentEnvelope'
import { contentTriangles } from './contentDisplay'
import { ClockStore } from '../runtime/clock'

const windowShape: PaperShape = { outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [[[.25, .25], [.75, .25], [.75, .75], [.25, .75]]] }
const paper = () => ({ ...makeFace('paper', new Vector3(), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 4, 4), shape: structuredClone(windowShape) })
const content = (id = 'rotor') => connectedContentSchema.parse({ ...createStageElement('visual'), id, name: id, width: 2, height: 2,
  attachment: { type: 'surface', surface: { nodeId: '$book', portId: 'right-page' }, point: [.5, .5], side: 'front' },
  presentation: { kind: 'fiction', closing: 'shrink-to-anchor' }, baseTransform: { position: [0, 0, .02], rotation: [0, 0, 0], scale: [1, 1, 1] } })
const binding = (id = 'rotor'): BoundPaperContent => ({ id, ownerId: id, element: content(id), tracks: [], face: paper(), unitScale: 1 })
const context = (angle = 180, time = 0) => ({ openingAngleDeg: angle, maxOpeningAngleDeg: 180, holdTime: 0, clock: () => time })

describe('paper shape and attached content', () => {
  it('周期運動の包絡に紙全体が入る場合も干渉として検出する', () => {
    const bound = binding(); bound.element.baseTransform.position = [0, 0, 0]
    bound.element.motion = [{ type: 'drift', amplitude: [2, 2, 2], period: 3, phase: 0 }]
    const solid = makeFace('inside', new Vector3(0, 0, .5), new Vector3(1, 0, 0), new Vector3(0, 1, 0), .2, .2)
    expect(inspectContentIntersections(evaluateContents([bound], context()), [solid], true)).toEqual(['Content crosses paper: rotor / inside'])
  })
  it('独立な周期と粒子の全振幅を包絡し、実測位相の頂点を取りこぼさない', () => {
    const bound = binding(); bound.element.motion = [{ type: 'drift', amplitude: [.2, .1, 0], period: 3.7, phase: .5 }, { type: 'sway', amplitude: 12, period: 5.3, phase: 1 }]
    if (bound.element.type === 'visual') bound.element.particles.enabled = true
    const envelope = contentMotionEnvelopes(evaluateContents([bound], context()))[0]
    const bounds = new Box3().setFromPoints(envelope.triangles.flatMap((t) => t.map((v) => v.point))).expandByScalar(1e-7)
    for (let time = 0; time < 120; time += .71) {
      const evaluated = evaluateContents([bound], context(180, time))[0]
      expect(contentTriangles(evaluated).flat().every((v) => bounds.containsPoint(v.point))).toBe(true)
      expect(contentTriangles(evaluated, true).flat().every((v) => bounds.containsPoint(v.point))).toBe(true)
    }
  })
  it('固定時計の再評価は順序に依存せず、通常の表示経過時間を破壊しない', () => {
    const clock = new ClockStore(); clock.advance('book/spread/part/content', 3); clock.advanceStory(4)
    clock.sampleTime = 9; clock.advance('book/spread/part/content', 100); clock.advanceStory(100)
    expect(clock.peek('book/spread/part/content')).toBe(9); expect(clock.storyTime).toBe(9)
    clock.sampleTime = undefined
    expect(clock.peek('book/spread/part/content')).toBe(3); expect(clock.storyTime).toBe(4)
  })
  it('uses the same real hole for glue, triangulation, decals and material invariants', () => {
    const face = paper()
    expect(inspectShape(windowShape)).toEqual([])
    expect(faceContains(face, new Vector3(2, 2, 0))).toBe(false)
    expect(faceContainsLine(face, new Vector3(.5, 2, 0), new Vector3(3.5, 2, 0))).toBe(false)
    const triangles = shapeTriangles(windowShape)
    const area = triangles.reduce((sum, [a, b, c]) => sum + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2, 0)
    expect(area).toBeCloseTo(.75)
    expect(paperMeshData(face).positions.length).toBe(triangles.length * 9)
    const bound = binding(); bound.element.presentation = { kind: 'decal' }; bound.element.baseTransform.position = [0, 0, 0]
    if (bound.element.type === 'visual') { bound.element.width = bound.element.height = 4; bound.element.pivot = [0, 0] }
    bound.element.attachment = { type: 'surface', surface: { nodeId: '$book', portId: 'right-page' }, point: [0, 0], side: 'front' }
    const data = contentMeshData(evaluateContents([bound], context())[0])
    for (let i = 0; i < data.positions.length; i += 9) {
      const center = new Vector3()
      for (let j = 0; j < 3; j++) center.add(new Vector3().fromArray(data.positions, i + j * 3))
      center.multiplyScalar(1 / 3); center.z = 0
      expect(faceContains(face, center)).toBe(true)
    }
    const result = { faces: [face], ports: {}, connections: [] }, before = capturePaperDesign(result)
    face.shape.holes[0][0][0] = .2
    expect(comparePaperDesign(before, capturePaperDesign(result))).toContain('Paper material changes during folding: paper')
    face.shape = structuredClone(windowShape); face.shape.holes[0][0][0] = .25
  })
  it('rejects self intersections, overlapping holes and attachment inside an opening', () => {
    expect(inspectShape({ outer: [[0, 0], [1, 1], [0, 1], [1, 0]], holes: [] }).length).toBeGreaterThan(0)
    expect(inspectShape({ ...windowShape, holes: [windowShape.holes[0], windowShape.holes[0]] }).length).toBeGreaterThan(0)
    const bound = binding(); if (bound.element.attachment.type === 'surface') bound.element.attachment.point = [2, 2]
    expect(() => evaluateContents([bound], context())).toThrow('outside material')
  })
  it('shrinks an entire fiction tree once and never scales accumulated spin angles', () => {
    const root = binding(), child = binding('child'); root.element.motion = [{ type: 'spin', axis: 'z', speed: .9 }]
    child.face = undefined; child.parentId = root.id; child.element.attachment = { type: 'visual', elementId: root.id }
    const open = evaluateContents([root, child], context(180, 10000)), half = evaluateContents([root, child], context(90, 10000))
    for (let i = 0; i < 2; i++) {
      expect(new Vector3().setFromMatrixScale(half[i].matrix).x / new Vector3().setFromMatrixScale(open[i].matrix).x).toBeCloseTo(.5)
      const direction = (m: Matrix4) => new Vector3(1, 0, 0).transformDirection(m)
      expect(direction(half[i].matrix).distanceTo(direction(open[i].matrix))).toBeLessThan(1e-9)
    }
    expect(evaluateContents([root, child], context(0))[0].visible).toBe(false)
    expect(contentExitScale(90, 180)).toBe(.5)
    expect(evaluateContents([root, child], context(90, 10000))[1].matrix.toArray()).toEqual(half[1].matrix.toArray())
  })
  it('preserves nested material, anchor and motion distances through a package round trip', async () => {
    const inner = newPartDefinition('windmill', { kind: 'surface' })
    inner.nodes = [{ id: 'paper', name: 'paper', definition: { builtin: 'flat', version: 1 }, mount: { type: 'input' }, parameters: { width: 2, height: 2, v: 2 }, materials: {} }]
    const rotor = content(); rotor.attachment = { type: 'surface', surface: { nodeId: 'paper', portId: 'face' }, point: [1, 1], side: 'front' }
    rotor.motion = [{ type: 'spin', axis: 'z', speed: .9 }]; inner.contents = [{ element: rotor, tracks: [] }]
    const a = await snapshotPartBundle({ definition: inner, definitions: {}, assets: [] })
    const outer = newPartDefinition('nested', inner.input)
    outer.nodes = [{ id: 'inner', name: 'inner', definition: { custom: a.hash }, mount: { type: 'input' }, parameters: {}, materials: {}, uniformScale: .5 }]
    const middle = await snapshotPartBundle({ definition: outer, definitions: { [a.hash]: a.definition }, assets: [] })
    const top = newPartDefinition('double-nested', inner.input)
    top.nodes = [{ id: 'middle', name: 'middle', definition: { custom: middle.hash }, mount: { type: 'input' }, parameters: {}, materials: {}, uniformScale: 2 }]
    const saved = await snapshotPartBundle({ definition: top, definitions: { ...middle.definitions, [middle.hash]: middle.definition },
      assets: [{ id: 'unused-audio', type: 'audio', name: '作品の音楽', mime: 'audio/mpeg', data: 'data:audio/mpeg;base64,AA==' }] })
    expect(saved.assets).toEqual([])
    const restored = await importPartFiles(await partBundleFiles(saved))
    const input = pagePorts(8, 8, Math.PI, 0)['right-page']
    const definitions = { ...restored.definitions, outer: restored.definition }
    const result = evaluatePartReference({ custom: 'outer' }, input, definitions, {}, {}, 'placed', [], 1)
    expect(result.contents?.[0].unitScale).toBe(1)
    const evaluated = evaluateContents(result.contents!, context(180, 7))[0]
    expect(new Vector3().setFromMatrixScale(evaluated.matrix).x).toBeCloseTo(1)
    expect(new Vector3().setFromMatrixPosition(evaluated.anchor).distanceTo(pointOnFace(result.contents![0].face!, 1, 1))).toBeLessThan(1e-9)
  })
  it('assigns valid page-attached visuals a renderer and leaves no legacy stow roots after serialization', () => {
    const project = createBookProject(), spread = project.book.spreads[0]
    const element = content(); spread.elements = [contentAsStage(element)]
    const restored = { ...bookProjectSchema.parse({ ...JSON.parse(projectFileJson(project)), assets: [] }), assets: [] }
    expect(JSON.parse(projectFileJson(project)).book.spreads[0].elements[0].parent).toBeUndefined()
    expect(validateBookParts(restored)).toEqual([])
    const evaluated = evaluateBookParts(restored, restored.book.spreads[0], Math.PI, 0)
    expect(evaluateContents(bindBookContents(restored, restored.book.spreads[0], evaluated, Math.PI, 0), context()).map((item) => item.id)).toEqual(['rotor'])
    expect(JSON.stringify(compileSpreadStow(restored.book, restored.book.spreads[0]))).not.toContain('rotor')
  })
  it('keeps fiction transforms out of material validation and diagnoses crossing a real solid region', () => {
    const bound = binding(); bound.element.baseTransform.position = [0, 0, 0]; bound.element.baseTransform.rotation = [90, 0, 0]; bound.element.pivot = [.5, .5]
    const item = evaluateContents([bound], context())[0]
    expect(inspectContentIntersections([item], [paper()]).length).toBeGreaterThan(0)
    bound.element.presentation = { kind: 'decal' }
    bound.tracks = [{ id: 'move', target: { type: 'element', elementId: 'rotor' }, property: 'position.x', keys: [{ id: 'a', time: 0, value: 1, ease: 'linear' }] }]
    expect(inspectContentBindings([bound]).length).toBeGreaterThan(0)
  })
})
