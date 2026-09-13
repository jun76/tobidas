// 022の成果物を標準UIと配布HTMLから読む受け入れ検査。編集用storeへ直接値を渡さない。
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { isHmrNoise, QA_SERVER } from './lib/embedProject.mjs'

const args = process.argv.slice(2), flag = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
const root = path.resolve(flag('--root', '.tmp/022-samples')), out = path.resolve(flag('--out', 'output/playwright/022/ui'))
fs.mkdirSync(out, { recursive: true })
const cases = [
  { id: 'forest-lantern', spread: 'spread-1', child: 'spread-1-ember', liveSpread: 2, livePhase: .3 },
  { id: 'morning-walk', spread: 'spread-2', child: 'spread-2-shutter-1', liveSpread: 2, livePhase: .15 },
  { id: 'four-seasons', spread: 'spread-1', child: 'spread-1-particle-far', liveSpread: 4, livePhase: .15 },
  { id: 'crooked-castle', spread: 'spread-1', child: 'back-left-1', liveSpread: 0, livePhase: .05 },
].filter((work) => !args.includes('--work') || flag('--work').split(',').includes(work.id))
if (args.includes('--classroom')) cases.push({ id: 'morning-walk', spread: 'spread-5', child: 'spread-5-sunbeam', liveSpread: 4, livePhase: .2 })
const server = args.includes('--url') ? undefined : await createServer({ configFile: 'vite.config.ts', server: QA_SERVER })
await server?.listen()
const url = flag('--url', server && `http://localhost:${server.httpServer.address().port}/`), browser = await chromium.launch()
const errors = [], results = []
const check = (condition, message) => { if (!condition) throw new Error(message) }
const monitor = (page, name) => {
  page.on('pageerror', (error) => errors.push(name + ': ' + error.message))
  page.on('console', (message) => { if (message.type() === 'error' && !isHmrNoise(message.text())) errors.push(name + ': ' + message.text()) })
}
const row = (page, kind, id) => page.locator(`[data-tobidas-kind="${kind}"][data-tobidas-id="${id}"]`)
const select = async (page, id) => { await row(page, 'element', id).click(); await page.locator(`[data-tobidas-selection-id="${id}"]`).waitFor() }
const valueIs = async (input, number) => {
  await input.page().waitForFunction(({ label, expected }) => [...document.querySelectorAll('input')].some((input) => input.getAttribute('aria-label') === label && Math.abs(Number(input.value) - expected) < 1e-5), { label: await input.getAttribute('aria-label'), expected: number })
}
try {
  for (const work of cases) {
    const folder = path.join(root, '022-' + work.id), source = JSON.parse(fs.readFileSync(path.join(folder, 'project.json'), 'utf8'))
    const sourceSpread = source.book.spreads.find((spread) => spread.id === work.spread), child = sourceSpread.elements.find((element) => element.id === work.child)
    const parent = child.attachment.surface.nodeId
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'ja-JP', acceptDownloads: true })
    // ネイティブ保存ダイアログのないブラウザとして、標準のダウンロード経路を検査する。
    await context.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }))
    const page = await context.newPage(); monitor(page, work.id)
    await page.goto(url); await page.getByRole('button', { name: '絵本作品を編集', exact: true }).click()
    const start = performance.now()
    await page.getByLabel('開く', { exact: true }).first().setInputFiles(folder)
    await page.locator(`[data-tobidas-project-id="${source.id}"]`).waitFor({ timeout: 60000 })
    const importMs = performance.now() - start
    await row(page, 'spread', work.spread).click(); await select(page, work.child)
    const anchor = page.getByLabel('面上の基準点 X', { exact: true }), before = Number(await anchor.inputValue())
    const editStart = performance.now()
    await anchor.fill(String(before + .002)); await anchor.press('Tab'); await valueIs(anchor, before + .002)
    const childEditMs = performance.now() - editStart
    const undo = page.getByRole('button', { name: '元に戻す', exact: true })
    check(await undo.isEnabled(), work.id + ': 基準点の編集がUndoに入りません')
    await undo.click(); await select(page, work.child); await valueIs(page.getByLabel('面上の基準点 X', { exact: true }), before)
    let parentEditMs
    // 実ページへ直接付ける演出には、移動可能な親部品がない。
    if (parent !== '$book') {
      await select(page, parent)
      const parentStart = performance.now()
      await page.getByLabel('横方向の移動量', { exact: true }).fill('.002')
      await page.getByRole('button', { name: '移動する', exact: true }).click()
      // 支持の再設計・検査とReactの描画が終わるまで、操作の完了を待つ。
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button =>
        button.getAttribute('aria-label') === '元に戻す' && !button.disabled), undefined, { timeout: 30000 })
      check(await undo.isEnabled(), work.id + ': 親の移動が確定できません')
      parentEditMs = performance.now() - parentStart
      await select(page, work.child); await valueIs(page.getByLabel('面上の基準点 X', { exact: true }), before)
    }
    await page.screenshot({ path: path.join(out, work.id + '-builder.png') })
    if (parent !== '$book') await undo.click()
    // UIの書き出しを読み戻し、Undo後の基準点と参照が残っていることを確認する。
    await page.getByRole('button', { name: 'エクスポート', exact: true }).click()
    const download = page.waitForEvent('download', { timeout: 60000 })
    await page.getByRole('button', { name: '編集用の作品ZIP', exact: true }).click()
    const zip = await download, zipPath = path.join(out, work.id + '-roundtrip.tobidas.zip'); await zip.saveAs(zipPath)
    await page.getByLabel('作品ZIPを開く', { exact: true }).first().setInputFiles(zipPath)
    await page.locator('[data-tobidas-selection-kind="spread"]').waitFor({ timeout: 60000 })
    await row(page, 'spread', work.spread).click(); await select(page, work.child)
    await valueIs(page.getByLabel('面上の基準点 X', { exact: true }), before)
    results.push({ id: work.id, spreadId: work.spread, editedContent: work.child, folderImport: true, zipImport: true, childEditUndo: true, parentMoveUndo: parent !== '$book' ? true : '実ページへの直接接続', importMs, childEditMs, parentEditMs })
    console.log(work.id + ': フォルダー・作品ZIP、接続点の編集とUndo OK')
    await context.close()

    const offlineContext = await browser.newContext({ viewport: { width: 1280, height: 800 } }), offline = await offlineContext.newPage()
    monitor(offline, work.id + '/offline')
    const external = []
    await offline.route(/^https?:/, (route) => { external.push(route.request().url()); return route.abort() })
    await offline.goto(pathToFileURL(path.join(root, '022-samples-review', work.id + '.html')).href)
    await offline.waitForFunction(() => typeof window.__tobiSetScroll === 'function', { timeout: 30000 })
    await offline.locator('canvas').waitFor()
    const total = source.book.sequence.coverOpenSeconds + source.book.spreads.reduce((n, spread) => n + spread.sequence.holdSeconds + spread.sequence.turnSeconds, 0)
    let time = source.book.sequence.coverOpenSeconds
    for (let i = 0; i < work.liveSpread; i++) time += source.book.spreads[i].sequence.holdSeconds + source.book.spreads[i].sequence.turnSeconds
    time += source.book.spreads[work.liveSpread].sequence.holdSeconds * work.livePhase
    await offline.evaluate((progress) => window.__tobiSetScroll(progress), time / total)
    await offline.waitForTimeout(1800)
    const beforeImage = await offline.screenshot({ path: path.join(out, work.id + '-live-before.png') })
    // 周期運動はページ送りが止まっていても続く。操作ボタンで実際の自動再生も試す。
    await offline.getByRole('button', { name: 'Play', exact: true }).click()
    const frameTimes = await offline.evaluate(() => new Promise((resolve) => {
      const times = []; let last = performance.now(), start = last
      const frame = (now) => { times.push(now - last); last = now; if (now - start < 2400) requestAnimationFrame(frame); else resolve(times) }
      requestAnimationFrame(frame)
    }))
    await offline.getByRole('button', { name: 'Pause', exact: true }).click()
    const afterImage = await offline.screenshot({ path: path.join(out, work.id + '-live-after.png') })
    check(!beforeImage.equals(afterImage), work.id + ': 再生しても画像が変わりません')
    check(Number(await offline.getByLabel('Book progress').inputValue()) > time / total, work.id + ': 自動ページ送りが進みません')
    check(!external.length, work.id + ': HTMLが外部通信に依存しています')
    results.at(-1).offlineHtml = true; results.at(-1).livePlayback = true
    results.at(-1).frameMs = { mean: frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length, p95: frameTimes.toSorted((a, b) => a - b)[Math.floor(frameTimes.length * .95)] }
    console.log(work.id + ': file://の単一HTML、自動再生、外部通信0 OK')
    await offlineContext.close()
  }
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {})
    fs.writeFileSync(path.join(out, 'failure.txt'), String(error) + '\n' + await page.locator('body').innerText().catch(() => ''))
  }
  throw error
} finally {
  await browser.close(); await server?.close()
  fs.writeFileSync(path.join(out, 'ui-report.json'), JSON.stringify({ results, errors }, null, 2))
}
if (errors.length) throw new Error(errors.join('\n'))
