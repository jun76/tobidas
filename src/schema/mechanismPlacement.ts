import type { Book } from './book'
import type { AssemblyElement } from './stageElement'

/** 保存時検証とQAが共有する、実ページ接続の有限領域と変換の契約。 */
export function realPageAnchorIssues(element: AssemblyElement, format: Book['format']): string[] {
  const spec = element.mechanism
  if (spec.deployment.mode !== 'page-constrained') return []
  const errors: string[] = []
  const transform = element.baseTransform
  const pageWidth = format.pageWidth
  const pageDepth = pageWidth / format.pageAspect
  const { width, height, depth } = spec.parameters
  const epsilon = Math.max(pageWidth, pageDepth) * 1e-7
  if (transform.rotation.some((value) => value !== 0) || transform.scale.some((value) => value !== 1)) {
    errors.push('real page anchors cannot be rotated or scaled')
  }
  if (spec.mount.type === 'gutter') {
    if (transform.position[0] !== 0 || transform.position[1] !== 0) errors.push('gutter anchors require x=0 and y=0')
    // 接着線は無限平面ではなく、実際の左右ページの有限領域に属する。
    if (width / 2 > pageWidth + epsilon) errors.push('real gutter anchors exceed page width')
    if (Math.abs(transform.position[2]) + depth / 2 > pageDepth / 2 + epsilon) errors.push('real gutter anchor lines exceed page depth')
    const closedReach = spec.kind === 'v-fold' ? width / 2 + Math.hypot(width / 2, height) : width / 2 + height
    if (closedReach > pageWidth + epsilon) errors.push('rigid folded mechanism exceeds finite page reach')
  } else if (spec.mount.type === 'page') {
    const [x, y, z] = transform.position
    if (Math.abs(y) > epsilon) errors.push('real page hinge requires y=0')
    if (Math.abs(x) + width / 2 > pageWidth / 2 + epsilon) errors.push('real page hinge exceeds page width')
    if (z - height < -pageDepth / 2 - epsilon || z > pageDepth / 2 + epsilon) errors.push('folded real page panel exceeds page depth')
  }
  if (element.motion.length) errors.push('real page anchors cannot use content motion')
  return errors
}
