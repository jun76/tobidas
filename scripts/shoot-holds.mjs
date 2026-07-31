// 各見開きの保持中央 (と任意の追加時刻) を一括撮影する開発用スクリプト。
// 使い方: node scripts/shoot-holds.mjs [projectId ...] [--out shots/dir] [--phases 0.5]
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { isHmrNoise, QA_SERVER, servePlayerWithProject } from './lib/embedProject.mjs'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt
}
const outDir = flag('out', 'shots/holds')
const phases = flag('phases', '0.5').split(',').map(Number)
const width = parseInt(flag('width', '1280'), 10)
const height = parseInt(flag('height', '800'), 10)
const ids = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
const projects = ids.length ? ids : JSON.parse(fs.readFileSync('projects/catalog.json', 'utf8')).samples.map((s) => s.id)

const server = await createServer({ configFile: 'vite.config.ts', server: QA_SERVER })
await server.listen()
const port = server.httpServer.address().port
const browser = await chromium.launch()
const errors = []
fs.mkdirSync(path.resolve(outDir), { recursive: true })

for (const id of projects) {
  const book = JSON.parse(fs.readFileSync(`projects/${id}/project.json`, 'utf8')).book
  const total = book.sequence.coverOpenSeconds
    + book.spreads.reduce((s, sp) => s + sp.sequence.holdSeconds + sp.sequence.turnSeconds, 0)
  // 作品ごとに応答を差し替えるので、ページも作品ごとに開き直す
  const page = await browser.newPage({ viewport: { width, height } })
  page.on('pageerror', (e) => errors.push(`${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !isHmrNoise(m.text())) errors.push(m.text()) })
  await servePlayerWithProject(page, `projects/${id}`)
  await page.goto(`http://localhost:${port}/player.html`)
  await page.waitForTimeout(2200)
  let cursor = book.sequence.coverOpenSeconds
  for (const [index, spread] of book.spreads.entries()) {
    for (const phase of phases) {
      const progress = (cursor + spread.sequence.holdSeconds * phase) / total
      await page.evaluate((v) => window.__tobiSetScroll?.(v), progress)
      await page.waitForTimeout(450)
      const name = `${id}-s${index + 1}-p${String(phase).replace('.', '')}.png`
      await page.screenshot({ path: path.join(outDir, name) })
      console.log(`${name}  progress=${progress.toFixed(4)}  ${spread.name}`)
    }
    cursor += spread.sequence.holdSeconds
    if (args.includes('--turns')) {
      const progress = (cursor + spread.sequence.turnSeconds * 0.5) / total
      await page.evaluate((v) => window.__tobiSetScroll?.(v), progress)
      await page.waitForTimeout(450)
      const name = `${id}-turn${index + 1}.png`
      await page.screenshot({ path: path.join(outDir, name) })
      console.log(`${name}  progress=${progress.toFixed(4)}  ページ送り`)
    }
    cursor += spread.sequence.turnSeconds
  }
  await page.close()
}
await browser.close()
await server.close()
if (errors.length) {
  console.error(`ブラウザエラー ${errors.length} 件:\n` + [...new Set(errors)].join('\n'))
  process.exitCode = 1
}
