import type { Spread } from '../../schema/book'
import type { StageElement } from '../../schema/stageElement'
import { childrenByParent, constrainAbovePaper, updatePageOwnership } from '../../runtime/stow/geometry'

/** 編集後の部品ツリーへ、紙面床と左右ページ所有の不変条件を適用する。 */
export function normalizeElementLayout(spread: Spread, elementId: string, pageWidth: number): void {
  const initial = spread.elements.find((element) => element.id === elementId)
  if (!initial) return
  // 新機構の配置はmountと面アンカーが決める。従来の紙面への押し戻しを適用しない。
  if (initial.type === 'assembly') {
    if (initial.mechanism.deployment.mode === 'page-constrained') {
      initial.baseTransform.rotation = [0, 0, 0]
      initial.baseTransform.scale = [1, 1, 1]
      initial.motion = []
      if (initial.mechanism.mount.type === 'gutter') initial.baseTransform.position = [0, 0, initial.baseTransform.position[2]]
    }
    return
  }
  if (initial.surfaceAttachment) return
  let root: StageElement = initial
  const seen = new Set<string>()
  while (root.parent.type === 'element' && !seen.has(root.id)) {
    seen.add(root.id)
    const parentId: string = root.parent.elementId
    const parent = spread.elements.find((element): boolean => element.id === parentId)
    if (!parent) break
    root = parent
    if (root.type === 'assembly') return
  }
  const children = childrenByParent(spread)
  constrainAbovePaper(root, children, pageWidth)
  updatePageOwnership(root, children, pageWidth)
}
