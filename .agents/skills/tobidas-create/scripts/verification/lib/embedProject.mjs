// Assemble a work package folder into the same embedded form as exported HTML.
//
// The player accepts only one embedded data payload and has no development-only loading path
// (src/player/PlayerApp.tsx). Automation replaces the HTML response through Playwright so the work
// plays through exactly the same path as a distributed artifact. Assembly follows src/package/assemble.ts:
// SVG assets remain strings and all other assets become data URLs.
import fs from 'node:fs'
import path from 'node:path'

/** QA dev server. Use an available port to avoid colliding with development port 5174. */
export const QA_SERVER = { port: 0 }

/**
 * Filter only HMR WebSocket failures.
 *
 * Because Playwright serves the page whose response was replaced, Chrome treats it as a different
 * address space from the dev server and the HMR WebSocket always fails under local-network access restrictions.
 * This does not affect playback, but it would fail scripts that check console errors.
 * Exported single-file HTML has no HMR, so this message alone may be ignored.
 */
export function isHmrNoise(text) {
  return /\[vite\]|websocket connection to|failed to connect to websocket/i.test(text)
}

/** Read projects/<id>/ and build a BookProject containing the asset bodies. */
export function embedProjectFolder(dir) {
  const projectJson = path.join(dir, 'project.json')
  if (!fs.existsSync(projectJson)) throw new Error(`project.json not found: ${projectJson}`)
  const project = JSON.parse(fs.readFileSync(projectJson, 'utf8'))
  project.assets = project.assets.map((meta) => {
    const file = path.join(dir, 'assets', meta.id)
    if (!fs.existsSync(file)) throw new Error(`Asset file not found: ${file}`)
    const data = meta.type === 'svg'
      ? fs.readFileSync(file, 'utf8')
      : `data:${meta.mime};base64,${fs.readFileSync(file).toString('base64')}`
    return { ...meta, data }
  })
  return project
}

/** Inject a work into the player HTML using the same container as siteExport.ts. */
export function injectProject(html, project) {
  const json = JSON.stringify(project).replace(/</g, '\\u003c')
  const placeholder = /(<script type="application\/json" id="tobidas-project">)[\s\S]*?(<\/script>)/
  if (!placeholder.test(html)) throw new Error('The HTML does not contain the tobidas-project container')
  return html.replace(placeholder, (_match, open, close) => open + json + close)
}

/**
 * Replace the player.html response with one containing the embedded work.
 * After this function is called, goto opens the same player state as exported single-file HTML.
 */
export async function servePlayerWithProject(page, dir) {
  const project = embedProjectFolder(dir)
  await page.route('**/player.html*', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      status: response.status(),
      contentType: 'text/html; charset=utf-8',
      body: injectProject(await response.text(), project),
    })
  })
  return project
}
