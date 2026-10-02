// WebMCPのツール登録とAI操作のヒントを確かめる。登録するツールは表示中の画面 (HOME・絵本編集・部品編集) で変わる。
// 使い方: node scripts/verify-builder-webmcp.mjs [--url http://localhost:5174/]
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { QA_SERVER } from './lib/embedProject.mjs'

const args = process.argv.slice(2)
const server = args.includes('--url') ? undefined : await createServer({ configFile: 'vite.config.ts', server: QA_SERVER })
if (server) await server.listen()
const baseUrl = args.includes('--url') ? args[args.indexOf('--url') + 1] : `http://localhost:${server.httpServer.address().port}/`

// src/builder/webmcp/tools.ts の createTobidasWebMcpTools と同じ振り分け
const homeTools = ['tobidas-create-part-draft', 'tobidas-enter-edit', 'tobidas-enter-play', 'tobidas-get-part-catalog', 'tobidas-get-state', 'tobidas-open-part-library']
const bookTools = [
  'tobidas-add-camera-key', 'tobidas-add-spread', 'tobidas-add-timeline-key', 'tobidas-assign-bgm', 'tobidas-audit-layout', 'tobidas-clear-bgm',
  'tobidas-clear-page-background', 'tobidas-create-part-draft', 'tobidas-delete-element', 'tobidas-delete-spread', 'tobidas-delete-timeline-key',
  'tobidas-duplicate-spread', 'tobidas-edit-connected-content', 'tobidas-edit-placed-part', 'tobidas-enter-edit', 'tobidas-enter-play',
  'tobidas-get-authoring-guide', 'tobidas-get-element', 'tobidas-get-part-catalog', 'tobidas-get-part-edit-controls', 'tobidas-get-part-mounts',
  'tobidas-get-spread', 'tobidas-get-state', 'tobidas-list-assets', 'tobidas-list-timeline-keys', 'tobidas-move-element', 'tobidas-open-part-library',
  'tobidas-place-content', 'tobidas-place-part', 'tobidas-place-part-on-surfaces', 'tobidas-redo', 'tobidas-reorder-spread', 'tobidas-select-target',
  'tobidas-set-camera', 'tobidas-set-element-parent', 'tobidas-set-page-background', 'tobidas-set-preview', 'tobidas-set-read-aloud', 'tobidas-undo',
  'tobidas-update-authoring-guide', 'tobidas-update-element', 'tobidas-update-placed-part', 'tobidas-update-timeline-key', 'tobidas-validate-book',
]
const partTools = [
  'tobidas-add-part-node', 'tobidas-create-part-draft', 'tobidas-delete-part-content', 'tobidas-delete-part-node', 'tobidas-edit-connected-content',
  'tobidas-edit-part-node', 'tobidas-edit-placed-part', 'tobidas-enter-edit', 'tobidas-enter-play', 'tobidas-expose-part-edit-handle',
  'tobidas-expose-part-material', 'tobidas-expose-part-parameter', 'tobidas-expose-part-port', 'tobidas-get-part-catalog', 'tobidas-get-part-draft',
  'tobidas-get-part-edit-controls', 'tobidas-get-part-mounts', 'tobidas-get-state', 'tobidas-open-part-library', 'tobidas-part-redo', 'tobidas-part-undo',
  'tobidas-place-content', 'tobidas-place-part', 'tobidas-place-part-on-surfaces', 'tobidas-save-part-library', 'tobidas-set-part-shape',
  'tobidas-update-part-definition', 'tobidas-update-part-node', 'tobidas-update-placed-part', 'tobidas-upsert-part-content',
]

const browserHintCases = [
  { name: 'Chrome', userAgent: 'Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36',
    expected: ['Chromeで下記のWebMCP設定', 'chrome://flags/#enable-webmcp-testing'], forbidden: ['edge://flags/#enable-webmcp-testing', 'about:config'] },
  { name: 'Edge', userAgent: 'Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0',
    expected: ['Edgeで下記のWebMCP設定', 'edge://flags/#enable-webmcp-testing'], forbidden: ['chrome://flags/#enable-webmcp-testing', 'about:config'] },
  { name: 'Firefox', userAgent: 'Mozilla/5.0 Firefox/154.0',
    expected: ['Firefoxで下記のWebMCP設定', 'about:config', 'dom.modelcontext.enabled', 'dom.modelcontext.testing.enabled'],
    forbidden: ['chrome://flags/#enable-webmcp-testing', 'edge://flags/#enable-webmcp-testing'] },
]

