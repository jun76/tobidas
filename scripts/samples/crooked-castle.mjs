import { readFileSync } from 'node:fs'

/** 手作業で作られた城の構図・動作を、再生成できる制作定義として保持する。 */
export function build(updatedAt) {
  const source = JSON.parse(readFileSync(new URL('./crooked-castle.source.json', import.meta.url), 'utf8'))
  source.updatedAt = updatedAt
  return {
    meta: { id: source.id, title: source.name, description: 'A crooked castle grows and bounces above a paper landscape.',
      theme: 'crooked-castle', cover: { front: source.book.frontCover.frontAsset } },
    toProject: () => structuredClone(source),
    files: () => new Map(source.assets.map((asset) => [asset.id, readFileSync(new URL(`./assets/crooked_castle/${asset.id}`, import.meta.url))])),
  }
}
