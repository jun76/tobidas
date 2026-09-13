import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { QA_SERVER, isHmrNoise } from './lib/embedProject.mjs'

const out = process.argv[2] ?? 'output/playwright/content-depth'
fs.mkdirSync(out, { recursive: true })
const server = await createServer({ configFile: 'vite.config.ts', server: QA_SERVER }); await server.listen()
const browser = await chromium.launch(), errors = [], samples = []
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error' && !isHmrNoise(m.text())) errors.push(m.text()) })
  await page.route('**/content-depth.html', route => route.fulfill({ contentType: 'text/html', body: '<style>html,body,#root{width:100%;height:100%;margin:0}</style><div id="root"></div><script type="module" src="/scripts/fixtures/content-depth.tsx"></script>' }))
  await page.goto(`http://localhost:${server.httpServer.address().port}/content-depth.html`)
  await page.waitForFunction(() => window.depthFixture?.state.ready)
  await page.waitForTimeout(800)
  for (const time of [0, 3.7, 8.1]) for (const x of [-3, 0, 3]) {
    const visible = await page.evaluate(([time, x]) => window.depthFixture.sample(false, time, x), [time, x])
    await page.screenshot({ path: `${out}/light-${time}-${x}.png` })
    const occluded = await page.evaluate(([time, x]) => window.depthFixture.sample(true, time, x), [time, x])
    samples.push({ time, x, visible, occluded })
    assert(visible > 1000, `共面の画像に光が消された: ${JSON.stringify(samples.at(-1))}`)
    assert.equal(occluded, 0, '手前の紙を光が透過した')
  }
  await page.screenshot({ path: `${out}/occluded.png` })
  assert.deepEqual(errors, [])
} finally {
  fs.writeFileSync(`${out}/report.json`, JSON.stringify({ samples, errors }, null, 2))
  await browser.close(); await server.close()
}
console.log('粒子: 3方向 × 3位相で共面表示と手前の紙による遮蔽 OK')
