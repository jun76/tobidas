import { readFileSync } from 'node:fs'

/** 手作業で作られた城の構図・動作を、再生成できる制作定義として保持する。 */
export function build(updatedAt) {
  const source = JSON.parse(readFileSync(new URL('./crooked-castle.source.json', import.meta.url), 'utf8'))
  source.updatedAt = updatedAt
  for (const spread of source.book.spreads) {
    // 城郭と前景は足元を固定した魔法の出現。退場は各部品の登場順も含めて逆にたどる。
    const scenery = spread.elements.filter(e => e.type === 'visual' && e.pivot[1] === 0 && !e.id.startsWith('forest-'))
    const foreground = scenery.filter(e => /^(front|wall|fence)-/.test(e.id))
    const foregroundDuration = .3, foregroundStagger = .01
    const castleDelay = foregroundDuration + foregroundStagger * (foreground.length - 1)
    for (const [index, element] of scenery.entries()) {
      const foregroundIndex = foreground.indexOf(element)
      let entrance = spread.timeline.tracks.find(t => t.target.elementId === element.id && t.property === 'scale')
      if (!entrance) {
        const start = foregroundIndex >= 0 ? foregroundStagger * foregroundIndex : .02 * index
        const duration = foregroundIndex >= 0 ? foregroundDuration : .72
        entrance = { id: `${element.id}-spring`, target: { type: 'element', elementId: element.id }, property: 'scale',
          keys: [[start, 0], [start + duration, 1]].map(([time, value], i) => ({ id: `${element.id}-spring-${i}`, time, value, ease: 'easeInOut' })) }
        spread.timeline.tracks.push(entrance)
      }
      // 前列を出し終えてから城本体を立ち上げる。城の内部の時差と弾みは維持する。
      if (foregroundIndex < 0) for (const key of entrance.keys) key.time += castleDelay
      const keys = [...entrance.keys].sort((a, b) => a.time - b.time)
      entrance.keys.push(...keys.map((key, i) => ({ ...key, id: `${key.id}-return`, time: spread.sequence.holdSeconds - key.time,
        ease: keys[i + 1]?.ease ?? 'easeInOut' })).reverse())
    }
  }
  return {
    meta: { id: source.id, title: source.name, description: 'A crooked castle grows from the ground and shrinks back into the book.',
      theme: 'crooked-castle', cover: { front: source.book.frontCover.frontAsset } },
    toProject: () => structuredClone(source),
    files: () => new Map(source.assets.map((asset) => [asset.id, readFileSync(new URL(`./assets/crooked_castle/${asset.id}`, import.meta.url))])),
  }
}
