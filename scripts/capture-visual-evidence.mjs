import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { isHmrNoise, servePlayerWithProject } from './lib/embedProject.mjs'

const FRAME_INTERVALS = Number(process.env.TOBIDAS_VISUAL_INTERVALS ?? 240)
const STARTUP_FRAME_COUNT = Number(process.env.TOBIDAS_STARTUP_FRAMES ?? 45)
const PROJECT_ID = process.argv[2] ?? process.env.TOBIDAS_VISUAL_PROJECT ?? 'forest_lantern'
const OUTPUT_SUFFIX = process.env.TOBIDAS_VISUAL_OUTPUT_SUFFIX ?? ''
const VIEWPORT_FILTER = new Set((process.env.TOBIDAS_VISUAL_VIEWPORTS ?? '').split(',').filter(Boolean))
const VIEWPORTS = [
  { id: 'wide-pane', width: 1485, height: 557 },
  { id: 'standard', width: 960, height: 540 },
  { id: 'portrait', width: 390, height: 844 },
].filter((viewport) => !VIEWPORT_FILTER.size || VIEWPORT_FILTER.has(viewport.id))
if (!VIEWPORTS.length) throw new Error('TOBIDAS_VISUAL_VIEWPORTS に有効な画面IDがありません')
// 127.0.0.1はIPv6バインドで接続拒否になるためlocalhostを使う。
// URLを明示しない場合は vite.config.ts の既定ポートを使う
const baseUrl = process.env.TOBIDAS_VISUAL_URL ?? await detectBaseUrl([5174])
const outDir = resolve(`qa/visual/007-${PROJECT_ID}${OUTPUT_SUFFIX}`)

async function detectBaseUrl(ports) {
  for (const port of ports) {
    const url = `http://localhost:${port}/player.html`
    try {
      const response = await fetch(url)
      if (response.ok) return url
    } catch { /* 次の候補へ */ }
  }
  return `http://localhost:${ports[ports.length - 1]}/player.html`
}

if (!Number.isInteger(FRAME_INTERVALS) || FRAME_INTERVALS < 1) throw new Error('TOBIDAS_VISUAL_INTERVALS は1以上の整数にしてください')
if (!Number.isInteger(STARTUP_FRAME_COUNT) || STARTUP_FRAME_COUNT < 1) throw new Error('TOBIDAS_STARTUP_FRAMES は1以上の整数にしてください')
try {
  const response = await fetch(baseUrl)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
} catch (error) {
  throw new Error(`開発サーバーへ接続できません。先に npm run dev を起動してください: ${baseUrl}\n${error}`)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const consoleErrors = []
const browserDiagnostics = []
const captures = []

for (const viewport of VIEWPORTS) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  page.on('console', (message) => recordConsole(message.type(), message.text(), viewport.id))
  page.on('pageerror', (error) => consoleErrors.push(`[${viewport.id}] pageerror: ${error.message}`))
  await servePlayerWithProject(page, `projects/${PROJECT_ID}`)

  const url = new URL(baseUrl)
  url.searchParams.set('progress', '0')
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
  await page.locator('canvas').waitFor({ state: 'visible' })

  // 初回mount、テクスチャ解決、Suspense復帰時の一時的な崩れを捨てない。
  const startupDir = join(outDir, 'startup', viewport.id)
  mkdirSync(startupDir, { recursive: true })
  const startupFrames = []
  const startupStartedAt = await page.evaluate(() => performance.now())
  for (let index = 0; index < STARTUP_FRAME_COUNT; index++) {
    const file = `frame-${String(index).padStart(4, '0')}.jpg`
    const path = join(startupDir, file)
    const capturedAt = await page.evaluate(() => performance.now())
    const bytes = await page.screenshot({ path, type: 'jpeg', quality: 84, fullPage: false })
    startupFrames.push(frameRecord(index, null, `startup/${viewport.id}/${file}`, bytes, capturedAt - startupStartedAt, await statusText(page)))
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(resolveFrame)))
  }
  captures.push({ kind: 'startup', viewport, frames: startupFrames })

  await page.waitForLoadState('networkidle')
  const stableDir = join(outDir, 'stable', viewport.id)
  mkdirSync(stableDir, { recursive: true })
  const stableFrames = []
  for (let index = 0; index <= FRAME_INTERVALS; index++) {
    const progress = index / FRAME_INTERVALS
    await page.evaluate((value) => {
      if (typeof window.__tobiSetScroll !== 'function') throw new Error('__tobiSetScroll がありません')
      window.__tobiSetScroll(value)
    }, progress)
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))))
    const file = `frame-${String(index).padStart(4, '0')}.jpg`
    const path = join(stableDir, file)
    const bytes = await page.screenshot({ path, type: 'jpeg', quality: 84, fullPage: false })
    stableFrames.push(frameRecord(index, progress, `stable/${viewport.id}/${file}`, bytes, null, await statusText(page)))
  }
  captures.push({ kind: 'stable', viewport, frames: stableFrames })
  await page.close()
}
await browser.close()

