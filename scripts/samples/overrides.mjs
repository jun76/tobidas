/**
 * 手直しの上書き。
 *
 * 生成された作品を画面で見て詰めた結果は、定義ファイルの語彙 (u, v, 実物高さ) では
 * 素直に書けないことがある。かといって projects/<work>/project.json を直に直すと
 * 次の `npm run samples:generate` で消える。その差分をここへ置く。
 *
 * 置き場は scripts/samples/overrides/<work>.json で、形は:
 *
 *   {
 *     "spread-4/spread-4-house-2": { "position": [-1.75, 0.01, -0.5] },
 *     "spread-1/spread-1-store":   { "remove": true }
 *   }
 *
 * 鍵は「見開きID/要素ID」。値は要素のどの欄を差し替えるかで、
 * position / rotation / scale / width / height / layer / opacity / asset と remove を受ける。
 *
 * 上書きは生成の最後に当たり、そのあと npm test の包含検査を通る。つまり
 * 「畳めない位置へ動かした」はここへ書いても素通りしない。検査が落ちたら
 * 上書きの値を直す。紙のほうが正しく、上書きは紙に勝てない。
 */
import { existsSync, readFileSync } from 'node:fs'

const FIELDS = ['position', 'rotation', 'scale']
const DIRECT = ['width', 'height', 'layer', 'opacity', 'image', 'visible']

export function loadOverrides(workId) {
  const url = new URL(`./overrides/${workId}.json`, import.meta.url)
  if (!existsSync(url)) return null
  return JSON.parse(readFileSync(url, 'utf8'))
}

/**
 * 上書きを当てる。要素を消したときは、参照が無くなった素材も落とす
 * (残すと「未使用アセット」の警告になり、配布物も無駄に太る)。
 */
export function applyOverrides(project, overrides) {
  if (!overrides) return { patched: 0, removed: 0, dropped: 0 }
  const seen = new Set()
  let patched = 0
  let removed = 0
  for (const spread of project.book.spreads) {
    const keep = []
    for (const element of spread.elements) {
      const key = `${spread.id}/${element.id}`
      const patch = overrides[key]
      if (!patch) { keep.push(element); continue }
      seen.add(key)
      if (patch.remove) { removed++; continue }
      for (const field of FIELDS) if (patch[field]) { element.baseTransform[field] = [...patch[field]]; patched++ }
      for (const field of DIRECT) if (patch[field] !== undefined) { element[field] = patch[field]; patched++ }
      if (patch.asset !== undefined) { element.image = patch.asset; patched++ }
      keep.push(element)
    }
    spread.elements = keep
    // 消えた要素へ張ってあったトラックも落とす
    spread.timeline.tracks = spread.timeline.tracks.filter((track) =>
      track.target.type !== 'element' || spread.elements.some((element) => element.id === track.target.elementId))
  }
  const unknown = Object.keys(overrides).filter((key) => !seen.has(key))
  if (unknown.length) {
    throw new Error(`${project.id}: 上書きの宛先が見つかりません: ${unknown.join(', ')}`)
  }
  const dropped = pruneAssets(project)
  return { patched, removed, dropped }
}

/** どこからも参照されなくなった素材を落とす (bookValidate の未使用判定と同じ範囲を見る) */
function pruneAssets(project) {
  const used = new Set()
  const use = (id) => { if (id) used.add(id) }
  use(project.audio?.bgmAsset)
  use(project.book.frontCover.frontAsset)
  use(project.book.frontCover.backAsset)
  use(project.book.backCover.frontAsset)
  use(project.book.backCover.backAsset)
  for (const spread of project.book.spreads) {
    use(spread.leftPage.backgroundAsset)
    use(spread.rightPage.backgroundAsset)
    use(spread.enterSound)
    use(spread.pageTurnSound)
    for (const element of spread.elements) {
      use(element.image)
      use(element.backImage)
    }
    for (const track of spread.timeline.tracks) {
      // 効果音トラックは音声を指すだけで、キーは時刻しか持たない
      if (track.target.type === 'sound') { use(track.target.assetId); continue }
      if (track.property !== 'visual.image') continue
      for (const key of track.keys) if (typeof key.value === 'string') use(key.value)
    }
  }
  const before = project.assets.length
  project.assets = project.assets.filter((asset) => used.has(asset.id))
  return before - project.assets.length
}
