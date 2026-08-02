import type { StageElement } from '../../schema/stageElement'

export function constrainSinglePageBackground(element: StageElement, pageWidth: number): void {
  if (element.sourcePreset !== 'depth-layer' || element.type !== 'image') return
  if (element.parent.type !== 'left-page' && element.parent.type !== 'right-page') element.parent = { type: 'right-page' }
  const safeWidth = pageWidth * .94
  const effectiveWidth = element.width * Math.abs(element.baseTransform.scale[0])
  if (effectiveWidth > safeWidth) {
    const ratio = safeWidth / Math.max(.001, effectiveWidth)
    element.baseTransform.scale = element.baseTransform.scale.map((value) => value * ratio) as [number, number, number]
  }
  const width = element.width * Math.abs(element.baseTransform.scale[0])
  const minimum = -pageWidth / 2 + element.pivot[0] * width
  const maximum = pageWidth / 2 - (1 - element.pivot[0]) * width
  element.baseTransform.position[0] = Math.min(maximum, Math.max(minimum, element.baseTransform.position[0]))
}

/** パーティクルは奥行きを持たない透明な縦置き平面から傾けない。 */
export function constrainParticlePlane(element: StageElement): void {
  if (element.type !== 'effect' || element.sourcePreset !== 'light-particles') return
  element.baseTransform.rotation[0] = 0
}
