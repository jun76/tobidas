import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? 'http://localhost:5174/'
const expectedTools = [
  'tobidas-get-state', 'tobidas-get-spread', 'tobidas-get-element', 'tobidas-list-assets', 'tobidas-validate-book',
  'tobidas-select-target', 'tobidas-set-preview', 'tobidas-enter-play', 'tobidas-enter-edit',
  'tobidas-place-asset', 'tobidas-create-visual', 'tobidas-update-element', 'tobidas-move-element',
  'tobidas-add-timeline-key', 'tobidas-assign-bgm', 'tobidas-clear-bgm', 'tobidas-add-spread',
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
  console.log(`WebMCP検査 OK: ${registeredToolCount} tools; 通常画面のまま登録・AIモード切替後も維持; ブラウザ別Tips ${browserHintCases.length}種 OK`)
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

    if (await page.getByRole('main', { name: 'AIブラウザ操作ワークスペース' }).count()) {
      throw new Error('通常画面の初期表示がAIワークスペースになっています')
    }
    await page.getByRole('button', { name: 'AIモード', exact: true }).click()
    await page.getByRole('main', { name: 'AIブラウザ操作ワークスペース' }).waitFor()

    const result = await page.evaluate(() => ({
      names: document.modelContext.getRegisteredNames(),
      toolname: document.querySelector('[data-tobidas-kind="place-asset-form"]')?.getAttribute('toolname'),
      tooldescription: document.querySelector('[data-tobidas-kind="place-asset-form"]')?.getAttribute('tooldescription'),
    }))
    if (result.names.length !== expectedTools.length) throw new Error(`登録ツール数が一致しません: ${result.names.length}`)
    if (result.toolname !== 'tobidas-place-asset-form' || !result.tooldescription) throw new Error('宣言的フォーム属性がありません')

    await page.getByRole('button', { name: '通常モードへ戻る' }).click()
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
