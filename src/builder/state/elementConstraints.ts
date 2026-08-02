import type { Spread } from '../../schema/book'
import { childrenByParent, constrainAbovePaper, updatePageOwnership } from '../../runtime/stow/geometry'

/** 編集後の部品ツリーへ、紙面床と左右ページ所有の不変条件を適用する。 */
export function normalizeElementLayout(spread: Spread, elementId: string, pageWidth: number): void {
  const initial = spread.elements.find((element) => element.id === elementId)
  if (!initial) return
  let root = initial
  const seen = new Set<string>()
  while (root.parent.type === 'element' && !seen.has(root.id)) {
    seen.add(root.id)
    const parentId: string = root.parent.elementId
    const parent = spread.elements.find((element): boolean => element.id === parentId)
    if (!parent) break
    root = parent
  }
  const children = childrenByParent(spread)
  constrainAbovePaper(root, children, pageWidth)
  updatePageOwnership(root, children, pageWidth)
}
