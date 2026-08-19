import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { injectProject, isHmrNoise, QA_SERVER, servePlayerWithProject } from './lib/embedProject.mjs'

const moviePath = path.resolve(process.argv[2] ?? 'ref/movie.mp4')
if (!fs.existsSync(moviePath)) throw new Error(`検査動画がありません: ${moviePath}`)
const stat = fs.statSync(moviePath)
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tobidas-video-qa-'))
const assetsDirectory = path.join(temporary, 'assets')
fs.mkdirSync(assetsDirectory)
fs.copyFileSync(moviePath, path.join(assetsDirectory, 'movie.mp4'))
fs.writeFileSync(path.join(temporary, 'project.json'), JSON.stringify(videoProject(stat.size), null, 2))

const outputDirectory = path.resolve('output/playwright')
fs.mkdirSync(outputDirectory, { recursive: true })
const server = await createServer({ configFile: 'vite.config.ts', server: QA_SERVER })
await server.listen()
const address = server.httpServer.address()
const port = typeof address === 'object' && address ? address.port : 5173
const browser = await chromium.launch()
const errors = []

try {
  await verifyPlayer(browser, port, temporary, errors)
  await verifyStaticPlayer(browser, port, moviePath, stat.size, errors)
  await verifyBuilder(browser, port, moviePath, errors)
} finally {
  await browser.close()
  await server.close()
  fs.rmSync(temporary, { recursive: true, force: true })
}

if (errors.length) throw new Error(`動画ブラウザ検査でエラー:\n${errors.join('\n')}`)
console.log('動画: MP4取込・配置・フレーム更新・Blob再読込・位置音源・全体消音を確認')

async function verifyPlayer(browser, port, projectDirectory, errors) {
  const context = await browser.newContext({ viewport: { width: 960, height: 640 } })
  const page = await context.newPage()
  collectErrors(page, errors, 'player')
  await installMediaProbe(page)
  await servePlayerWithProject(page, projectDirectory)
  await page.goto(`http://localhost:${port}/player.html`, { waitUntil: 'networkidle' })
  await page.evaluate(() => window.__tobiSetScroll?.(.28))
  await page.waitForTimeout(900)

  const paused = await mediaState(page)
  if (!paused.videos.length || paused.videos.some((video) => !video.paused)) {
    throw new Error('プレイヤーの一時停止中に動画が停止していません')
  }
  if (paused.videos.some((video) => !video.muted)) throw new Error('利用者操作前に動画音声が解除されています')
  const before = await page.locator('canvas').screenshot()
  await page.waitForTimeout(550)
  const after = await page.locator('canvas').screenshot()
  if (!before.equals(after)) throw new Error('プレイヤーの一時停止中に動画フレームが変化しています')

  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForTimeout(900)
  const initial = await mediaState(page)
  if (!initial.videos.some((video) => video.currentTime > 0)) {
    throw new Error('プレイヤーの動画要素が再生されていません')
  }
  if (initial.mediaSources !== 1 || initial.panners !== 1) {
    throw new Error(`動画音源の生成数が不正です: source=${initial.mediaSources}, panner=${initial.panners}`)
  }
  const panner = initial.pannerValues[0]
  if (!panner || panner.distanceModel !== 'inverse' || panner.panningModel !== 'HRTF'
    || Math.abs(panner.refDistance - 4) > .001 || Math.abs(panner.rolloffFactor - 1) > .001) {
    throw new Error(`位置音源の減衰設定が不正です: ${JSON.stringify(panner)}`)
  }
  if (![panner.x, panner.y, panner.z].every(Number.isFinite)) {
    throw new Error(`位置音源が世界座標へ追従していません: ${JSON.stringify(panner)}`)
  }

  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.waitForTimeout(100)
  const pausedBeforeSeek = await mediaState(page)
  await page.evaluate(() => window.__tobiSetScroll?.(.5))
  await page.waitForTimeout(550)
  const pausedAfterSeek = await mediaState(page)
  if (pausedAfterSeek.videos.some((video) => !video.paused)
    || pausedAfterSeek.videos.some((video, index) => Math.abs(video.currentTime
      - (pausedBeforeSeek.videos[index]?.currentTime ?? video.currentTime)) > .02)) {
    throw new Error('一時停止中の手動シークで動画が再生されています')
  }
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForTimeout(150)
  const audible = await mediaState(page)
  if (!audible.videos.some((video) => !video.muted)) throw new Error('再生操作後も動画内蔵音声が解除されません')

  await page.getByRole('button', { name: 'Mute audio' }).click()
  await page.waitForTimeout(50)
  if ((await mediaState(page)).videos.some((video) => !video.muted)) {
    throw new Error('全体消音後も動画内蔵音声が有効です')
  }
  await page.screenshot({ path: path.join(outputDirectory, 'video-player.png') })
  await context.close()
}

