import { Vector3 } from 'three'
import type { PartInput, PartMaterial } from './schema'

export interface PaperFace {
  id: string; origin: Vector3; u: Vector3; v: Vector3; width: number; height: number
  support: boolean; material: PartMaterial; outline?: [number, number][]
}
export interface FoldPair {
  kind: 'fold-pair'; a: PaperFace; b: PaperFace; origin: Vector3; axis: Vector3
  rayA: Vector3; rayB: Vector3; extentA: number; extentB: number; width: number; foldSign: 1 | -1
}
export type PartPort = { kind: 'surface'; face: PaperFace } | FoldPair
export interface PaperConnection {
  actual: Vector3[]; expected: Vector3[]; parentFace: string; childFace: string
}
export interface PaperEvaluation {
  faces: PaperFace[]; ports: Record<string, PartPort>; connections: PaperConnection[]
}
export const EPSILON = 1e-7
export const pointOnFace = (face: PaperFace, u: number, v: number) => face.origin.clone().addScaledVector(face.u, u).addScaledVector(face.v, v)
export function openingAngle(pair: FoldPair): number {
  return Math.acos(Math.max(-1, Math.min(1, pair.rayA.dot(pair.rayB)))) * 180 / Math.PI
}
export function checkInput(input: PartInput, port: PartPort): void {
  if (input.kind !== port.kind) throw new Error(`Expected ${input.kind}, got ${port.kind}`)
  if (input.kind === 'fold-pair' && port.kind === 'fold-pair' && openingAngle(port) > input.maxOpeningAngleDeg + 1e-6) {
    throw new Error(`Opening angle ${openingAngle(port).toFixed(2)} exceeds ${input.maxOpeningAngleDeg}`)
  }
}
export function faceCorners(face: PaperFace): Vector3[] {
  return [[0, 0], [face.width, 0], [face.width, face.height], [0, face.height]].map(([u, v]) => pointOnFace(face, u, v))
}
export function faceContains(face: PaperFace, point: Vector3, epsilon = EPSILON): boolean {
  const delta = point.clone().sub(face.origin), u = delta.dot(face.u), v = delta.dot(face.v)
  return Math.abs(delta.dot(face.u.clone().cross(face.v))) <= epsilon
    && u >= -epsilon && u <= face.width + epsilon && v >= -epsilon && v <= face.height + epsilon
}
export function makeFace(id: string, origin: Vector3, u: Vector3, v: Vector3, width: number, height: number, support = false): PaperFace {
  if (Math.abs(u.dot(v)) > 1e-6 || Math.abs(u.length() - 1) > 1e-6 || Math.abs(v.length() - 1) > 1e-6) throw new Error(`Non-rigid face: ${id}`)
  return { id, origin, u, v, width, height, support, material: { color: support ? '#d8c8a7' : '#e3b476' } }
}

/** 実見開きと検証台の両方が使う二面。左と右の実角度をそのまま渡す。 */
export function pagePorts(width: number, depth: number, leftAngle: number, rightAngle: number): Record<string, PartPort> {
  const axis = new Vector3(0, 0, 1), origin = new Vector3(0, 0, -depth / 2)
  const right = new Vector3(Math.cos(rightAngle), Math.sin(rightAngle), 0)
  const left = new Vector3(Math.cos(leftAngle), Math.sin(leftAngle), 0)
  const a = makeFace('$book/right', origin, axis, right, depth, width)
  const b = makeFace('$book/left', origin, axis, left, depth, width)
  return { 'right-page': { kind: 'surface', face: a }, 'left-page': { kind: 'surface', face: b },
    gutter: { kind: 'fold-pair', a, b, origin: new Vector3(), axis, rayA: right, rayB: left, extentA: width, extentB: width, width: depth, foldSign: 1 } }
}
