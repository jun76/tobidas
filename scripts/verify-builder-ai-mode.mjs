import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? 'http://localhost:5174/'
const assetPath = fileURLToPath(new URL('../public/favicon.png', import.meta.url))
const audioPath = fileURLToPath(new URL('../scripts/samples/assets/audio/page-turn.wav', import.meta.url))
const samplePath = fileURLToPath(new URL('../projects/forest_lantern/', import.meta.url))
await access(assetPath)
await access(audioPath)
await access(samplePath)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()
await page.setViewportSize({ width: 1440, height: 900 })
const consoleErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => consoleErrors.push(String(error)))

try {
  const url = new URL(baseUrl)
  url.searchParams.set('ai', '1')
  await page.goto(url.href, { waitUntil: 'networkidle' })

  const workspace = page.getByRole('main', { name: 'AIブラウザ操作ワークスペース' })
  const panel = page.getByRole('region', { name: 'AIブラウザ操作用' })
  const controlPane = page.getByLabel('AI操作ペイン')
  const viewportPane = page.getByRole('region', { name: '作品ビューポート' })
  await workspace.waitFor()
  await panel.waitFor()
  await viewportPane.waitFor()
  const [workspaceBox, controlBox, viewportBox] = await Promise.all([
    workspace.boundingBox(), controlPane.boundingBox(), viewportPane.boundingBox(),
  ])
  if (!workspaceBox || !controlBox || !viewportBox) throw new Error('AIワークスペースの寸法を取得できません')
  const controlRatio = controlBox.width / workspaceBox.width
  if (controlRatio < 0.30 || controlRatio > 0.37) throw new Error(`操作ペイン幅が1/3から外れています: ${controlRatio}`)
  if (viewportBox.width < controlBox.width * 1.8) throw new Error('ビューポートが操作ペインの約2倍ありません')
  if (await page.getByText('BOOK ナビゲーター', { exact: true }).count()) throw new Error('通常ナビゲーターがAIモードに残っています')
  if (await page.getByText('部品プリセット', { exact: true }).count()) throw new Error('通常プリセットがAIモードに残っています')
  if (await page.getByLabel('見開き保持時刻', { exact: true }).count()) throw new Error('通常タイムラインがAIモードに残っています')
  if (await panel.getByRole('button', { name: '検証結果', exact: true }).count()) throw new Error('効果のない検証更新ボタンが残っています')
  await page.getByRole('treeitem', { name: /見開き 1/ }).first().waitFor()

  await page.getByLabel('読み込み').setInputFiles([assetPath, audioPath])
  const assetOption = panel.getByLabel('画像アセット').locator('option').filter({ hasText: 'favicon' })
  await assetOption.waitFor({ state: 'attached' })
  await panel.getByText('アセット一覧', { exact: true }).click()
  try {
    await page.waitForFunction(() => {
      const row = document.querySelector('[data-tobidas-kind="asset"][data-tobidas-id="page-turn.wav"]')
      return row && /\d+\.\d{2}s/.test(row.textContent ?? '')
    })
  } catch {
    throw new Error(`音声の再生時間を確認できません:\n${await panel.innerText()}\n${consoleErrors.join('\n')}`)
  }
  await panel.getByLabel('画像アセット').selectOption(await assetOption.getAttribute('value'))
  await panel.getByLabel('位置 u（0=背表紙、1=小口）').fill('0.25')
  await panel.getByLabel('位置 v（0=奥、1=手前）').fill('0.6')
  await panel.getByRole('button', { name: '画像を直接配置' }).click()
  await panel.getByText(/配置しました/).waitFor()

  const selectedId = await panel.locator('[data-tobidas-kind="element"][aria-selected="true"]').getAttribute('data-tobidas-id')
  if (!selectedId) throw new Error('配置した部品IDをDOMから取得できません')

  await panel.getByLabel('名前').fill('AI placed part')
  await panel.getByLabel('位置 Y').fill('-5')
  const updateButton = panel.getByRole('button', { name: '部品を更新' })
  const updateForm = updateButton.locator('xpath=ancestor::form')
  if (!await updateForm.evaluate((form) => form.checkValidity())) {
    const invalid = await updateForm.locator(':invalid').evaluateAll((elements) => elements.map((element) => ({
      name: element.getAttribute('name'),
      value: element.value,
      message: element.validationMessage,
    })))
    throw new Error(`部品更新フォームが不正です: ${JSON.stringify(invalid)}`)
  }
  await updateButton.click()
  try {
    await panel.getByText(/更新しました/).waitFor({ timeout: 5000 })
  } catch {
    throw new Error(`部品更新の結果を確認できません:\n${consoleErrors.join('\n')}\n${await panel.innerText()}`)
  }
  if (await panel.getByLabel('名前').inputValue() !== 'AI placed part') throw new Error('部品名の更新が反映されていません')

  await panel.getByRole('button', { name: '元に戻す' }).click()
  await panel.locator(`[data-tobidas-id="${selectedId}"]`).click()
  await panel.getByRole('button', { name: '再生', exact: true }).click()
  await panel.getByText('再生（読み取り専用）').waitFor()
  await viewportPane.getByRole('button', { name: '再生', exact: true }).waitFor()
  await viewportPane.getByRole('slider', { name: '作品進行' }).waitFor()
  if (await panel.getByRole('button', { name: '部品を更新' }).isEnabled()) {
    throw new Error('再生モード中に部品更新が有効です')
  }
  if (await panel.getByRole('button', { name: '画像を直接配置' }).isEnabled()) {
    throw new Error('再生モード中に直接配置が有効です')
  }

  await page.getByRole('button', { name: '通常モードへ戻る' }).click()
  await page.getByRole('tree', { name: 'BOOK ナビゲーター' }).waitFor()
  await page.getByRole('region', { name: new RegExp(selectedId) }).waitFor()

  const narrowPage = await context.newPage()
  await narrowPage.setViewportSize({ width: 900, height: 900 })
  await narrowPage.goto(url.href, { waitUntil: 'networkidle' })
  const narrowControl = await narrowPage.getByLabel('AI操作ペイン').boundingBox()
  const narrowViewport = await narrowPage.getByRole('region', { name: '作品ビューポート' }).boundingBox()
  if (!narrowControl || !narrowViewport) throw new Error('狭幅AIワークスペースの寸法を取得できません')
  if (narrowViewport.y <= narrowControl.y || narrowViewport.width !== narrowControl.width) {
    throw new Error('狭幅で操作ペインとビューポートが縦配置になっていません')
  }

  const samplePage = await context.newPage()
  samplePage.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
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
    return { name: loaded.project.name, errors: loaded.notices }
  })
  if (sample.name !== 'Chasing the Forest Lantern') throw new Error(`forest_lanternの作品名が一致しません: ${sample.name}`)
  const samplePanel = samplePage.getByRole('region', { name: 'AIブラウザ操作用' })
  await samplePanel.getByText('アセット一覧', { exact: true }).click()
  await samplePage.waitForFunction(() => {
    const row = document.querySelector('[data-tobidas-kind="asset"][data-tobidas-id="page-turn.wav"]')
    return row && /\d+\.\d{2}s/.test(row.textContent ?? '')
  })

  if (consoleErrors.length) throw new Error(`ブラウザコンソールエラー:\n${consoleErrors.join('\n')}`)
  console.log(`AIモード検査 OK: ${selectedId}; forest_lantern 読み込み OK`)
} finally {
  await context.close()
  await browser.close()
}
