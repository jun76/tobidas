import type { Asset } from '../schema/assets'
import coverBackData from '../assets/standard/tobidas-cover-back.webp?inline'
import coverFrontData from '../assets/standard/tobidas-cover-front.webp?inline'
import bgmData from '../assets/standard/bgm.mp3?inline'
import pageTurnData from '../assets/standard/page-turn.wav?inline'

/** 新規作品へ最初から登録する標準素材の安定したID。 */
export const STANDARD_ASSET_IDS = {
  coverFront: 'standard/tobidas-cover-front.webp',
  coverBack: 'standard/tobidas-cover-back.webp',
  bgm: 'standard/bgm.mp3',
  pageTurn: 'standard/page-turn.wav',
} as const

/**
 * ビルダーへ同梱する標準素材を新規作品用のAssetへ展開する。
 * 実体はViteでdata URLへインライン化するため、リポジトリ版とWeb版で同じ保存経路を使える。
 */
export function createStandardAssets(): Asset[] {
  return [
    {
      id: STANDARD_ASSET_IDS.coverFront,
      name: 'tobidas-cover-front',
      type: 'image',
      mime: 'image/webp',
      bytes: 137058,
      width: 887,
      height: 887,
      data: coverFrontData,
    },
    {
      id: STANDARD_ASSET_IDS.coverBack,
      name: 'tobidas-cover-back',
      type: 'image',
      mime: 'image/webp',
      bytes: 134244,
      width: 887,
      height: 887,
      data: coverBackData,
    },
    {
      id: STANDARD_ASSET_IDS.bgm,
      name: 'bgm',
      type: 'audio',
      mime: 'audio/mpeg',
      bytes: 2716959,
      data: bgmData,
    },
    {
      id: STANDARD_ASSET_IDS.pageTurn,
      name: 'page-turn',
      type: 'audio',
      mime: 'audio/wav',
      bytes: 176478,
      data: pageTurnData,
    },
  ]
}
