// Development screenshot helper: start the Vite dev server and capture the player
// with an embedded work (requires Playwright: npm i -D playwright && npx playwright install chromium).
// Usage: node scripts/screenshot.mjs [--project projects/forest_lantern] [--scroll 0..1] [--out shots/shot.png]
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { QA_SERVER, servePlayerWithProject } from './lib/embedProject.mjs'

const repoRoot = process.env.TOBIDAS_CREATE_REPO_ROOT ?? process.cwd()
const requireFromRepo = createRequire(path.join(repoRoot, 'package.json'))
const playwrightModule = await import(pathToFileURL(requireFromRepo.resolve('playwright')).href)
const viteModule = await import(pathToFileURL(requireFromRepo.resolve('vite')).href)
const { chromium } = playwrightModule.default ?? playwrightModule
const { createServer } = viteModule.default ?? viteModule

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt
}
const project = flag('project', 'projects/forest_lantern')
const scroll = parseFloat(flag('scroll', '0'))
const out = flag('out', 'shots/shot.png')
const width = parseInt(flag('width', '1280'), 10)
const height = parseInt(flag('height', '800'), 10)

const server = await createServer({ configFile: 'vite.config.ts', server: QA_SERVER })
await server.listen()
const addr = server.httpServer.address()
const port = typeof addr === 'object' && addr ? addr.port : 5173

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height } })
const pkg = project.replace(/\\/g, '/').replace(/\/+$/, '')
await servePlayerWithProject(page, pkg)
await page.goto(`http://localhost:${port}/player.html`)
await page.waitForTimeout(2500)
await page.evaluate((v) => window.__tobiSetScroll?.(v), scroll)
await page.waitForTimeout(700)
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
await page.screenshot({ path: out })
await browser.close()
await server.close()
console.log(`Screenshot: ${out} (project=${project}, scroll=${scroll})`)