const contactSheets = []
for (const capture of captures) {
  const dir = join(outDir, 'contact-sheets', capture.kind, capture.viewport.id)
  mkdirSync(dir, { recursive: true })
  for (let start = 0; start < capture.frames.length; start += 20) {
    const members = capture.frames.slice(start, start + 20)
    const name = `sheet-${String(start).padStart(4, '0')}-${String(start + members.length - 1).padStart(4, '0')}.jpg`
    const result = spawnSync('magick', [
      'montage', ...members.map((frame) => join(outDir, frame.file)),
      '-thumbnail', '320x180', '-tile', '5x4', '-geometry', '+4+20',
      '-set', 'label', '%t', '-background', '#151515', '-fill', '#ffffff', join(dir, name),
    ], { encoding: 'utf8' })
    if (result.error || result.status !== 0) throw new Error(`ImageMagickによるコンタクトシート生成に失敗しました: ${result.error ?? result.stderr}`)
    contactSheets.push(`contact-sheets/${capture.kind}/${capture.viewport.id}/${name}`)
  }
}

const manifest = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  sourceUrl: baseUrl,
  viewports: VIEWPORTS,
  startupSampling: { frameCountPerViewport: STARTUP_FRAME_COUNT, rule: 'canvasの初回表示直後から、待機を挟まず screenshot → 次requestAnimationFrame' },
  progressSampling: { intervals: FRAME_INTERVALS, frameCountPerViewport: FRAME_INTERVALS + 1, formula: 'progress = frameIndex / intervals', settle: '2 requestAnimationFrame' },
  consoleErrors,
  browserDiagnostics,
  contactSheets,
  captures,
}
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
writeFileSync(join(outDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>tobidas visual evidence</title><style>body{margin:20px;background:#111;color:#eee;font:14px sans-serif}section{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}figure{margin:0}img{width:100%;display:block}figcaption{padding:5px 0 12px}</style><h1>007 ${escapeHtml(PROJECT_ID)} visual evidence</h1>${captures.map(capture => `<h2>${capture.kind} · ${capture.viewport.id} · ${capture.viewport.width}×${capture.viewport.height}</h2><section>${capture.frames.map(frame => `<figure><img src="${frame.file}" loading="lazy"><figcaption>#${String(frame.index).padStart(4, '0')} · ${frame.progress ?? `${frame.elapsedMs.toFixed(1)}ms`} · ${escapeHtml(frame.status)}</figcaption></figure>`).join('')}</section>`).join('')}`)

if (consoleErrors.length) throw new Error(`ブラウザエラーを${consoleErrors.length}件検出しました。manifest.jsonを確認してください`)
console.log(`${captures.reduce((sum, capture) => sum + capture.frames.length, 0)}フレームを保存: ${outDir}`)
console.log(`${contactSheets.length}枚のコンタクトシートを生成しました`)

function frameRecord(index, progress, file, bytes, elapsedMs, status) {
  return { index, progress: progress === null ? null : Number(progress.toFixed(6)), elapsedMs, file, status, sha256: createHash('sha256').update(bytes).digest('hex') }
}
function recordConsole(type, message, viewportId) {
  if (type !== 'error' && type !== 'warning') return
  if (isHmrNoise(message)) return
  const entry = `[${viewportId}] ${type}: ${message}`
  if (/GL Driver Message .*GPU stall due to ReadPixels/.test(message)) browserDiagnostics.push(entry)
  else consoleErrors.push(entry)
}
// 再生画面は文字を出さないので、状態はレンジの値から読む
async function statusText(page) {
  return page.getByLabel('Book progress').inputValue().catch(() => '')
}
function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