const browser = await chromium.launch({ headless: true })
try {
  const counts = await verifyToolRegistration(browser)
  for (const testCase of browserHintCases) await verifyBrowserHint(browser, testCase)
  console.log(`WebMCP検査 OK: HOME ${counts.home} / 絵本 ${counts.book} / 部品 ${counts.part} tools; 再生・編集の切り替え後も維持; ブラウザ別Tips ${browserHintCases.length}種 OK`)
} finally {
  await browser.close()
  await server?.close()
}

async function verifyToolRegistration(browser) {
  const context = await browser.newContext({ locale: 'ja-JP' })
  // WebMCPを持つブラウザの代わりに、登録と解除だけを記録する modelContext を差し込む
  await context.addInitScript(() => {
    const registered = new Map()
    const modelContext = {
      registerTool: async (tool, options = {}) => {
        registered.set(tool.name, tool)
        options.signal?.addEventListener('abort', () => registered.delete(tool.name), { once: true })
      },
      getRegisteredNames: () => [...registered.keys()].sort(),
      getTool: (name) => registered.get(name),
    }
    Object.defineProperty(Document.prototype, 'modelContext', { configurable: true, get: () => modelContext })
  })
  const page = await context.newPage()
  const registeredAre = async (label, expected) => {
    try {
      await page.waitForFunction((names) => JSON.stringify(document.modelContext?.getRegisteredNames()) === JSON.stringify(names), [...expected].sort(), { timeout: 15000 })
    } catch {
      const actual = await page.evaluate(() => document.modelContext?.getRegisteredNames() ?? [])
      const missing = expected.filter((name) => !actual.includes(name)), extra = actual.filter((name) => !expected.includes(name))
      throw new Error(`${label}の登録ツールが一致しません。不足: ${missing.join(', ') || 'なし'} / 余分: ${extra.join(', ') || 'なし'}`)
    }
    return expected.length
  }
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    const home = await registeredAre('HOME', homeTools)

    await page.getByRole('button', { name: '絵本作品を編集', exact: true }).click()
    await page.locator('[data-tobidas-kind="builder-workspace"]').waitFor()
    const book = await registeredAre('絵本編集', bookTools)
    if (await page.getByRole('button', { name: 'AIモード', exact: true }).count()) throw new Error('AIモード切り替えが残っています')
    const state = await page.evaluate(async () => document.modelContext.getTool('tobidas-get-state').execute({}))
    if (!JSON.stringify(state).includes('activeSpread')) throw new Error('tobidas-get-stateが標準状態要約を返していません')
    await page.getByRole('button', { name: '再生', exact: true }).click()
    await page.getByRole('button', { name: '編集', exact: true }).click()
    await registeredAre('再生から戻った絵本編集', bookTools)

    await page.getByRole('button', { name: 'HOME', exact: true }).click()
    await page.getByRole('button', { name: 'カスタム部品を編集', exact: true }).click()
    await page.locator('[data-tobidas-kind="part-editor"]').waitFor()
    const part = await registeredAre('部品編集', partTools)
    return { home, book, part }
  } finally {
    await context.close()
  }
}

async function verifyBrowserHint(browser, testCase) {
  const context = await browser.newContext({ userAgent: testCase.userAgent, locale: 'ja-JP' })
  const page = await context.newPage()
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    // AI操作のヒントは絵本の編集画面のヘッダーにある
    await page.getByRole('button', { name: '絵本作品を編集', exact: true }).click()
    await page.getByLabel('AI操作のヒント').first().hover()
    const dialog = page.getByRole('dialog', { name: 'AI操作のヒント' })
    await dialog.waitFor()
    const text = await dialog.innerText()
    for (const expected of testCase.expected) if (!text.includes(expected)) throw new Error(`${testCase.name}のTipsに「${expected}」がありません`)
    for (const forbidden of testCase.forbidden) if (text.includes(forbidden)) throw new Error(`${testCase.name}のTipsに別ブラウザの設定「${forbidden}」があります`)
  } finally {
    await context.close()
  }
}
