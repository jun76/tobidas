import { chromium } from 'playwright'

const baseUrl = process.argv[2] ?? 'http://localhost:5174/'
const expectedTools = [
  'tobidas-get-state', 'tobidas-get-spread', 'tobidas-get-element', 'tobidas-list-assets', 'tobidas-validate-book',
  'tobidas-select-target', 'tobidas-set-preview', 'tobidas-enter-play', 'tobidas-enter-edit',
  'tobidas-place-asset', 'tobidas-create-visual', 'tobidas-update-element', 'tobidas-move-element',
  'tobidas-add-timeline-key', 'tobidas-assign-bgm', 'tobidas-clear-bgm', 'tobidas-add-spread',
  'tobidas-undo', 'tobidas-redo',
]

const browser = await chromium.launch({ headless: true })
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
  console.log(`WebMCP検査 OK: ${result.names.length} tools; 通常画面のまま登録・AIモード切替後も維持 OK`)
} finally {
  await context.close()
  await browser.close()
}
