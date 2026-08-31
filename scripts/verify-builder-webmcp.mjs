import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? 'http://localhost:5174/'
const expectedTools = [
  'tobidas-get-state', 'tobidas-get-spread', 'tobidas-get-element', 'tobidas-list-assets', 'tobidas-validate-book',
  'tobidas-audit-layout', 'tobidas-select-target', 'tobidas-set-preview', 'tobidas-enter-play', 'tobidas-enter-edit',
  'tobidas-place-asset', 'tobidas-set-page-background', 'tobidas-clear-page-background', 'tobidas-create-visual',
  'tobidas-update-element', 'tobidas-move-element', 'tobidas-set-element-parent', 'tobidas-delete-element',
  'tobidas-add-timeline-key', 'tobidas-list-timeline-keys', 'tobidas-update-timeline-key', 'tobidas-delete-timeline-key',
  'tobidas-set-camera', 'tobidas-add-camera-key', 'tobidas-assign-bgm', 'tobidas-clear-bgm', 'tobidas-add-spread',
  'tobidas-duplicate-spread', 'tobidas-reorder-spread', 'tobidas-delete-spread',
  'tobidas-undo', 'tobidas-redo',
]

const browserHintCases = [
  {
    name: 'Chrome',
    userAgent: 'Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36',
    expected: ['Chromeで下記のWebMCP設定', 'chrome://flags/#enable-webmcp-testing'],
    forbidden: ['edge://flags/#enable-webmcp-testing', 'about:config'],
  },
  {
    name: 'Edge',
    userAgent: 'Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0',
    expected: ['Edgeで下記のWebMCP設定', 'edge://flags/#enable-webmcp-testing'],
    forbidden: ['chrome://flags/#enable-webmcp-testing', 'about:config'],
  },
  {
    name: 'Firefox',
    userAgent: 'Mozilla/5.0 Firefox/154.0',
    expected: ['Firefoxで下記のWebMCP設定', 'about:config', 'dom.modelcontext.enabled', 'dom.modelcontext.testing.enabled'],
    forbidden: ['chrome://flags/#enable-webmcp-testing', 'edge://flags/#enable-webmcp-testing'],
  },
]

const browser = await chromium.launch({ headless: true })
try {
  const registeredToolCount = await verifyToolRegistration(browser)
  for (const testCase of browserHintCases) await verifyBrowserHint(browser, testCase)
  console.log(`WebMCP検査 OK: ${registeredToolCount} tools; 標準画面で登録・状態変更後も維持; ブラウザ別Tips ${browserHintCases.length}種 OK`)
} finally {
  await browser.close()
}

async function verifyToolRegistration(browser) {
  const context = await browser.newContext()
  await context.addInitScript(() => {
    const registered = new Map()
    const modelContext = {
      registerTool: async (tool, options = {}) => {
        registered.set(tool.name, tool)
        options.signal?.addEventListener('abort', () => registered.delete(tool.name), { once: true })
      },
      getRegisteredNames: () => [...registered.keys()],
      getTool: (name) => registered.get(name),
    }
    Object.defineProperty(Document.prototype, 'modelContext', { configurable: true, get: () => modelContext })
  })
  const page = await context.newPage()
  try {
    const url = new URL(baseUrl)
    await page.goto(url.href, { waitUntil: 'networkidle' })
    await page.waitForFunction((names) => {
      const context = document.modelContext
      return context && names.every((name) => context.getRegisteredNames().includes(name))
    }, expectedTools)

    await page.locator('[data-tobidas-kind="builder-workspace"]').waitFor()
    if (await page.getByRole('button', { name: 'AIモード', exact: true }).count()) throw new Error('AIモード切り替えが残っています')
    await page.getByRole('button', { name: '詳細配置' }).click()
    await page.locator('[data-tobidas-kind="precision-placement-form"]').waitFor()

    const result = await page.evaluate(async () => ({
      names: document.modelContext.getRegisteredNames(),
      toolname: document.querySelector('[data-tobidas-kind="precision-placement-form"]')?.getAttribute('toolname'),
      tooldescription: document.querySelector('[data-tobidas-kind="precision-placement-form"]')?.getAttribute('tooldescription'),
      state: await document.modelContext.getTool('tobidas-get-state').execute({}),
    }))
    if (result.names.length !== expectedTools.length) throw new Error(`登録ツール数が一致しません: ${result.names.length}`)
    if (result.toolname !== 'tobidas-place-asset-form' || !result.tooldescription) throw new Error('宣言的フォーム属性がありません')

    if (!JSON.stringify(result.state).includes('activeSpread')) throw new Error('tobidas-get-stateが標準状態要約を返していません')
    await page.getByRole('button', { name: 'キャンセル' }).click()
    await page.getByRole('button', { name: '再生', exact: true }).click()
    await page.getByRole('button', { name: '編集', exact: true }).waitFor()
    await page.waitForFunction((count) => document.modelContext.getRegisteredNames().length === count, result.names.length)
    return result.names.length
  } finally {
    await context.close()
  }
}

async function verifyBrowserHint(browser, testCase) {
  const context = await browser.newContext({ userAgent: testCase.userAgent })
  const page = await context.newPage()
  try {
    await page.goto(new URL(baseUrl).href, { waitUntil: 'networkidle' })
    await page.getByLabel('AI操作のヒント').first().hover()
    const dialog = page.getByRole('dialog', { name: 'AI操作のヒント' })
    await dialog.waitFor()
    const text = await dialog.innerText()
    for (const expected of testCase.expected) {
      if (!text.includes(expected)) throw new Error(`${testCase.name}のTipsに「${expected}」がありません`)
    }
    for (const forbidden of testCase.forbidden) {
      if (text.includes(forbidden)) throw new Error(`${testCase.name}のTipsに別ブラウザの設定「${forbidden}」があります`)
    }
  } finally {
    await context.close()
  }
}
