#!/usr/bin/env node
// 背景パネルの積層順と、起立部品の初期配置を点検する。
import fs from 'node:fs'
import path from 'node:path'

const input = process.argv[2]
const strict = process.argv.includes('--strict')
if (!input) throw new Error('使い方: node scripts/verify-stow-layout.mjs <作品フォルダまたはproject.json> [--strict]')

const resolved = path.resolve(input)
const projectPath = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
  ? path.join(resolved, 'project.json')
  : resolved
if (!fs.existsSync(projectPath)) throw new Error(`project.json がありません: ${projectPath}`)

const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'))
const pageWidth = project.book.format.pageWidth
const findings = []
const POSITION_EPSILON = Math.max(.08, pageWidth * .01)
const DEPTH_EPSILON = Math.max(.08, pageWidth * .01)

const tokenOf = (element) => [element.id, element.name, element.image].filter(Boolean).join(' ').toLowerCase()
const backgroundToken = /backdrop|background|bg[-_ ]|背景|遠景/i
const isVisual = (element) => element.type === 'visual'
const isRoot = (element) => element.parent?.type === 'left-page' || element.parent?.type === 'right-page'
const isUpright = (element) => {
  const rotation = Number(element.baseTransform?.rotation?.[0])
  return Number.isFinite(rotation) && Math.abs(Math.sin(rotation * Math.PI / 180)) < Math.sin(35 * Math.PI / 180)
}
const isText = (element) => isVisual(element) && String(element.text ?? '').trim().length > 0
const centerX = (element, pageWidth) => {
  const local = Number(element.baseTransform.position[0])
  return element.parent.type === 'left-page' ? local - pageWidth / 2 : local + pageWidth / 2
}
const xBounds = (element, pageWidth) => {
  const width = Math.abs(Number(element.width ?? 0) * Number(element.baseTransform.scale?.[0] ?? 1))
  const pivot = Number(element.pivot?.[0] ?? .5)
  const x = centerX(element, pageWidth)
  return [x - pivot * width, x + (1 - pivot) * width]
}
const overlapsX = (first, second, pageWidth) => {
  const [firstMin, firstMax] = xBounds(first, pageWidth)
  const [secondMin, secondMax] = xBounds(second, pageWidth)
  return firstMin < secondMax + DEPTH_EPSILON && secondMin < firstMax + DEPTH_EPSILON
}
const isBackgroundCandidate = (element) => {
  if (!isVisual(element) || !isRoot(element)) return false
  return backgroundToken.test(tokenOf(element))
}

function addFinding(level, spread, element, message) {
  findings.push({ level, spread: spread.name, element: element?.name ?? '', message })
}

for (const spread of project.book.spreads ?? []) {
  const roots = (spread.elements ?? []).filter((element) => isRoot(element))
  const upright = roots.filter((element) => isUpright(element) && !isText(element))
  const candidates = upright.filter(isBackgroundCandidate)
  if (!candidates.length) {
    addFinding('warning', spread, undefined, '背景パネル候補が見つかりません。名前またはアセットIDへ backdrop / 背景 / 遠景 を含めてください。')
    continue
  }
  const highestLayer = Math.max(...upright.map((element) => Number(element.layer ?? 0)))
  const earliestStagger = Math.min(...upright.map((element) => Number(element.stow?.stagger ?? 0)))
  const foreground = upright.filter((element) => !candidates.includes(element))
  for (const panel of candidates) {
    const panelLayer = Number(panel.layer ?? 0)
    if (panelLayer < highestLayer) {
      addFinding('error', spread, panel, `背景パネルの layer ${panelLayer} が起立部品の最大値 ${highestLayer} より低く、収納時に上へ積まれません。`)
    }
    const panelStagger = Number(panel.stow?.stagger ?? 0)
    if (panelStagger > earliestStagger + 1e-6) {
      addFinding('error', spread, panel, `背景パネルの stagger ${panelStagger} が他の起立部品より遅く、展開時に最初に起立しません。`)
    }
    const panelY = Number(panel.baseTransform.position?.[1] ?? 0)
    const panelZ = Number(panel.baseTransform.position?.[2] ?? 0)
    const width = Math.abs(Number(panel.width ?? 0) * Number(panel.baseTransform.scale?.[0] ?? 1))
    if (width < pageWidth * .65) {
      addFinding('warning', spread, panel, `背景パネルの幅 ${width.toFixed(2)} が片面幅の65%未満です。大きな背景板として扱う場合は素材と寸法を確認してください。`)
    }
    for (const part of foreground) {
      const y = Number(part.baseTransform.position?.[1] ?? 0)
      if (y > panelY + POSITION_EPSILON) {
        addFinding('warning', spread, part, `初期Y ${y.toFixed(3)} が背景パネル ${panel.name} の下端 ${panelY.toFixed(3)} より上にあります。浮遊部品でない場合は背景の下へ配置してください。`)
      }
      const z = Number(part.baseTransform.position?.[2] ?? 0)
      if (overlapsX(panel, part, pageWidth) && z <= panelZ + DEPTH_EPSILON) {
        addFinding('error', spread, part, `初期Z ${z.toFixed(3)} が背景パネル ${panel.name} (${panelZ.toFixed(3)}) より奥側または同位置です。背景より手前へ配置してください。`)
      }
    }
  }
}

for (const finding of findings) {
  const prefix = finding.level === 'error' ? 'エラー' : '警告'
  console.log(`[収納配置] ${prefix} ${finding.spread}${finding.element ? ` / ${finding.element}` : ''}: ${finding.message}`)
}
const errors = findings.filter((finding) => finding.level === 'error')
const warnings = findings.filter((finding) => finding.level === 'warning')
console.log(`収納配置点検: エラー ${errors.length}、警告 ${warnings.length}${strict ? ' (strict)' : ''}`)
if (strict && errors.length) process.exitCode = 1
