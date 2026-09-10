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
const root = flag('root', 'projects')
const turnPhases = flag('turn-phases', '0.5').split(',').map(Number)
const contentTime = args.includes('--content-time') ? Number(flag('content-time')) : undefined
const ids = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
const projects = ids.length ? ids : JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'), 'utf8')).samples.map((s) => s.id)

const server = await createServer({ configFile: 'vite.config.ts', server: QA_SERVER })
await server.listen()
const port = server.httpServer.address().port
const browser = await chromium.launch()
const errors = []
const captures = [], directionChecks = []
fs.mkdirSync(path.resolve(outDir), { recursive: true })

for (const id of projects) {
  const book = JSON.parse(fs.readFileSync(path.join(root, id, 'project.json'), 'utf8')).book
  const total = book.sequence.coverOpenSeconds
    + book.spreads.reduce((s, sp) => s + sp.sequence.holdSeconds + sp.sequence.turnSeconds, 0)
  // 作品ごとに応答を差し替えるので、ページも作品ごとに開き直す
  const page = await browser.newPage({ viewport: { width, height } })
  page.on('pageerror', (e) => errors.push(`${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !isHmrNoise(m.text())) errors.push(m.text()) })
  await servePlayerWithProject(page, path.join(root, id))
  await page.goto(`http://localhost:${port}/player.html`)
  await page.waitForTimeout(2200)
  if (contentTime !== undefined) await page.evaluate((time) => window.__tobiSetContentTime(time), contentTime)
  const shots = []
  let cursor = book.sequence.coverOpenSeconds
  for (const [index, spread] of book.spreads.entries()) {
    for (const phase of phases) {
      const progress = (cursor + spread.sequence.holdSeconds * phase) / total
      const name = `${id}-s${index + 1}-p${String(phase).replace('.', '')}.png`
      shots.push({ name, progress, spread: spread.name, kind: 'hold', phase })
    }
    cursor += spread.sequence.holdSeconds
    if (args.includes('--turns')) for (const phase of turnPhases) {
      const progress = (cursor + spread.sequence.turnSeconds * phase) / total
      const name = `${id}-turn${index + 1}${turnPhases.length > 1 ? '-p' + String(phase).replace('.', '') : ''}.png`
      shots.push({ name, progress, spread: spread.name, kind: 'turn', phase })
    }
    cursor += spread.sequence.turnSeconds
  }
  const shoot = async (shot, reverse = false) => {
    await page.evaluate((v) => window.__tobiSetScroll(v), shot.progress)
    await page.waitForTimeout(450)
    const name = reverse ? shot.name.replace('.png', '-reverse.png') : shot.name
    const bytes = await page.screenshot({ path: path.join(outDir, name) })
    captures.push({ project: id, ...shot, name, direction: reverse ? 'reverse' : 'forward', contentTime })
    return bytes
  }
  for (const shot of shots) await shoot(shot)
  if (args.includes('--reverse')) for (const shot of [...shots].reverse()) {
    const bytes = await shoot(shot, true)
    if (contentTime !== undefined) directionChecks.push({ name: shot.name, identical: bytes.equals(fs.readFileSync(path.join(outDir, shot.name))) })
  }
  console.log(`${id}: ${shots.length}場面${args.includes('--reverse') ? ' × 順逆2方向' : ''}を撮影`)
  await page.close()
}
await browser.close()
await server.close()
fs.writeFileSync(path.join(outDir, 'capture-report.json'), JSON.stringify({ captures, directionChecks, errors }, null, 2))
if (directionChecks.some((check) => !check.identical)) console.warn(`順逆で画像が異なる場面: ${directionChecks.filter((check) => !check.identical).map((check) => check.name).join(', ')}`)
if (errors.length) {
  console.error(`ブラウザエラー ${errors.length} 件:\n` + [...new Set(errors)].join('\n'))
  process.exitCode = 1
}
