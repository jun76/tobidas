import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { makeFace } from './geometry'
import { facesCross } from './intersections'
import { coplanarOverlapArea } from './overlap'

const panel = (id: string, x = 0, y = 0, z = 0, w = 2, h = 2) => makeFace(id,
  new Vector3(x, y, z), new Vector3(1, 0, 0), new Vector3(0, 1, 0), w, h)
describe('coplanarOverlapArea', () => {
  it('finds complete and partial overlays missed by the crossing test', () => {
    expect(facesCross(panel('a'), panel('b'))).toBe(false)
    expect(coplanarOverlapArea(panel('a'), panel('b'))).toBeCloseTo(4)
    expect(coplanarOverlapArea(panel('a'), panel('b', 1, 1))).toBeCloseTo(1)
  })
  it('excludes a window opening and contact along an edge', () => {
    const frame = panel('frame')
    frame.shape = { outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: [[[.25, .25], [.75, .25], [.75, .75], [.25, .75]]] }
    expect(coplanarOverlapArea(frame, panel('in-hole', .5, .5, 0, 1, 1))).toBeCloseTo(0)
    expect(coplanarOverlapArea(frame, panel('all'))).toBeCloseTo(3)
    expect(coplanarOverlapArea(panel('a'), panel('adjacent', 2))).toBe(0)
  })
  it('requires near coplanarity and handles reversed surface axes', () => {
    expect(coplanarOverlapArea(panel('a'), panel('behind', 0, 0, -.01))).toBe(0)
    expect(coplanarOverlapArea(panel('a'), panel('close', 0, 0, .00001))).toBeCloseTo(4)
    const back = makeFace('back', new Vector3(2, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 1, 0), 2, 2)
    expect(coplanarOverlapArea(panel('a'), back)).toBeCloseTo(4)
  })
})
