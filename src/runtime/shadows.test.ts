import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createBook, createSpread } from '../schema/bookDefaults'
import { bookShadowSettings } from './shadows'

describe('本全体の影', () => {
  it.each([[8, 1.25], [16, 1.25], [4, .5], [12, 2]])(
    '片面幅%d、縦横比%dでも土台とめくる紙を影カメラで切らない', (width, aspect) => {
      const book = createBook()
      book.format.pageWidth = width
      book.format.pageAspect = aspect
      book.spreads = Array.from({ length: 5 }, () => createSpread())
      const depth = width / aspect
      for (const position of [[-4, 10, 6], [4, 10, -6], [0, 15, 0], [1, .5, 0]] as [number, number, number][]) {
        const settings = bookShadowSettings(book, position)
        const light = new THREE.DirectionalLight()
        light.position.set(...settings.position)
        Object.assign(light.shadow.camera, {
          left: -settings.radius, right: settings.radius, top: settings.radius, bottom: -settings.radius,
          near: settings.near, far: settings.far,
        })
        light.shadow.camera.updateProjectionMatrix()
        light.updateMatrixWorld()
        light.target.updateMatrixWorld()
        light.shadow.updateMatrices(light)
        const inside = (x: number, y: number, z: number) => {
          const ndc = new THREE.Vector3(x, y, z).project(light.shadow.camera)
          for (const coordinate of ndc.toArray()) expect(Math.abs(coordinate)).toBeLessThan(1)
        }
        // 表紙の開閉中は本と受け皿が片面の半分だけ左右へ移動する。
        for (const rigX of [-width / 2, 0, width / 2]) {
          for (const signX of [-1, 1]) for (const signZ of [-1, 1]) {
            inside(rigX + signX * width, -.27, signZ * depth / 2)
            inside(rigX + signX * width * 1.25, -.31, .6 + signZ * depth * .9)
            for (let step = 0; step <= 12; step++) {
              const angle = step * Math.PI / 12
              inside(rigX + width * Math.cos(angle), width * Math.sin(angle) + book.format.coverThickness,
                signZ * depth / 2)
            }
          }
        }
      }
    },
  )

  it('影カメラを後退させても作者が指定した光の方向を変えない', () => {
    const book = createBook()
    const position: [number, number, number] = [-4, 10, 6]
    for (const width of [4, 8, 32]) {
      book.format.pageWidth = width
      const settings = bookShadowSettings(book, position)
      const actual = new THREE.Vector3(...settings.position).normalize()
      const expected = new THREE.Vector3(...position).normalize()
      expect(actual.distanceTo(expected)).toBeLessThan(1e-12)
    }
  })
})
