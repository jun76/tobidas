// 標準プレイヤーを実描画し、保持中と全ページ往復後のGPUバッファ数が増え続けないことを検査する。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { servePlayerWithProject, QA_SERVER, isHmrNoise } from './lib/embedProject.mjs'

const projectDir = process.argv[2]
if (!projectDir) throw new Error('使い方: node scripts/verify-content-resources.mjs <作品フォルダ> [結果フォルダ]')
const out = path.resolve(process.argv[3] ?? 'shots/content-resources')
fs.mkdirSync(out, { recursive: true })
const server = await createServer({ configFile: 'vite.config.ts', server: QA_SERVER })
await server.listen()
let browser
try {
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } })
  const errors = [], samples = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('crash', () => errors.push('タブがクラッシュした'))
  page.on('console', message => { if (message.type() === 'error' && !isHmrNoise(message.text())) errors.push(message.text()) })
  await page.addInitScript(() => {
    window.__bufferMetrics = { created: 0, deleted: 0, frames: 0, contextLosses: 0 }
    const step = () => { window.__bufferMetrics.frames++; requestAnimationFrame(step) }
    requestAnimationFrame(step)
    document.addEventListener('webglcontextlost', () => window.__bufferMetrics.contextLosses++, true)
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const create = proto.createBuffer, remove = proto.deleteBuffer
      proto.createBuffer = function (...args) { const buffer = create.apply(this, args); if (buffer) window.__bufferMetrics.created++; return buffer }
      proto.deleteBuffer = function (...args) { if (args[0]) window.__bufferMetrics.deleted++; return remove.apply(this, args) }
    }
  })
  const { book } = await servePlayerWithProject(page, projectDir)
  const total = book.sequence.coverOpenSeconds + book.spreads.reduce((sum, spread) => sum + spread.sequence.holdSeconds + spread.sequence.turnSeconds, 0)
  let start = book.sequence.coverOpenSeconds
  const poses = book.spreads.map((spread) => {
    const hold = (start + spread.sequence.holdSeconds * .5) / total
    const fold = (start + spread.sequence.holdSeconds + spread.sequence.turnSeconds * .5) / total
    start += spread.sequence.holdSeconds + spread.sequence.turnSeconds
    return { hold, fold }
  })
  await page.goto(`http://localhost:${server.httpServer.address().port}/player.html`)
  await page.waitForFunction(() => typeof window.__tobiSetScroll === 'function')
  const frames = async (count) => {
    const target = await page.evaluate(n => window.__bufferMetrics.frames + n, count)
    await page.waitForFunction(target => window.__bufferMetrics.frames >= target, target)
  }
  const sample = async (label) => {
    const result = await page.evaluate(() => ({ ...window.__bufferMetrics, live: window.__bufferMetrics.created - window.__bufferMetrics.deleted }))
    samples.push({ label, ...result }); return result
  }
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const [i, pose] of poses.entries()) {
      await page.evaluate(p => window.__tobiSetScroll(p), pose.hold)
      await frames(20)
      const before = await sample(`${cycle + 1}/${i + 1}/before`)
      await frames(30)
      const after = await sample(`${cycle + 1}/${i + 1}/after`)
      assert.ok(after.live - before.live <= 16, `見開き${i + 1}の保持中に未解放バッファが増加: ${after.live - before.live}`)
      if (cycle === 0) await page.screenshot({ path: path.join(out, `${i + 1}-hold.png`) })
      await page.evaluate(p => window.__tobiSetScroll(p), pose.fold)
      await frames(8)
      if (cycle === 0) await page.screenshot({ path: path.join(out, `${i + 1}-fold.png`) })
      console.log(`周回${cycle + 1} 見開き${i + 1}: 保持中の未解放バッファ増加 ${after.live - before.live}`)
    }
    await page.evaluate(() => window.__tobiSetScroll(0))
    await frames(20)
    await sample(`cycle-${cycle + 1}-closed`)
  }
  const first = samples.find(s => s.label === 'cycle-1-closed'), second = samples.find(s => s.label === 'cycle-2-closed')
  assert.ok(second.live - first.live <= 16, `周回後の未解放バッファが増加: ${second.live - first.live}`)
  assert.equal(second.contextLosses, 0)
  assert.deepEqual(errors, [])
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ samples, errors }, null, 2))
  console.log('全ページの保持・収納を2周確認: バッファ増加、コンテキスト喪失、ブラウザーエラーなし')
} finally { await browser?.close(); await server.close() }
