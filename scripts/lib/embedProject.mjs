// 作品パッケージ (フォルダ) を、書き出し済みHTMLと同じ「埋め込み済み」の形へ組み立てる。
//
// 再生画面の受け取り口は埋め込みデータ1つだけで、開発用の読み込み経路は持たない
// (src/player/PlayerApp.tsx)。自動化からは playwright でHTMLの応答を差し替え、
// 配布物とまったく同じ経路で再生させる。組み立ての規則は src/package/assemble.ts と同じ:
// SVG は文字列、それ以外は data URL。
import fs from 'node:fs'
import path from 'node:path'

/** QA用に立てる dev サーバー。開発用の 5174 とぶつからないよう空き番号を取る */
export const QA_SERVER = { port: 0 }

/**
 * HMRのwebsocket失敗だけを落とすふるい。
 *
 * 応答を差し替えたページは playwright が返すので、Chrome は dev サーバーと別の
 * アドレス空間として扱い、HMRのwebsocketがローカルネットワークアクセス制限で必ず失敗する。
 * 再生そのものには関係がないが、コンソールエラーを検査するスクリプトはこれで落ちる。
 * 書き出した単一HTMLにHMRは存在しないので、この行だけ無視してよい。
 */
export function isHmrNoise(text) {
  return /\[vite\]|websocket connection to|failed to connect to websocket/i.test(text)
}

/** projects/<id>/ を読んで、アセット実体を抱えた BookProject にする */
export function embedProjectFolder(dir) {
  const projectJson = path.join(dir, 'project.json')
  if (!fs.existsSync(projectJson)) throw new Error(`project.json がありません: ${projectJson}`)
  const project = JSON.parse(fs.readFileSync(projectJson, 'utf8'))
  project.assets = project.assets.map((meta) => {
    const file = path.join(dir, 'assets', meta.id)
    if (!fs.existsSync(file)) throw new Error(`アセットの実体がありません: ${file}`)
    const data = meta.type === 'svg'
      ? fs.readFileSync(file, 'utf8')
      : `data:${meta.mime};base64,${fs.readFileSync(file).toString('base64')}`
    return { ...meta, data }
  })
  return project
}

/** 再生画面のHTMLへ作品を注入する。置換先は siteExport.ts と同じ入れ物 */
export function injectProject(html, project) {
  const json = JSON.stringify(project).replace(/</g, '\\u003c')
  const placeholder = /(<script type="application\/json" id="tobidas-project">)[\s\S]*?(<\/script>)/
  if (!placeholder.test(html)) throw new Error('tobidas-project の入れ物がHTMLにありません')
  return html.replace(placeholder, (_match, open, close) => open + json + close)
}

/**
 * player.html の応答を、作品を埋め込んだものへ差し替える。
 * これを呼んでから goto すると、書き出した単一HTMLと同じ状態の再生画面が開く。
 */
export async function servePlayerWithProject(page, dir) {
  const project = embedProjectFolder(dir)
  await page.route('**/player.html*', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      status: response.status(),
      contentType: 'text/html; charset=utf-8',
      body: injectProject(await response.text(), project),
    })
  })
  return project
}
