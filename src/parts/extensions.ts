import { faceContainsLine, makeFace, pointOnFace, stackOnSurface, type PaperEvaluation, type PaperFace } from './geometry'
import type { PartExtension } from './schema'

/** 親面を動かさず、足りない材料座標の範囲を同一平面の支持紙で延長する。 */
export function extendPaperSurface(parent: PaperFace, bounds: PartExtension | undefined, id: string, result?: PaperEvaluation): PaperFace {
  if (!bounds) return parent
  const [minU, minV] = bounds.min, [maxU, maxV] = bounds.max
  if (minU > 0 || minV > 0 || maxU < parent.width || maxV < parent.height
    || maxU - minU > 160 || maxV - minV > 160) throw new Error('Invalid support extension bounds')
  const surface = makeFace(id, pointOnFace(parent, minU, minV), parent.u, parent.v, maxU - minU, maxV - minV, true)
  surface.surfaceStack = stackOnSurface(parent, id)
  const regions = [parent]
  const strip = (name: string, u: number, v: number, width: number, height: number, seam: [[number, number], [number, number]]) => {
    if (width < 1e-7 || height < 1e-7) return
    const face = makeFace(`${id}/${name}`, pointOnFace(parent, u, v), parent.u, parent.v, width, height, true)
    face.surfaceStack = surface.surfaceStack
    const edge = seam.map(([x, y]) => pointOnFace(parent, x, y))
    if (!faceContainsLine(parent, edge[0], edge[1]) || !faceContainsLine(face, edge[0], edge[1])) throw new Error('A cut-out face has no intact support attachment edge')
    regions.push(face)
    result?.faces.push(face)
    result?.connections.push({ parentFace: parent.id, childFace: face.id, actual: edge, expected: edge.map((point) => point.clone()) })
  }
  if (bounds.panels) {
    bounds.panels.forEach((panel, index) => {
      const [u, v] = panel.min, [endU, endV] = panel.max
      if (u < minU - 1e-7 || v < minV - 1e-7 || endU > maxU + 1e-7 || endV > maxV + 1e-7 || endU <= u || endV <= v) throw new Error('Invalid support panel bounds')
      const a = Math.max(0, u), b = Math.min(parent.width, endU), c = Math.max(0, v), d = Math.min(parent.height, endV)
      let seam: [[number, number], [number, number]]
      if (endU <= 1e-7 && d > c) seam = [[0, c], [0, d]]
      else if (u >= parent.width - 1e-7 && d > c) seam = [[parent.width, c], [parent.width, d]]
      else if (endV <= 1e-7 && b > a) seam = [[a, 0], [b, 0]]
      else if (v >= parent.height - 1e-7 && b > a) seam = [[a, parent.height], [b, parent.height]]
      else throw new Error('Support panel must share an edge with its actual parent')
      strip(`bridge-${index}`, u, v, endU - u, endV - v, seam)
    })
  } else {
    strip('left', minU, minV, -minU, maxV - minV, [[0, 0], [0, parent.height]])
    strip('right', parent.width, minV, maxU - parent.width, maxV - minV, [[parent.width, 0], [parent.width, parent.height]])
    strip('near', 0, minV, parent.width, -minV, [[0, 0], [parent.width, 0]])
    strip('far', 0, parent.height, parent.width, maxV - parent.height, [[0, parent.height], [parent.width, parent.height]])
  }
  surface.contactRegions = regions
  if (result) result.contactSurfaces = [...result.contactSurfaces ?? [], parent, surface]
  return surface
}
