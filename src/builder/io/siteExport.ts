import JSZip from 'jszip'
import { t } from '../i18n'
import { SITE_EXT } from '../../package/model'
import { externalizeAssets, inlineAssetBodies } from '../../package/serialize'
import type { BookProject } from '../../schema/bookPackage'
import { safeFileName, saveBlobAs } from './browserFiles'

/**
 * 公開用の書き出しは2通りある。素材の実体をどこへ置くかだけが違う。
 *
 * - 単一HTML: 実体を data URL のまま埋め込む。1ファイルなので file:// で直接開ける
 * - 静的ホスト: 実体を元の形式のまま隣の `assets/` へ置き、HTMLは相対URLだけ持つ
 *
 * 「素材を外へ出しつつ file:// でも開ける」は成立しない。file:// のページから見ると
 * 隣のファイルは別オリジンで、`<img>` で読めてもWebGLのテクスチャにする段で
 * cross-origin として弾かれる。プレイヤーは全面WebGLなので絵が出ない。
 * だから両立させずに、書き出す時点でどちらの配り方かを選ぶ。
 */

/** 素材の実体を置くフォルダ。作品データが持つ相対URLの行き先 */
const ASSET_DIR = 'assets'

/** 静的ホストへ上げる形。index.html + 元の形式のままの素材フォルダを ZIP に束ねる */
export async function exportSiteZip(project: BookProject): Promise<void> {
  const player = await fetchPlayer()
  // 同梱プレイヤーが assets/ を持つと素材と潰し合う。インライン化で空になる前提
  const conflict = player.extras.find((file) => file.path.startsWith(`${ASSET_DIR}/`))
  if (conflict) throw new Error(t().io.playerAssetConflict(conflict.path))

  const published = externalizeAssets(project)
  const zip = new JSZip()
  zip.file('index.html', injectProjectJson(player.html, published.project))
  zip.file('README.txt', README)
  for (const extra of player.extras) zip.file(extra.path, extra.body)
  const assets = zip.folder(ASSET_DIR)!
  for (const file of published.files) {
    if ('text' in file.bytes) assets.file(file.path, file.bytes.text)
    else if ('blob' in file.bytes) assets.file(file.path, file.bytes.blob, { compression: 'STORE' })
    else assets.file(file.path, file.bytes.base64, { base64: true })
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  await saveBlobAs(blob, `${safeFileName(project.name)}${SITE_EXT}`, t().io.siteZipName)
}

/** 配って直接開ける形。素材ごと1つのHTMLへ収める */
export async function exportSiteHtml(project: BookProject): Promise<void> {
  const player = await fetchPlayer()
  if (player.extras.length) throw new Error(t().io.playerNotSingleFile(player.extras[0].path))
  const html = injectProjectJson(player.html, await inlineAssetBodies(project))
  const blob = new Blob([html], { type: 'text/html' })
  await saveBlobAs(blob, `${safeFileName(project.name)}.html`, t().io.siteHtmlName)
}

/** 同梱プレイヤーを読む。index.html 以外が残っていれば単一HTMLではない */
async function fetchPlayer(): Promise<{ html: string; extras: { path: string; body: ArrayBuffer }[] }> {
  const base = `${import.meta.env.BASE_URL}player/`
  const manifestResponse = await fetch(`${base}manifest.json`, { cache: 'no-store' })
  if (!manifestResponse.ok) {
    throw new Error(t().io.playerMissing)
  }
  const manifest = (await manifestResponse.json()) as { files: string[] }
  const read = async (file: string): Promise<Response> => {
    const response = await fetch(base + file, { cache: 'no-store' })
    if (!response.ok) throw new Error(t().io.playerFileFailed(file))
    return response
  }
  const extras: { path: string; body: ArrayBuffer }[] = []
  for (const file of manifest.files) {
    // manifest.json は書き出しのための目録で、配布物には要らない
    if (file === 'index.html' || file === 'manifest.json') continue
    extras.push({ path: file, body: await (await read(file)).arrayBuffer() })
  }
  return { html: await (await read('index.html')).text(), extras }
}

/** 配布物の読み手への注意書き。再生画面と同じく英語で固定する */
const README = [
  'This folder is a web page. Upload it to any static host, or serve it locally, for example:',
  '',
  '    python -m http.server',
  '',
  'Opening index.html by double-clicking it will not work: browsers treat the files next to it',
  'as a foreign origin, and the artwork cannot be handed to WebGL from there.',
  'Use the single-HTML export instead if you want a file that opens on its own.',
  '',
].join('\n')

export function injectProjectJson(html: string, project: BookProject): string {
  const json = JSON.stringify(project).replace(/</g, '\\u003c')
  const placeholder = /(<script type="application\/json" id="tobidas-project">)[\s\S]*?(<\/script>)/
  if (!placeholder.test(html)) {
    throw new Error(t().io.playerOutdated)
  }
  return html.replace(placeholder, (_match, open: string, close: string) => open + json + close)
}
