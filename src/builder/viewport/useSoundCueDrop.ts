import { useEffect, useState, type RefObject } from 'react'
import { evaluateBookSignals } from '../../runtime/signals'
import { ASSET_POINTER_DRAG_EVENT, type AssetPointerDragDetail } from '../assetPointerDrag'
import { assetKindForMode } from '../presets'
import { useBuilderStore } from '../store'

/**
 * 効果音の投入 (docs/008 §5.2)。
 *
 * 受け口はビューポートとタイムラインパネルの全域で、どこへ落としても結果は
 * 変わらない。キューの時刻は落とした位置ではなく**スクラブの現在位置**にする。
 *
 * 画像と違い、効果音には「紙面のどこ」が無いので、位置に意味を持たせる必要が
 * ない。横位置を時刻に写すと目盛りを狙う操作になるが、そこまでの精度は置いた
 * あとにレーン上で掴んで動かせば足りる。受け口を中央全域にすることで、
 * 絵を見ながら「いまのこの瞬間」に置ける。
 *
 * 返り値は受け口の表示に使う。ドラッグ中に落とせる場所であることが見えないと、
 * 掴んだまま迷うことになる。
 */
export function useSoundCueDrop(rootRef: RefObject<HTMLElement | null>): boolean {
  const store = useBuilderStore()
  const [over, setOver] = useState(false)

  useEffect(() => {
    const onAssetDrag = (event: Event) => {
      const detail = (event as CustomEvent<AssetPointerDragDetail>).detail
      if (assetKindForMode(store.placement) !== 'audio' || store.mode !== 'edit') {
        setOver(false)
        return
      }
      const rect = rootRef.current?.getBoundingClientRect()
      const inside = Boolean(rect
        && detail.clientX >= rect.left && detail.clientX <= rect.right
        && detail.clientY >= rect.top && detail.clientY <= rect.bottom)
      if (detail.phase === 'move') {
        setOver(inside)
        return
      }
      setOver(false)
      if (detail.phase !== 'drop' || !inside) return
      const book = store.project.book
      const index = book.spreads.findIndex((spread) => spread.id === store.activeSpreadId)
      if (index < 0) return
      const time = evaluateBookSignals(book, store.previewProgress).spreadTimes[index] ?? 0
      store.upsertTimelineKey(store.activeSpreadId, { type: 'sound', assetId: detail.assetId }, 'cue', time, true)
    }
    window.addEventListener(ASSET_POINTER_DRAG_EVENT, onAssetDrag)
    return () => window.removeEventListener(ASSET_POINTER_DRAG_EVENT, onAssetDrag)
  }, [rootRef, store])

  return over
}
