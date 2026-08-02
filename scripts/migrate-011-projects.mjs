/** v0.1.0形式の公開作品を011の単一ビジュアル・ページ所有形式へ移す。 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const particleDefaults = (enabled = false, color = '#fff3a0') => ({
  enabled, color, count: 6, size: .45, drift: .05, period: 11,
})

/** 旧機構の明示指定を外した際にも、作品固有の展開順は保持する。 */
function repairAuthoredStowOrder(project) {
  if (project.id !== 'crooked_castle') return
  const opening = project.book?.spreads?.[0]
  if (!opening) return
  for (const element of opening.elements) {
    if (/^front-(left|right)-/.test(element.id)) element.stow.stagger = 0
    if (/^(near|mid|back)-(left|right)-/.test(element.id) || element.id === 'central-twin') {
      element.stow.stagger = .62
    }
  }
  // 中央線をまたいで自動V折りになった後列も、表紙を開く途中では見せない。
  // 見開きが開き切ってから既存の spring トラックで現れる順序を維持する。
  for (const track of opening.timeline?.tracks ?? []) {
    if (track.property !== 'scale' || !track.id.endsWith('-spring')) continue
    const id = track.target?.elementId ?? ''
    if (!/^(mid|back)-(left|right)-/.test(id) && id !== 'central-twin') continue
    if (track.keys[0]) track.keys[0].value = 0
    while ((track.keys[0]?.time ?? 0) >= 1) {
      for (const key of track.keys) key.time -= 1
    }
  }
  const near = opening.elements.filter((element) => /^near-(left|right)-/.test(element.id))
  near.forEach((element, index) => {
    if (opening.timeline.tracks.some((track) => track.target?.elementId === element.id && track.property === 'scale')) return
    const start = .02 + index * .02
    opening.timeline.tracks.push({
      id: `${element.id}-spring`, target: { type: 'element', elementId: element.id }, property: 'scale',
      keys: [
        [start, 0], [start + .26, 1.08], [start + .43, .94], [start + .58, 1.035], [start + .72, 1],
      ].map(([time, value], order) => ({
        id: `${element.id}-spring-${order}`, time, value, ease: 'easeInOut',
      })),
    })
  })
}

function migrateElement(element, pageWidth) {
  const next = structuredClone(element)
  if (next.parent?.type === 'spread') {
    const x = next.baseTransform.position[0]
    const left = x < 0
    next.parent = { type: left ? 'left-page' : 'right-page' }
    next.baseTransform.position[0] = x + (left ? pageWidth / 2 : -pageWidth / 2)
  }
  next.stow = { fallDirection: next.stow?.fallDirection ?? 'auto', stagger: next.stow?.stagger ?? 0 }
  delete next.sourcePreset
  if (next.type === 'group' || next.type === 'visual') return next
  const common = {
    ...next, type: 'visual', billboard: next.billboard ?? false,
    backgroundColor: '#00000000', foregroundColor: next.color ?? '#2e241b', text: next.text ?? '',
    fontSize: next.fontSize ?? .35, align: next.align ?? 'center', font: next.font ?? 'rounded',
    bold: next.bold ?? true, italic: next.italic ?? false, underline: next.underline ?? false,
  }
  if (next.type === 'image') {
    common.image = next.asset || undefined
    common.backImage = next.backAsset || undefined
    common.particles = particleDefaults()
  } else if (next.type === 'effect') {
    common.width = next.size ?? 1
    common.height = next.size ?? 1
    common.particles = particleDefaults(true, next.color)
  } else {
    common.particles = particleDefaults()
  }
  for (const key of ['asset', 'backAsset', 'effect', 'color', 'size']) delete common[key]
  return common
}

function migrateTrack(track) {
  const next = structuredClone(track)
  if (next.property === 'asset') next.property = 'visual.image'
  if (next.property === 'effect.color') next.property = 'visual.particles.color'
  if (next.property !== 'effect.size') return [next]
  return ['width', 'height'].map((dimension) => ({
    ...structuredClone(next), id: `${next.id}-${dimension}`, property: `visual.${dimension}`,
    keys: next.keys.map((key) => ({ ...key, id: `${key.id}-${dimension}` })),
  }))
}

const requested = new Set(process.argv.slice(2))
for (const entry of readdirSync('projects', { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  if (requested.size && !requested.has(entry.name)) continue
  const path = join('projects', entry.name, 'project.json')
  let project
  try { project = JSON.parse(readFileSync(path, 'utf8')) } catch { continue }
  const pageWidth = project.book?.format?.pageWidth ?? 8
  for (const spread of project.book?.spreads ?? []) {
    spread.elements = spread.elements.map((element) => migrateElement(element, pageWidth))
    spread.timeline.tracks = spread.timeline.tracks.flatMap(migrateTrack)
  }
  repairAuthoredStowOrder(project)
  writeFileSync(path, `${JSON.stringify(project, null, 2)}\n`)
  console.log(`${entry.name}: 011形式へ移行`)
}
