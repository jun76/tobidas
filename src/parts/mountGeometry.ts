import { Vector3 } from 'three'
import { type PaperFace } from './geometry'
import { type PartExtension } from './schema'

export const materialPoint = (face: PaperFace, point: Vector3): [number, number] => {
  const delta = point.clone().sub(face.origin)
  return [delta.dot(face.u), delta.dot(face.v)]
}
export function extensionFor(face: PaperFace, points: [number, number][], { hinge = [], margin = .04, footprint }: {
  hinge?: [number, number][]; margin?: number; footprint?: [number, number][]
} = {}): PartExtension | undefined {
  const bounds = { min: [0, 0], max: [face.width, face.height] } as PartExtension
  const panels: NonNullable<PartExtension['panels']> = []
  if (points.length) {
    const u = Math.min(...points.map((p) => p[0])) - margin, v = Math.min(...points.map((p) => p[1])) - margin
    const endU = Math.max(...points.map((p) => p[0])) + margin, endV = Math.max(...points.map((p) => p[1])) + margin
    const lowV = Math.min(v, face.height - .08), highV = Math.max(endV, .08)
    const lowU = Math.max(0, Math.min(u, face.width - .08)), highU = Math.min(face.width, Math.max(endU, .08))
    if (points.some((p) => p[0] < -1e-7)) panels.push({ id: 'left', min: [u, lowV], max: [0, highV] })
    if (points.some((p) => p[0] > face.width + 1e-7)) panels.push({ id: 'right', min: [face.width, lowV], max: [endU, highV] })
    if (points.some((p) => p[1] < -1e-7)) panels.push({ id: 'near', min: [lowU, v], max: [highU, 0] })
    if (points.some((p) => p[1] > face.height + 1e-7)) panels.push({ id: 'far', min: [lowU, face.height], max: [highU, endV] })
  }
  if (footprint && margin === 0) for (const panel of panels) {
    const axis = panel.id === 'left' || panel.id === 'right' ? 0 : 1
    const edge = panel.id === 'left' || panel.id === 'near' ? 0 : axis === 0 ? face.width : face.height
    let polygon = footprint
    // 角をまたぐ場合も各支持紙の矩形内へ切り分け、輪郭を重複させない。
    for (const component of [0, 1] as const) for (const direction of [1, -1]) {
      const boundary = direction === 1 ? panel.min[component] : panel.max[component], clipped: [number, number][] = []
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length]
        const da = (a[component] - boundary) * direction, db = (b[component] - boundary) * direction
        if (da >= -1e-7) clipped.push(a)
        if (da * db < 0) { const t = da / (da - db); clipped.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]) }
      }
      polygon = clipped
    }
    // 親の辺まで届く輪郭はその形の支持紙とする。離れた配置には実際の橋渡しが必要になる。
    if (polygon.length >= 3 && polygon.filter((p) => Math.abs(p[axis] - edge) < 1e-7).length >= 2) {
      panel.outline = polygon.map(([u, v]) => [(u - panel.min[0]) / (panel.max[0] - panel.min[0]), (v - panel.min[1]) / (panel.max[1] - panel.min[1])])
    }
  }
  for (const point of [...points, ...hinge, ...panels.flatMap((panel) => [panel.min, panel.max])]) for (const axis of [0, 1] as const) {
    if (point[axis] < bounds.min[axis] - 1e-7) bounds.min[axis] = point[axis]
    if (point[axis] > bounds.max[axis] + 1e-7) bounds.max[axis] = point[axis]
  }
  return bounds.min[0] < 0 || bounds.min[1] < 0 || bounds.max[0] > face.width || bounds.max[1] > face.height ? { ...bounds, panels } : undefined
}
