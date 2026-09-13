import { createServer } from 'vite'

/** 生成器も編集画面と同じ型・接続評価・検証・保存を通す。 */
export async function connectedRuntime() {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, entries: [] }, appType: 'custom', logLevel: 'error' })
  const api = {}
  for (const name of ['schema/bookDefaults', 'schema/bookPackage', 'schema/bookValidate', 'schema/content', 'schema/stageElement',
    'parts/supportPlanning', 'parts/contentPlacement', 'parts/schema', 'parts/book', 'parts/geometry', 'parts/contents', 'parts/evaluate', 'parts/validate', 'parts/intersections', 'parts/overlap',
    'parts/contentValidation', 'parts/contentDisplay', 'parts/package', 'parts/bookEdit', 'parts/edit', 'runtime/stow/assign', 'package/serialize', 'package/assemble', 'package/zip', 'builder/io/siteExport', 'runtime/timeline/evaluate', 'runtime/signals']) {
    Object.assign(api, await server.ssrLoadModule(`/src/${name}.ts`))
  }
  return { api, close: () => server.close() }
}
