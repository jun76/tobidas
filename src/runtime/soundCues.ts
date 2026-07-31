import type { Book } from '../schema/book'
import { compileBookBeats, playbackDurationSeconds } from './signals'

/**
 * 効果音の発火判定。
 *
 * 音は姿勢と違って冪等でない。「同じ進行値は必ず同じ姿勢を返す」の不変条件は
 * 空間の話であり、音を同じ規則で扱うとスクラブのたびに同じ音が何度も鳴る。
 * だから音だけは「跨いだ瞬間の出来事」として扱い、進行値の関数にはしない。
 *
 * 姿勢の評価器はこれを知らない。再生位置を進める側 (プレイヤーとビルダーの
 * 再生モード) が、前の位置と今の位置を渡して跨ぎを問う。
 *
 * 鳴らすのは次を満たすときだけ:
 *
 *   - 前へ進んでいる (逆再生では鳴らさない)
 *   - 連続再生である (つまみを飛ばした・?progress= で開いた等では鳴らさない)
 *   - キューがその見開きの保持区間にあり、跨いだ位置がその区間内にある
 */

/** 連続再生とみなす1フレームあたりの進行量の上限。これを超える移動は飛ばしたとみなす */
const CONTINUOUS_LIMIT = 0.05

export interface SoundCueHit {
  assetId: string
  /** 作品全体の進行としてのキューの位置。並べ替えの基準になる */
  progress: number
}

/**
 * from から to へ進んだときに跨いだキュー。
 * from === to や逆行、飛ばしすぎのときは空になる。
 */
export function crossedSoundCues(book: Book, from: number, to: number): SoundCueHit[] {
  if (!(to > from) || to - from > CONTINUOUS_LIMIT) return []
  const duration = playbackDurationSeconds(book)
  if (duration <= 0) return []
  const beats = compileBookBeats(book)
  const hits: SoundCueHit[] = []
  for (const spread of book.spreads) {
    const hold = beats.find((beat) => beat.kind === 'hold' && beat.spreadId === spread.id)
    if (!hold) continue
    for (const track of spread.timeline.tracks) {
      if (track.target.type !== 'sound' || track.property !== 'cue') continue
      for (const key of track.keys) {
        // 保持区間の外へはみ出したキーは、その区間の端で鳴る
        const seconds = Math.min(spread.sequence.holdSeconds, Math.max(0, key.time))
        const progress = (hold.startSeconds + seconds) / duration
        if (progress > from && progress <= to) hits.push({ assetId: track.target.assetId, progress })
      }
    }
  }
  return hits.sort((left, right) => left.progress - right.progress)
}

/** 作品が使っている効果音のアセットID (先読みに使う) */
export function soundCueAssetIds(book: Book): string[] {
  const ids = new Set<string>()
  for (const spread of book.spreads) {
    for (const track of spread.timeline.tracks) {
      if (track.target.type === 'sound' && track.keys.length) ids.add(track.target.assetId)
    }
  }
  return [...ids]
}
