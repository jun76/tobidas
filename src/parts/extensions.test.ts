import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { extendPaperSurface } from './extensions'
import { faceContains, faceContainsLine, makeFace, pointOnFace, type PaperEvaluation } from './geometry'

describe('取り付け時の支持紙', () => {
  const parent = () => makeFace('parent', new Vector3(), new Vector3(1, 0, 0), new Vector3(0, 1, 0), 2, 2)
  it('細い支持紙だけを実面とし、仮想の矩形に残る空白へ接着させない', () => {
    const source = parent(), result: PaperEvaluation = { faces: [], connections: [], ports: {} }
    const face = extendPaperSurface(source, { min: [0, 0], max: [4, 2], panels: [{ min: [2, .9], max: [4, 1.1] }] }, 'mount', result)
    expect(result.faces).toHaveLength(1); expect(result.connections[0].parentFace).toBe('parent')
    expect(faceContainsLine(face, pointOnFace(source, 1, 1), pointOnFace(source, 4, 1))).toBe(true)
    expect(faceContains(face, pointOnFace(source, 3, 1.5))).toBe(false)
    expect(() => extendPaperSurface(source, { min: [0, 0], max: [4, 2], panels: [{ min: [3, .9], max: [4, 1.1] }] }, 'floating')).toThrow()
  })
  it('切り抜きの残る辺は延長でき、仮想接続面の中でも輪郭の欠けを見落とさない', () => {
    const source = parent()
    source.outline = [[0, 0], [1, 0], [1, 1], [.3, 1], [.3, .2], [.2, .2], [.2, 1], [0, 1]]
    const face = extendPaperSurface(source, { min: [0, 0], max: [3, 2], panels: [{ min: [2, .9], max: [3, 1.1] }] }, 'mount')
    expect(faceContainsLine(face, pointOnFace(source, 1, 1), pointOnFace(source, 3, 1))).toBe(true)
    expect(faceContainsLine(face, pointOnFace(source, 0, 1), pointOnFace(source, 3, 1))).toBe(false)
    expect(() => extendPaperSurface(source, { min: [0, 0], max: [2, 3], panels: [{ min: [0, 2], max: [2, 3] }] }, 'cut')).toThrow('cut-out')
  })
})
