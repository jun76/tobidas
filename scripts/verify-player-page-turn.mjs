// 再生画面の見開き単位のページ送りと、エージェント向けの意味付きDOMを検査する。
//
// 作品は projects/<id>/ を埋め込み、読み上げを切った上で各見開きの先頭の本文へ読み上げ指定を付ける。
// 目的地の計算は runtime/pageTurn.ts と同じ規則をここで再現し、到着位置を突き合わせる。
//
//   node scripts/verify-player-page-turn.mjs forest_lantern
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { embedProjectFolder, injectProject, isHmrNoise, QA_SERVER } from './lib/embedProject.mjs'

const projectId = process.argv[2] ?? 'forest_lantern'
const project = embedProjectFolder(`projects/${projectId}`)
project.book.readAloud = false
/** 見開きごとに期待する本文一覧 (読み上げ指定があり表示中の visual を要素順に) */
const expectedTexts = project.book.spreads.map((spread) => {
  const first = spread.elements.find((element) => element.type === 'visual' && element.visible !== false && element.text?.trim())
  if (first) first.speech = 'en'
  return spread.elements
    .filter((element) => element.type === 'visual' && element.visible !== false && element.speech && element.speech !== 'none' && element.text?.trim())
    .map((element) => element.text.replace(/\s+/g, ' ').trim())
})

/** 保持区間の終端の進行値 (runtime/pageTurn.ts の spreadHoldEnd と同じ計算) */
const holdEnds = (() => {
  const { spreads, sequence } = project.book
  const total = sequence.coverOpenSeconds + spreads.reduce((sum, spread) => sum + spread.sequence.holdSeconds + spread.sequence.turnSeconds, 0)
  let cursor = sequence.coverOpenSeconds
  return spreads.map((spread) => {
    cursor += spread.sequence.holdSeconds
    const end = cursor / total
    cursor += spread.sequence.turnSeconds
    return end
  })
})()

const server = await createServer({ configFile: 'vite.config.ts', server: QA_SERVER })
await server.listen()
const address = server.httpServer.address()
const port = typeof address === 'object' && address ? address.port : 5173
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error' && !isHmrNoise(message.text())) errors.push(message.text())
})

const state = () => page.locator('[data-tobidas-kind="player-state"]')
const playback = () => state().getAttribute('data-tobidas-playback')
const spreadIndex = () => state().getAttribute('data-tobidas-spread-index')
const texts = () => page.getByLabel('Current spread text').locator('li').allInnerTexts()
const waitManual = async (timeout = 30_000) => {
  await page.waitForFunction(() => document.querySelector('[data-tobidas-kind="player-state"]')?.getAttribute('data-tobidas-playback') === 'manual', null, { timeout })
}
// 再生バーの value は step=0.001 で丸まるので、その半分までを一致とみなす
const near = (left, right) => Math.abs(left - right) <= 5e-4 + 1e-9

try {
  await page.route('**/player.html*', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ status: response.status(), contentType: 'text/html; charset=utf-8', body: injectProject(await response.text(), project) })
  })
  await page.goto(`http://localhost:${port}/player.html`, { waitUntil: 'networkidle' })
  const range = page.getByLabel('Book progress')
  const progress = () => range.inputValue().then(Number)
  const next = page.getByLabel('Next page')
  const prev = page.getByLabel('Previous page')
  const playButton = page.getByRole('button', { name: 'Play', exact: true })

  // 起動直後: 表紙が閉じていて、手動モード、見開き無し、Prev 無効
  if (await playback() !== 'manual') throw new Error('起動直後が手動モードではありません')
  if (await spreadIndex() !== null) throw new Error('表紙を開く前に見開きの添字が付いています')
  if (await state().getAttribute('data-tobidas-read-aloud') !== 'false') throw new Error('読み上げOFFがDOMへ出ていません')
  if (!await prev.isDisabled()) throw new Error('表紙で Prev が無効になっていません')
  if ((await texts()).length) throw new Error('表紙で本文一覧が空ではありません')

  // Next: turning を経て最初の見開きの保持終端で止まり、本文一覧が出る
  await next.click()
  if (await playback() !== 'turning') throw new Error('Next で turning へ移りません')
  await waitManual()
  if (!near(await progress(), holdEnds[0])) throw new Error(`Next の到着位置が保持終端ではありません: ${await progress()} ≠ ${holdEnds[0]}`)
  if (await spreadIndex() !== '0') throw new Error(`到着後の見開きの添字が 0 ではありません: ${await spreadIndex()}`)
  const listed = await texts()
  if (JSON.stringify(listed) !== JSON.stringify(expectedTexts[0])) throw new Error(`本文一覧が一致しません:\n${JSON.stringify(listed)}\n${JSON.stringify(expectedTexts[0])}`)

  // もう一度 Next: 2見開き目の保持終端。Prev: 1見開き目の保持終端へ逆再生で戻る
  if (project.book.spreads.length > 1) {
    await next.click()
    await waitManual()
    if (!near(await progress(), holdEnds[1])) throw new Error(`2回目の Next の到着位置が保持終端ではありません: ${await progress()}`)
    if (await spreadIndex() !== '1') throw new Error('2回目の Next 後の添字が 1 ではありません')
    await prev.click()
    if (await playback() !== 'turning') throw new Error('Prev で turning へ移りません')
    await waitManual()
    if (!near(await progress(), holdEnds[0])) throw new Error(`Prev の到着位置が前の保持終端ではありません: ${await progress()}`)
  }

  // 自動再生中の Next は自動再生を止めて turning へ、到着後は Play の絵に戻る
  await playButton.click()
  await page.waitForTimeout(200)
  if (await playback() !== 'auto') throw new Error('再生ボタンで auto へ移りません')
  // 保持の途中で押すので、残りの演出を待たずに現在の見開きの保持終端へ直ちに飛ぶ
  const spreadBefore = Number(await spreadIndex())
  await next.click()
  if (await playback() !== 'turning') throw new Error('自動再生中の Next が turning へ移りません')
  const jumped = await progress()
  if (!(jumped >= holdEnds[spreadBefore] - 5e-4)) throw new Error(`自動再生中の Next がめくり開始のフレームへ飛びません: ${jumped} < ${holdEnds[spreadBefore]}`)
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor()
  await waitManual()
  if (await spreadIndex() !== String(spreadBefore + 1)) throw new Error('自動再生中の Next の到着先が次の見開きではありません')

  // 手動モードからの再生ボタンはその位置から進む
  const before = await progress()
  await playButton.click()
  await page.waitForTimeout(250)
  if (await playback() !== 'auto') throw new Error('手動モードからの再生ボタンで auto へ移りません')
  const after = await progress()
  if (!(after > before && after - before < .1)) throw new Error(`手動モードからの再生がその位置から進みません: ${before} → ${after}`)

  // 末尾まで送ると Next が無効になり、Prev は最後の保持終端へ戻す
  await page.evaluate(() => window.__tobiSetScroll?.(1))
  await page.waitForTimeout(100)
  if (await playback() !== 'manual') throw new Error('__tobiSetScroll で手動モードへ戻りません')
  if (!await next.isDisabled()) throw new Error('末尾で Next が無効になっていません')
  await prev.click()
  await waitManual()
  if (!near(await progress(), holdEnds.at(-1))) throw new Error(`末尾からの Prev が最後の保持終端へ戻りません: ${await progress()}`)
} finally {
  await browser.close()
  await server.close()
}

if (errors.length) throw new Error(`プレイヤーのブラウザエラー:\n${errors.join('\n')}`)
console.log(`${projectId}: ページ送り・逆戻し・自動再生との切り替え・本文一覧を確認`)