async function verifyBuilder(browser, port, inputMovie, errors) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  collectErrors(page, errors, 'builder')
  await installMediaProbe(page)
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' })
  await page.locator('input[type="file"][multiple]').setInputFiles(inputMovie)
  const assetRow = page.locator('[data-tobidas-kind="asset"][data-tobidas-id="movie.mp4"]')
  await assetRow.waitFor()
  const text = await assetRow.innerText()
  if (!text.includes('1344×768') || !text.includes('5.')) {
    throw new Error(`動画メタデータが一覧へ反映されません: ${text}`)
  }

  await page.getByRole('button', { name: /平積み/ }).click()
  const rowBox = await assetRow.boundingBox()
  const canvasBox = await page.locator('canvas').boundingBox()
  if (!rowBox || !canvasBox) throw new Error('動画をドラッグする座標を取得できません')
  await page.mouse.move(rowBox.x + rowBox.width * .55, rowBox.y + rowBox.height * .5)
  await page.mouse.down()
  await page.mouse.move(canvasBox.x + canvasBox.width * .65, canvasBox.y + canvasBox.height * .58, { steps: 8 })
  await page.mouse.up()

  const audioToggle = page.getByLabel('内蔵音声を鳴らす')
  await audioToggle.waitFor({ timeout: 4_000 })
  await audioToggle.check()
  await page.getByRole('button', { name: '再生', exact: true }).click()
  await page.waitForTimeout(500)
  const state = await mediaState(page)
  if (state.mediaSources < 1 || state.panners < 1) throw new Error('ビルダー再生モードで位置音源が作られません')
  await page.screenshot({ path: path.join(outputDirectory, 'video-builder.png') })

  await page.getByRole('button', { name: '編集', exact: true }).click()
  await page.getByText('自動保存済み').waitFor({ timeout: 5_000 })
  const bodyPutsBefore = await page.evaluate(() => window.__tobidasVideoQa.bodyPuts)
  await page.getByLabel(/動画音量倍率/).fill('1.5')
  await page.getByText('自動保存中…').waitFor({ timeout: 2_000 })
  await page.getByText('自動保存済み').waitFor({ timeout: 5_000 })
  const bodyPutsAfter = await page.evaluate(() => window.__tobidasVideoQa.bodyPuts)
  if (bodyPutsAfter !== bodyPutsBefore) {
    throw new Error(`メタデータ編集で動画Blobが再保存されました: ${bodyPutsBefore} → ${bodyPutsAfter}`)
  }
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('[data-tobidas-kind="asset"][data-tobidas-id="movie.mp4"]').waitFor({ timeout: 5_000 })
  await page.waitForTimeout(500)
  if (!(await mediaState(page)).videos.length) throw new Error('IndexedDB再読込後に動画要素が復元されません')
  await context.close()
}

async function verifyStaticPlayer(browser, port, inputMovie, bytes, errors) {
  const context = await browser.newContext({ viewport: { width: 960, height: 640 } })
  const page = await context.newPage()
  collectErrors(page, errors, 'static-player')
  await installMediaProbe(page)
  const project = videoProject(bytes)
  project.assets[0].data = './assets/movie.mp4'
  await page.route('**/assets/movie.mp4', (route) => route.fulfill({
    status: 200,
    contentType: 'video/mp4',
    body: fs.readFileSync(inputMovie),
  }))
  await page.route('**/player.html*', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      status: response.status(),
      contentType: 'text/html; charset=utf-8',
      body: injectProject(await response.text(), project),
    })
  })
  await page.goto(`http://localhost:${port}/player.html?static-video=1`, { waitUntil: 'networkidle' })
  await page.evaluate(() => window.__tobiSetScroll?.(.28))
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForTimeout(150)
  const before = await page.locator('canvas').screenshot()
  await page.waitForTimeout(450)
  const after = await page.locator('canvas').screenshot()
  if (before.equals(after)) throw new Error('静的ホスト形式の相対URL動画が更新されません')
  const state = await mediaState(page)
  if (state.mediaSources !== 1 || state.panners !== 1) {
    throw new Error('静的ホスト形式で動画内蔵音声が位置音源へ接続されません')
  }
  await context.close()
}

