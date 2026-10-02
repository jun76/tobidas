// 標準ビルダーを意味付きDOMとARIAだけで操作できるかを確かめる。座標を推定する操作は部品の配置1回に限る。
// 使い方: node scripts/verify-builder-semantic-ui.mjs [--url http://localhost:5174/]
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { QA_SERVER } from './lib/embedProject.mjs'

const args = process.argv.slice(2)
const assetPath = fileURLToPath(new URL('../public/favicon.png', import.meta.url))
const audioPath = fileURLToPath(new URL('../scripts/samples/assets/audio/page-turn.wav', import.meta.url))
const samplePath = fileURLToPath(new URL('../projects/forest_lantern/', import.meta.url))
await Promise.all([access(assetPath), access(audioPath), access(samplePath)])

// URLを渡さなければ専用の開発サーバーを立てる。編集中のHMRに左右されない状態で検査する。
const server = args.includes('--url') ? undefined : await createServer({ configFile: 'vite.config.ts', server: QA_SERVER })
if (server) await server.listen()
const baseUrl = args.includes('--url') ? args[args.indexOf('--url') + 1] : `http://localhost:${server.httpServer.address().port}/`
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ locale: 'ja-JP' })
const consoleErrors = []
const watch = (page) => {
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))
}
const fail = (message) => { throw new Error(message) }
/** HOMEから絵本の編集画面を開く */
const openBookEditor = async (page, label = '絵本作品を編集') => {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.locator('[data-tobidas-kind="builder-workspace"]').waitFor()
}
/** HOMEの設定から表示言語を変える */
const switchLanguage = async (page, home, settings, language, back) => {
  await page.getByRole('button', { name: home, exact: true }).click()
  await page.getByRole('button', { name: settings, exact: true }).click()
  // タイルはマウスを乗せると浮き上がる演出があり、位置の安定を待つと終わらないので待たずに選ぶ
  await page.getByRole('radio', { name: language, exact: true }).check({ force: true })
  await page.getByRole('button', { name: back, exact: true }).click()
}
const tab = (page, name) => page.getByRole('tab', { name, exact: true })

