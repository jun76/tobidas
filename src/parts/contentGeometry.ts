import { BufferGeometry, DynamicDrawUsage, Float32BufferAttribute } from 'three'

/** 頂点数が変わらない間はGPU領域を使い回し、切り抜きで数が変わるときだけ交換する。 */
export function updateContentGeometry(geometry: BufferGeometry, data: { positions: number[]; uvs: number[] }) {
  const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv')
  if (!(position instanceof Float32BufferAttribute) || !(uv instanceof Float32BufferAttribute)
    || position.array.length !== data.positions.length || uv.array.length !== data.uvs.length) {
    // Threeはdispose時点の属性だけを解放する。属性を外す前に古いGPUバッファを解放する。
    if (position || uv) geometry.dispose()
    geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3).setUsage(DynamicDrawUsage))
    geometry.setAttribute('uv', new Float32BufferAttribute(data.uvs, 2).setUsage(DynamicDrawUsage))
  } else {
    position.set(data.positions); position.needsUpdate = true
    uv.set(data.uvs); uv.needsUpdate = true
  }
  geometry.computeBoundingSphere()
}