function collectErrors(page, errors, label) {
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !isHmrNoise(message.text())) {
      const location = message.location()
      errors.push(`${label}: ${message.text()} (${location.url}:${location.lineNumber})`)
    }
  })
}

async function installMediaProbe(page) {
  await page.addInitScript(() => {
    const probe = { videos: [], mediaSources: 0, panners: 0, pannerNodes: [], bodyPuts: 0 }
    window.__tobidasVideoQa = probe
    const create = Document.prototype.createElement
    Document.prototype.createElement = function (name, options) {
      const element = create.call(this, name, options)
      if (String(name).toLowerCase() === 'video') probe.videos.push(element)
      return element
    }
    const idbPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'asset-bodies') probe.bodyPuts++
      return idbPut.apply(this, args)
    }
    const Context = window.AudioContext || window.webkitAudioContext
    if (!Context) return
    const media = Context.prototype.createMediaElementSource
    Context.prototype.createMediaElementSource = function (element) {
      probe.mediaSources++
      return media.call(this, element)
    }
    const panner = Context.prototype.createPanner
    Context.prototype.createPanner = function () {
      probe.panners++
      const node = panner.call(this)
      probe.pannerNodes.push(node)
      return node
    }
  })
}

async function mediaState(page) {
  return page.evaluate(() => {
    const probe = window.__tobidasVideoQa
    return {
      mediaSources: probe.mediaSources,
      panners: probe.panners,
      videos: probe.videos.map((video) => ({
        currentTime: video.currentTime,
        duration: video.duration,
        muted: video.muted,
        paused: video.paused,
        width: video.videoWidth,
        height: video.videoHeight,
      })),
      pannerValues: probe.pannerNodes.map((node) => ({
        distanceModel: node.distanceModel,
        panningModel: node.panningModel,
        refDistance: node.refDistance,
        rolloffFactor: node.rolloffFactor,
        x: node.positionX?.value,
        y: node.positionY?.value,
        z: node.positionZ?.value,
      })),
    }
  })
}

function videoProject(bytes) {
  return {
    id: 'video-qa',
    name: 'Video QA',
    updatedAt: new Date().toISOString(),
    assets: [{
      id: 'movie.mp4', name: 'movie', type: 'video', mime: 'video/mp4',
      bytes, width: 1344, height: 768, duration: 5.167,
    }],
    book: {
      sequence: { coverOpenSeconds: 1 },
      format: { pageAspect: 1.25, pageWidth: 8, coverThickness: .18, pageThickness: .015, gutter: .08, binding: 'left' },
      appearance: { paperColor: '#f4ecd8', edgeColor: '#c9b99b', roughness: .9, background: '#20314b', shadowOpacity: .35 },
      camera: { position: [0, 5.5, 12], target: [0, .8, 0], fov: 42 },
      lights: {
        ambient: { color: '#ffffff', intensity: 1.2 },
        directional: { color: '#ffffff', intensity: 1.8, position: [-4, 10, 6] },
      },
      frontCover: {},
      spreads: [{
        id: 'spread-video', name: 'Video spread', leftPage: {}, rightPage: {},
        sequence: { holdSeconds: 7, turnSeconds: 1 }, timeline: { tracks: [] },
        elements: [{
          id: 'movie-part', name: 'movie', type: 'visual', visible: true, opacity: 1,
          parent: { type: 'right-page' },
          // 右ページ座標の背側へ寄せ、中央線で左右二翼に分割される平置き動画も通す。
          baseTransform: { position: [-4, 0, -.9], rotation: [90, 0, 0], scale: [1, 1, 1] },
          pivot: [.5, 0], layer: 0, motion: [], clock: 'visible-elapsed',
          stow: { fallDirection: 'auto', stagger: 0 },
          width: 5, height: 2.857, billboard: false,
          backgroundColor: '#00000000', foregroundColor: '#ffffff', image: 'movie.mp4',
          text: 'VIDEO', fontSize: .35, align: 'center', font: 'rounded', bold: true, italic: false, underline: false,
          particles: { enabled: false, color: '#fff3a0', count: 6, size: .45, drift: .05, period: 11 },
        }],
      }],
      backCover: {},
    },
  }
}
