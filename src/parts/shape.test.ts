import { describe, expect, it } from 'vitest'
import { inspectShape, type Point2 } from './shape'

describe('細い柄と接着帯の輪郭', () => {
  it('近接する凹部を自己交差と判定しない', () => {
    const outer: Point2[] = [[0, 0], [1, 0], [1, .022], [.1, .022], [.15, .1], [0, .025], [.003, .022], [0, .022]]
    expect(inspectShape({ outer, holes: [] })).toEqual([])
  })

  it('小さくても実際に交差する輪郭は拒否する', () => {
    const outer: Point2[] = [[0, 0], [.01, .008], [0, .01], [.01, 0]]
    expect(inspectShape({ outer, holes: [] })).toContain('Paper outline intersects itself')
  })

  it('接着帯に重なる切り抜きは拒否する', () => {
    expect(inspectShape({ outer: [[0, 0], [1, 0], [1, 1], [0, 1]],
      holes: [[[.1, 0], [.2, 0], [.2, .01], [.1, .01]]] })).toContain('Paper shape boundaries intersect')
  })
})
