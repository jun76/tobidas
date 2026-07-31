import { chromium } from 'playwright'
import { createServer } from 'vite'
import { isHmrNoise, QA_SERVER, servePlayerWithProject } from './lib/embedProject.mjs'

const projectId = process.argv[2] ?? 'forest_lantern'
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

try {
  await servePlayerWithProject(page, `projects/${projectId}`)
  await page.goto(`http://localhost:${port}/player.html`, { waitUntil: 'networkidle' })
  const range = page.getByLabel('Book progress')
  const progress = () => range.inputValue().then(Number)
  // BGMのある作品には「Play music」ボタンも出るので、再生ボタンは完全一致で引く
  const playButton = page.getByRole('button', { name: 'Play', exact: true })

  await playButton.click()
  await page.waitForTimeout(250)
  if (await progress() <= 0) throw new Error('自動再生が進みません')

  await page.mouse.wheel(0, 120)
  await playButton.waitFor()

  await page.evaluate(() => window.__tobiSetScroll?.(.9995))
  await playButton.click()
  await page.getByLabel('Replay from start').waitFor({ timeout: 2_000 })
  if (await progress() !== 1) throw new Error('終端で停止しません')

  await page.getByLabel('Replay from start').click()
  await page.waitForTimeout(150)
  if (await progress() >= .05) throw new Error('終端からの再生が先頭へ戻りません')

  const beforeFreeze = await progress()
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await new Promise((resolve) => setTimeout(resolve, 800))
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(120)
  const afterResume = await progress()
  if (afterResume - beforeFreeze > .01) {
    throw new Error(`非表示相当の停止から復帰時に時間が飛びました: ${beforeFreeze} → ${afterResume}`)
  }
} finally {
  await browser.close()
  await server.close()
}

if (errors.length) throw new Error(`プレイヤーのブラウザエラー:\n${errors.join('\n')}`)
console.log(`${projectId}: 再生・操作停止・終端再開・非表示復帰を確認`)
