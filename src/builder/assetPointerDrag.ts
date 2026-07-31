export const ASSET_POINTER_DRAG_EVENT = 'tobidas-asset-pointer-drag'

/**
 * アセット一覧から編集面へのドラッグ。
 *
 * 受け口は2つある。画像は紙面 (PageDropController)、効果音は編集面の全域
 * (TimelinePanel) で、どちらが受けるかは選択中のプリセットが決める
 * (docs/008 §5)。どの型で置くかもプリセットが持つので、ここは
 * 「どのアセットが、いまどこにいるか」だけを運ぶ。
 */
export interface AssetPointerDragDetail {
  assetId: string
  clientX: number
  clientY: number
  phase: 'move' | 'drop' | 'cancel'
}

export function notifyAssetPointerDrag(detail: AssetPointerDragDetail) {
  window.dispatchEvent(new CustomEvent<AssetPointerDragDetail>(ASSET_POINTER_DRAG_EVENT, { detail }))
}
