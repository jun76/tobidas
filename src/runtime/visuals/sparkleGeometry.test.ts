import { describe, expect, it } from 'vitest'
import { buildSparkleField, SPARKLE } from './sparkleField'
import { buildSparkleSpriteGeometry } from './sparkleGeometry'

describe('sparkle sprite geometry', () => {
  it('各粒を透明平面内の四角形へ展開する', () => {
    const geometry = buildSparkleSpriteGeometry(buildSparkleField('depth-regression', 2))
    expect(geometry.getAttribute('position').count).toBe(SPARKLE.count * 4)
    expect(geometry.getAttribute('corner').count).toBe(SPARKLE.count * 4)
    expect(geometry.getIndex()?.count).toBe(SPARKLE.count * 6)

    const positions = geometry.getAttribute('position')
    for (let particle = 0; particle < SPARKLE.count; particle++) {
      const base = particle * 4
      for (let vertex = 1; vertex < 4; vertex++) {
        expect(positions.getX(base + vertex)).toBe(positions.getX(base))
        expect(positions.getY(base + vertex)).toBe(positions.getY(base))
        expect(positions.getZ(base + vertex)).toBe(0)
      }
    }
    geometry.dispose()
  })
})
