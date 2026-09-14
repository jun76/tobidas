import { describe, expect, it } from 'vitest'
import { BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { updateContentGeometry } from './contentGeometry'

const triangle = (x = 0) => ({ positions: [x, 0, 0, x + 1, 0, 0, x, 1, 0], uvs: [0, 0, 1, 0, 0, 1] })

describe('動く絵柄の頂点バッファ', () => {
  it('繰り返し動かしても同じ領域を使い、新しい位置で選択できる', () => {
    const geometry = new BufferGeometry(), material = new MeshBasicMaterial({ side: DoubleSide })
    const mesh = new Mesh(geometry, material)
    updateContentGeometry(geometry, triangle())
    const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv')
    let disposals = 0
    geometry.addEventListener('dispose', () => disposals++)
    for (let i = 1; i <= 600; i++) updateContentGeometry(geometry, triangle(i / 100))
    expect(geometry.getAttribute('position')).toBe(position)
    expect(geometry.getAttribute('uv')).toBe(uv)
    expect(disposals).toBe(0)
    expect(new Raycaster(new Vector3(.2, .2, 1), new Vector3(0, 0, -1)).intersectObject(mesh)).toHaveLength(0)
    expect(new Raycaster(new Vector3(6.2, .2, 1), new Vector3(0, 0, -1)).intersectObject(mesh)).toHaveLength(1)
    geometry.dispose(); material.dispose()
  })

  it('頂点数の増減では、古い属性を保持したまま解放を通知する', () => {
    const geometry = new BufferGeometry(), one = triangle(), two = triangle(3)
    updateContentGeometry(geometry, one)
    const retired: unknown[][] = []
    geometry.addEventListener('dispose', () => retired.push([geometry.getAttribute('position'), geometry.getAttribute('uv')]))
    const first = [geometry.getAttribute('position'), geometry.getAttribute('uv')]
    updateContentGeometry(geometry, { positions: [...one.positions, ...two.positions], uvs: [...one.uvs, ...two.uvs] })
    const second = [geometry.getAttribute('position'), geometry.getAttribute('uv')]
    expect(retired[0]).toEqual(first)
    expect(second[0]).not.toBe(first[0])
    expect(geometry.getAttribute('position').count).toBe(6)
    updateContentGeometry(geometry, two)
    expect(retired[1]).toEqual(second)
    expect(geometry.getAttribute('position').count).toBe(3)
    expect(Array.from(geometry.getAttribute('uv').array)).toEqual(two.uvs)
    geometry.dispose()
  })

  it('全て隠れた後は古い三角形を残さず、再出現時に復元する', () => {
    const geometry = new BufferGeometry(), material = new MeshBasicMaterial({ side: DoubleSide })
    const mesh = new Mesh(geometry, material), ray = new Raycaster(new Vector3(.2, .2, 1), new Vector3(0, 0, -1))
    updateContentGeometry(geometry, triangle())
    updateContentGeometry(geometry, { positions: [], uvs: [] })
    expect(geometry.getAttribute('position').count).toBe(0)
    expect(ray.intersectObject(mesh)).toHaveLength(0)
    updateContentGeometry(geometry, triangle())
    expect(ray.intersectObject(mesh)).toHaveLength(1)
    geometry.dispose(); material.dispose()
  })
})