try {
  const page = await context.newPage()
  watch(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await openBookEditor(page)
  const workspace = page.locator('[data-tobidas-kind="builder-workspace"]')
  await page.getByRole('tree', { name: 'BOOK ナビゲーター' }).waitFor()

  // 左サイドバーのタブ。縦向きのタブリストとして公開し、矢印キーで移れる
  const tablist = page.getByRole('tablist', { name: '編集する項目', exact: true })
  await tablist.waitFor()
  if (await tablist.getAttribute('aria-orientation') !== 'vertical') fail('サイドバーのタブリストが縦向きではありません')
  const tabNames = await tablist.getByRole('tab').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')))
  const expectedTabs = ['作品', '部品', 'アセット', '選択中', 'サウンド', 'カメラ', 'ライティング', '制作ガイド']
  if (tabNames.join() !== expectedTabs.join()) fail(`サイドバーのタブが不正です: ${tabNames.join(', ')}`)
  await tab(page, '作品').click()
  await page.keyboard.press('ArrowDown')
  if (await tab(page, '部品').getAttribute('aria-selected') !== 'true') fail('矢印キーでサイドバーのタブを移れません')
  if (await page.locator('[data-tobidas-kind="sidebar"]').getAttribute('data-tobidas-sidebar-tab') !== 'parts') fail('サイドバーの現在のタブが属性へ出ていません')

  // 上段のナビゲーターと下段のタブの境界をドラッグできる
  const handle = page.getByRole('separator', { name: 'BOOK ナビゲーターの高さ', exact: true })
  const navigatorPane = page.locator('#sidebar-navigator-mobile-pane')
  const before = await navigatorPane.boundingBox(), handleBox = await handle.boundingBox()
  if (!before || !handleBox) fail('サイドバーの境界を取得できません')
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2 + 32)
  await page.mouse.up()
  const after = await navigatorPane.boundingBox()
  if (!after || after.height <= before.height) fail('サイドバーの境界をドラッグできません')

  // 制作ガイド。タブを切り替えても入力欄は残る
  const authoringGuide = page.locator('[data-tobidas-kind="authoring-guide"]')
  const guideFields = authoringGuide.locator('textarea')
  if (await guideFields.count() !== 17) fail(`制作ガイドの入力項目数が不正です: ${await guideFields.count()}`)
  await tab(page, '制作ガイド').click()
  const guideField = guideFields.first()
  const guideText = await guideField.inputValue()
  await guideField.fill(`${guideText} test`)
  await guideField.blur()
  await guideField.fill(guideText)
  await guideField.blur()

  // 表示言語はHOMEの設定で切り替える。制作ガイドは言語ごとの本文を表示する
  await switchLanguage(page, 'HOME', '設定', 'English', 'HOME')
  await openBookEditor(page, 'Edit picture book')
  await page.waitForFunction(() => [...document.querySelectorAll('[data-tobidas-kind="authoring-guide"] textarea')][0]?.value.includes('A gentle '))
  await switchLanguage(page, 'HOME', 'Settings', '日本語', 'HOME')
  await openBookEditor(page)
  await page.waitForFunction(() => [...document.querySelectorAll('[data-tobidas-kind="authoring-guide"] textarea')][0]?.value.includes('子どもから大人まで'))

  if (await page.getByRole('button', { name: 'AIモード', exact: true }).count()) fail('AIモード切り替えが残っています')
  if (await page.locator('header select, [data-tobidas-kind="builder-workspace"] ~ select').count()) fail('ヘッダーに表示言語のプルダウンが残っています')
  for (const name of ['data-tobidas-project-id', 'data-tobidas-mode', 'data-tobidas-active-spread-id',
    'data-tobidas-selection-kind', 'data-tobidas-selection-id', 'data-tobidas-preview-progress', 'data-tobidas-state-version']) {
    if (await workspace.getAttribute(name) === null) fail(`標準ワークスペースに${name}がありません`)
  }
  if (await page.locator('[data-tobidas-kind="timeline-key-form"]').count()) fail('閉じたキー追加フォームがDOMに残っています')

  // ヘッダーのプルダウン
  const menuItems = async (label) => {
    const button = page.getByRole('button', { name: label, exact: true })
    await button.click()
    const items = await button.locator('xpath=..').locator('button').evaluateAll((buttons) => buttons.slice(1).map((item) => item.textContent.trim()))
    await button.click()
    return items.join(' / ')
  }
  const menus = { 開く: 'フォルダを開く / 作品ZIPを開く', 保存: 'フォルダとして保存 / 作品ZIPとして保存',
    エクスポート: '単一HTMLファイルとしてエクスポート / 静的ホスト用ZIPとしてエクスポート' }
  for (const [label, expected] of Object.entries(menus)) {
    const items = await menuItems(label)
    if (items !== expected) fail(`${label}メニューの項目が不正です: ${items}`)
  }

  // 検証一覧は内側のクリックでは閉じず、外側のクリックと時間で閉じる
  const validationButton = page.getByRole('button', { name: '検証 OK', exact: true })
  await validationButton.click()
  const issueList = page.locator('[data-tobidas-kind="validation-issues"]')
  await issueList.waitFor()
  await issueList.click()
  if (!await issueList.isVisible()) fail('検証一覧の内側クリックで閉じました')
  await page.getByRole('tree', { name: 'BOOK ナビゲーター' }).click()
  await issueList.waitFor({ state: 'detached' })
  await validationButton.click()
  await issueList.waitFor()
  await issueList.waitFor({ state: 'detached', timeout: 5000 })

  // アセットの読み込みとBGM
  await tab(page, 'アセット').click()
  await page.locator('#sidebar-panel-assets').getByLabel('読み込み', { exact: true }).setInputFiles([assetPath, audioPath])
  const imageRow = page.locator('[data-tobidas-kind="asset"]').filter({ hasText: 'favicon' })
  const importedAudioRow = page.locator('[data-tobidas-kind="asset"][data-tobidas-id="page-turn.wav"]')
  await imageRow.waitFor()
  await importedAudioRow.waitFor()
  await tab(page, 'サウンド').click()
  const bgmSelect = page.getByLabel('音源', { exact: true })
  if (await bgmSelect.locator('option:checked').textContent() !== 'bgm.mp3') fail('新規作品のBGMがbgm.mp3ではありません')
  await bgmSelect.selectOption({ value: 'page-turn.wav' })
  if (await bgmSelect.inputValue() !== 'page-turn.wav') fail('サウンドのタブからBGMを変更できません')
  await tab(page, 'アセット').click()
  await importedAudioRow.getByRole('button', { name: /削除/ }).click()
  await tab(page, 'サウンド').click()
  if (await bgmSelect.inputValue() !== '') fail('選択中の音声アセット削除後にBGMが未設定へ戻りません')
  if (await page.getByLabel('音量', { exact: true }).count()) fail('BGM未設定でも音量入力が残っています')
  await tab(page, 'アセット').click()
  await imageRow.getByRole('button', { name: /詳細/ }).click()
  const assetDetails = page.locator('[data-tobidas-kind="asset-details"]')
  await assetDetails.waitFor()
  const detailsText = await assetDetails.innerText()
  if (!detailsText.includes('image/png') || !detailsText.includes('アセットID') || !detailsText.includes('参照数')) fail(`アセット詳細が不足しています:\n${detailsText}`)
  await assetDetails.getByRole('button', { name: 'OK' }).click()

  // 値と時刻を指定するタイムラインキー。作品全体の環境を対象にする
  await page.getByRole('button', { name: 'キーを追加', exact: true }).click()
  const keyForm = page.locator('[data-tobidas-kind="timeline-key-form"]')
  await keyForm.waitFor()
  await keyForm.getByLabel('対象トラック').selectOption('environment')
  await keyForm.getByLabel('プロパティ').selectOption('ambient.intensity')
  await keyForm.getByLabel('時刻（秒）').fill('0.5')
  await keyForm.getByLabel('値').fill('0.6')
  await keyForm.getByLabel('補間').selectOption('easeInOut')
  await keyForm.getByRole('button', { name: 'キーを追加', exact: true }).click()
  await keyForm.waitFor({ state: 'detached' })
  const keyResult = JSON.parse(await page.locator('[data-tobidas-kind="operation-result"]').textContent())
  if (!keyResult.ok) fail(`キー追加の結果がライブ領域へ出ていません: ${JSON.stringify(keyResult)}`)

  // 部品の配置。部品タブは配置を続けられるよう、選択しても切り替わらない
  await tab(page, '部品').click()
  await page.getByRole('button', { name: 'テキスト', exact: true }).click()
  const canvas = await page.locator('[data-viewport-root] canvas').boundingBox()
  await page.mouse.move(canvas.x + canvas.width * .66, canvas.y + canvas.height * .5)
  await page.waitForTimeout(350)
  await page.mouse.click(canvas.x + canvas.width * .66, canvas.y + canvas.height * .5)
  await page.waitForFunction(() => document.querySelector('[data-tobidas-kind="builder-workspace"]')?.getAttribute('data-tobidas-selection-kind') === 'element', null, { timeout: 15000 })
  const selectedId = await workspace.getAttribute('data-tobidas-selection-id')
  if (await tab(page, '部品').getAttribute('aria-selected') !== 'true') fail('配置後に部品タブから切り替わりました')
  await page.locator(`[data-tobidas-kind="element"][data-tobidas-id="${selectedId}"]`).waitFor()
  await tab(page, '選択中').click()
  await page.locator('#sidebar-panel-selection [data-tobidas-kind="placed-part-inspector"]').waitFor()

  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  await page.locator(`[data-tobidas-kind="element"][data-tobidas-id="${selectedId}"]`).waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'やり直す', exact: true }).click()
  await page.locator(`[data-tobidas-kind="element"][data-tobidas-id="${selectedId}"]`).waitFor()

  // 狭幅ではナビゲーターと編集項目を見出しで開閉する
  const mobile = await context.newPage()
  watch(mobile)
  await mobile.setViewportSize({ width: 415, height: 900 })
  await mobile.goto(baseUrl, { waitUntil: 'networkidle' })
  await openBookEditor(mobile)
  const navigatorToggle = mobile.getByRole('button', { name: 'BOOK ナビゲーター', exact: true })
  const tabsToggle = mobile.getByRole('button', { name: '編集する項目', exact: true })
  await navigatorToggle.waitFor()
  if (await navigatorToggle.getAttribute('aria-expanded') !== 'false' || await tabsToggle.getAttribute('aria-expanded') !== 'false') fail('狭幅のサイドバーが既定で収納されていません')
  await tabsToggle.click()
  await mobile.getByRole('tablist', { name: '編集する項目', exact: true }).waitFor()
  if (await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) fail('狭幅で横スクロールが発生しています')
  await mobile.close()

  // 作品フォルダを標準の「開く」から読み込む
  const samplePage = await context.newPage()
  watch(samplePage)
  await samplePage.goto(baseUrl, { waitUntil: 'networkidle' })
  await openBookEditor(samplePage)
  await samplePage.getByLabel('開く', { exact: true }).first().setInputFiles(samplePath)
  await samplePage.locator('[data-tobidas-project-id="forest_lantern"]').waitFor({ timeout: 60000 })

  if (consoleErrors.length) fail(`ブラウザコンソールエラー:\n${consoleErrors.join('\n')}`)
  console.log(`標準UI意味操作検査 OK: ${selectedId}; タブ・メニュー・制作ガイド・言語・アセット・キー・配置・Undo; desktop/mobile; forest_lantern 読み込み OK`)
} finally {
  await context.close()
  await browser.close()
  await server?.close()
}
