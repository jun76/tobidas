// 部品ZIPの編集・交換と、空の絵本への再利用を標準画面から確認する。
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { isHmrNoise, QA_SERVER } from './lib/embedProject.mjs'

const args = process.argv.slice(2), flag = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
const review = path.resolve(flag('--review', '.tmp/samples-review')), out = path.resolve(flag('--out', 'output/playwright/samples/parts'))
fs.mkdirSync(out, { recursive: true })
const server = await createServer({ configFile: 'vite.config.ts', server: QA_SERVER }); await server.listen()
const browser = await chromium.launch(), context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'ja-JP', acceptDownloads: true })
await context.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined }))
const page = await context.newPage(), errors = [], result = {}
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error' && !isHmrNoise(message.text())) errors.push(message.text()) })
const shot = (name) => page.screenshot({ path: path.join(out, name + '.png') })
const clickSurface = async (x, y) => { await page.mouse.move(x, y); await page.waitForTimeout(350); await page.mouse.click(x, y) }
// 3D表示は縦の画角で拡大率が決まるので、横幅が変わっても中心からの横距離と縦位置は保たれる。
// 座標は旧レイアウトでの3D表示の中心 (絵本 x=770、部品 x=765) からの距離として書き、今の表示の中心へ移して押す
const sceneX = async (selector, x, oldCenter) => { const box = await page.locator(selector).first().boundingBox(); return box.x + box.width / 2 + (x - oldCenter) }
const clickBook = async (x, y) => clickSurface(await sceneX('[data-viewport-root] canvas', x, 770), y)
const check = (condition, message) => { if (!condition) throw new Error(message) }
try {
  await page.goto(`http://localhost:${server.httpServer.address().port}/`)
  await page.getByRole('button', { name: 'カスタム部品を編集', exact: true }).click()
  await page.getByLabel('読み込み', { exact: true }).first().setInputFiles(path.join(review, 'paper-windmill.tobidas-part.zip'))
  await page.getByRole('button', { name: '紙の塔と支持', exact: true }).waitFor({ timeout: 30000 })
  const section = page.locator('[data-tobidas-kind="part-contents"]')
  const contentsTab = page.getByRole('tab', { name: '内部の装飾と演出', exact: true })
  await contentsTab.click()
  await section.getByLabel('内部の装飾と演出', { exact: true }).selectOption('rotor')
  await shot('part-editor')
  await section.getByRole('button', { name: '紙面の装飾', exact: true }).click()
  const partX = await sceneX('[data-tobidas-kind="part-editor"] canvas', 900, 765)
  await page.mouse.move(partX, 660); await page.waitForTimeout(350); await shot('part-hover')
  await page.mouse.click(partX, 660)
  await page.getByRole('button', { name: '配置を中止', exact: true }).waitFor({ state: 'hidden' })
  const placed = await section.getByLabel('内部の装飾と演出', { exact: true }).inputValue()
  check(placed && placed !== 'rotor', '部品内部の紙へ装飾を設置できません')
  await shot('part-decoration')
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  await contentsTab.click()
  await section.getByLabel('内部の装飾と演出', { exact: true }).selectOption('rotor')
  const input = section.getByLabel('面上の基準点 X', { exact: true }), before = Number(await input.inputValue())
  await input.fill(String(before + .002)); await input.press('Tab')
  check(Math.abs(Number(await input.inputValue()) - before - .002) < .00001, '部品内部の基準点を編集できません')
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  result.internalPlacementAndUndo = true
  const partDownload = page.waitForEvent('download', { timeout: 60000 })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: '共有用ZIPを保存', exact: true }).click()
  const partZip = path.join(out, 'windmill-roundtrip.tobidas-part.zip'); await (await partDownload).saveAs(partZip)
  await page.getByLabel('読み込み', { exact: true }).first().setInputFiles(partZip)
  await page.getByRole('button', { name: '紙の塔と支持', exact: true }).waitFor()
  result.partZipRoundTrip = true
  await page.getByRole('button', { name: 'HOME', exact: true }).click()
  await page.getByRole('button', { name: '絵本作品を編集', exact: true }).click()
  await page.waitForTimeout(2000)
  check(await page.locator('[data-tobidas-kind="element"]').count() === 0, '再利用先が空の作品ではありません')
  await page.getByRole('button', { name: '背景パネル', exact: true }).click()
  await clickBook(600, 530); await clickBook(1000, 610)
  await page.getByRole('button', { name: '配置を中止', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '絵本へ配置', exact: true }).first().click()
  await clickBook(970, 650); await clickBook(960, 440)
  await page.getByRole('button', { name: '配置を中止', exact: true }).waitFor({ state: 'hidden', timeout: 30000 })
  await page.waitForTimeout(900)
  const beforeImage = await shot('part-reused')
  await page.waitForTimeout(1400)
  check(!beforeImage.equals(await shot('part-reused-rotated')), '配置後の風車の羽根が回転しません')
  check(await page.locator('[data-tobidas-kind="element"]').count() === 2, '背景と風車の2部品を配置できません')
  result.emptyBookPlacement = true; result.rotorPlayback = true
  await page.getByRole('button', { name: '保存', exact: true }).click()
  const bookDownload = page.waitForEvent('download', { timeout: 60000 })
  await page.getByRole('button', { name: '作品ZIPとして保存', exact: true }).click()
  const bookZip = path.join(out, 'windmill-in-book.tobidas.zip'); await (await bookDownload).saveAs(bookZip)
  await page.getByLabel('作品ZIPを開く', { exact: true }).first().setInputFiles(bookZip)
  await page.locator('[data-tobidas-selection-kind="spread"]').waitFor({ timeout: 60000 })
  check(await page.locator('[data-tobidas-kind="element"]').count() === 2, '作品ZIPへ同梱した風車が復元されません')
  result.bookZipRoundTrip = true
  await shot('part-reused-roundtrip')
  console.log('風車: 部品内の面選択・基準点編集・Undo、部品ZIP、空の作品への配置、羽根の再生、作品ZIP OK')
} finally {
  fs.writeFileSync(path.join(out, 'part-ui-report.json'), JSON.stringify({ result, errors }, null, 2))
  await browser.close(); await server.close()
}
if (errors.length) throw new Error(errors.join('\n'))
