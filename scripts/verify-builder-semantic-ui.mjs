import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? 'http://localhost:5174/'
const assetPath = fileURLToPath(new URL('../public/favicon.png', import.meta.url))
const audioPath = fileURLToPath(new URL('../scripts/samples/assets/audio/page-turn.wav', import.meta.url))
const samplePath = fileURLToPath(new URL('../projects/forest_lantern/', import.meta.url))
await Promise.all([access(assetPath), access(audioPath), access(samplePath)])

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()
await page.setViewportSize({ width: 1440, height: 900 })
const consoleErrors = []
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
page.on('pageerror', (error) => consoleErrors.push(String(error)))

try {
  const url = new URL(baseUrl)
  await page.goto(url.href, { waitUntil: 'networkidle' })
  const workspace = page.locator('[data-tobidas-kind="builder-workspace"]')
  await workspace.waitFor()
  await page.getByRole('tree', { name: 'BOOK ナビゲーター' }).waitFor()
  await page.getByRole('button', { name: '詳細配置', exact: true }).waitFor()
  await page.getByLabel('インスペクター').waitFor()
  if (await page.getByRole('button', { name: 'AIモード', exact: true }).count()) throw new Error('AIモード切り替えが残っています')
  for (const name of ['data-tobidas-project-id', 'data-tobidas-mode', 'data-tobidas-active-spread-id',
    'data-tobidas-selection-kind', 'data-tobidas-selection-id', 'data-tobidas-preview-progress', 'data-tobidas-state-version']) {
    if (await workspace.getAttribute(name) === null) throw new Error(`標準ワークスペースに${name}がありません`)
  }
  if (await page.locator('[data-tobidas-kind="precision-placement-form"]').count()) throw new Error('閉じた詳細配置フォームがDOMに残っています')
  if (await page.locator('[data-tobidas-kind="timeline-key-form"]').count()) throw new Error('閉じたキー追加フォームがDOMに残っています')

  const validationButton = page.getByRole('button', { name: '検証 OK', exact: true })
  await validationButton.click()
  const issueList = page.locator('[data-tobidas-kind="validation-issues"]')
  await issueList.waitFor()
  await issueList.click()
  if (!await issueList.isVisible()) throw new Error('検証一覧の内側クリックで閉じました')
  await page.getByRole('tree', { name: 'BOOK ナビゲーター' }).click()
  await issueList.waitFor({ state: 'detached' })
  await validationButton.click()
  await issueList.waitFor()
  await issueList.waitFor({ state: 'detached', timeout: 5000 })

  await page.getByLabel('読み込み').setInputFiles([assetPath, audioPath])
  const imageRow = page.locator('[data-tobidas-kind="asset"]').filter({ hasText: 'favicon' })
  const audioRow = page.locator('[data-tobidas-kind="asset"]').filter({ hasText: 'page-turn' })
  await imageRow.waitFor()
  await audioRow.waitFor()
  const importedAudioRow = page.locator('[data-tobidas-kind="asset"][data-tobidas-id="page-turn.wav"]')
  await importedAudioRow.waitFor()
  const bgmSelect = page.getByLabel('音源', { exact: true })
  if (await bgmSelect.locator('option:checked').textContent() !== 'bgm.mp3') throw new Error('新規作品のBGMがbgm.mp3ではありません')
  await bgmSelect.selectOption({ value: 'page-turn.wav' })
  const selectedBgm = await bgmSelect.inputValue()
  if (selectedBgm !== 'page-turn.wav') throw new Error(`サウンド欄からBGMを変更できません: ${selectedBgm}`)
  await importedAudioRow.getByRole('button', { name: /削除/ }).click()
  const bgmAfterDelete = await bgmSelect.inputValue()
  if (bgmAfterDelete !== '') throw new Error(`選択中の音声アセット削除後にBGMが未設定へ戻りません: ${bgmAfterDelete}`)
  if (await page.getByLabel('音量', { exact: true }).count()) throw new Error('BGM未設定でも音量入力が残っています')
  await imageRow.getByRole('button', { name: /詳細/ }).click()
  const assetDetails = page.locator('[data-tobidas-kind="asset-details"]')
  await assetDetails.waitFor()
  const detailsText = await assetDetails.innerText()
  if (!detailsText.includes('image/png') || !detailsText.includes('アセットID') || !detailsText.includes('参照数')) {
    throw new Error(`アセット詳細が不足しています:\n${detailsText}`)
  }
  await assetDetails.getByRole('button', { name: 'OK' }).click()

  await page.getByRole('button', { name: '詳細配置' }).click()
  const placement = page.locator('[data-tobidas-kind="precision-placement-form"]')
  await placement.waitFor()
  if (await placement.getAttribute('toolname') !== 'tobidas-place-asset-form') throw new Error('詳細配置の宣言的toolnameがありません')
  const faviconOption = placement.getByLabel('画像・動画アセット').locator('option').filter({ hasText: 'favicon' })
  await placement.getByLabel('画像・動画アセット').selectOption(await faviconOption.getAttribute('value'))
  await placement.getByLabel('位置 u（0=背表紙、1=小口）').fill('0.25')
  await placement.getByLabel('位置 v（0=奥、1=手前）').fill('0.60')
  await placement.getByRole('button', { name: '配置する' }).click()
  await page.waitForFunction(() => document.querySelector('[data-tobidas-kind="builder-workspace"]')?.getAttribute('data-tobidas-selection-kind') === 'element')
  const selectedId = await workspace.getAttribute('data-tobidas-selection-id')
  if (!selectedId) throw new Error('配置した部品IDを標準ワークスペースから取得できません')
  const operationResult = page.locator('[data-tobidas-kind="operation-result"]')
  const placementResult = JSON.parse(await operationResult.textContent())
  if (!placementResult.ok || placementResult.target?.id !== selectedId) throw new Error('配置結果のライブ領域が更新されていません')

  await page.getByRole('button', { name: '親を変更' }).click()
  const parentForm = page.locator('[data-tobidas-kind="element-parent-form"]')
  await parentForm.getByLabel('親').selectOption('left-page')
  await parentForm.getByRole('button', { name: '親を変更' }).click()
  const selectedRow = page.locator(`[data-tobidas-kind="element"][data-tobidas-id="${selectedId}"]`)
  await selectedRow.waitFor()

  await page.getByRole('button', { name: 'キーを追加', exact: true }).click()
  const keyForm = page.locator('[data-tobidas-kind="timeline-key-form"]')
  await keyForm.waitFor()
  await keyForm.getByLabel('時刻（秒）').fill('0.5')
  await keyForm.getByLabel('値').fill('0.2')
  await keyForm.getByLabel('補間').selectOption('easeInOut')
  await keyForm.getByRole('button', { name: 'キーを追加', exact: true }).click()
  const timelineKey = page.locator('[data-tobidas-kind="timeline-key"]').first()
  await timelineKey.waitFor()
  if (!await timelineKey.getAttribute('data-tobidas-track-id')) throw new Error('タイムラインキーのトラックIDがありません')

  await page.getByRole('button', { name: '元に戻す' }).click()
  await page.getByRole('button', { name: 'やり直す' }).click()

  const mobile = await context.newPage()
  await mobile.setViewportSize({ width: 415, height: 900 })
  await mobile.goto(url.href, { waitUntil: 'networkidle' })
  if (await mobile.locator('[data-tobidas-kind="precision-placement-form"]').count()) throw new Error('モバイルで閉じた詳細配置が露出しています')
  await mobile.getByRole('button', { name: '部品プリセット', exact: true }).click()
  await mobile.getByRole('button', { name: '詳細配置' }).click()
  await mobile.locator('[data-tobidas-kind="precision-placement-form"]').waitFor()
  const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  if (mobileOverflow) throw new Error('モバイル幅で横スクロールが発生しています')
  await mobile.getByRole('button', { name: 'キャンセル' }).click()
  await mobile.close()

  const samplePage = await context.newPage()
  samplePage.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  samplePage.on('pageerror', (error) => consoleErrors.push(String(error)))
  await samplePage.goto(url.href, { waitUntil: 'networkidle' })
  await samplePage.evaluate(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.id = 'sample-package-input'
    input.setAttribute('webkitdirectory', '')
    document.body.append(input)
  })
  await samplePage.locator('#sample-package-input').setInputFiles(samplePath)
  const sample = await samplePage.evaluate(async () => {
    const input = document.querySelector('#sample-package-input')
    const module = await import(`/src/builder/io/packageImport.ts?verify=${Date.now()}`)
    const loaded = await module.importPackageFileList(input.files)
    const store = await import('/src/builder/store.ts')
    store.useBuilderStore.getState().setProject(loaded.project, 'import')
    return loaded.project.name
  })
  if (sample !== 'Chasing the Forest Lantern') throw new Error(`forest_lanternの作品名が一致しません: ${sample}`)
  await samplePage.locator('[data-tobidas-kind="builder-workspace"][data-tobidas-active-spread-id]').waitFor()

  if (consoleErrors.length) throw new Error(`ブラウザコンソールエラー:\n${consoleErrors.join('\n')}`)
  console.log(`標準UI意味操作検査 OK: ${selectedId}; desktop/mobile; forest_lantern 読み込み OK`)
} finally {
  await context.close()
  await browser.close()
}
