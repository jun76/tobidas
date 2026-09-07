import type { PartDefinitions } from '../../parts/schema'
import { evaluateBookParts } from '../../parts/book'
import { faceCorners } from '../../parts/geometry'
import * as THREE from 'three'
import type { Book, Spread } from '../../schema/book'
import type { StageElement } from '../../schema/stageElement'
import { evaluateAssemblyScene, assemblySceneBounds } from '../mechanisms/scene'
import { childrenByParent, spreadOpenBounds } from '../stow/geometry'
import { evaluateElementTimeline } from '../timeline/evaluate'

// commit() が作品を複製するたびに再計算する。再生中の時計や二面角はキーに含めない。
const boundsCache = new WeakMap<Spread, { pageWidth: number; pageAspect: number; definitions?: PartDefinitions; bounds: THREE.Box3 }>()

function referenceTimes(spread: Spread): number[] {
  const times = new Set([0, spread.sequence.holdSeconds])
  for (const track of spread.timeline.tracks) {
    if (track.target.type !== 'element') continue
    for (const key of track.keys) times.add(Math.max(0, Math.min(spread.sequence.holdSeconds, key.time)))
  }
  const keys = [...times].sort((a, b) => a - b)
  for (let i = 1; i < keys.length; i++) times.add((keys[i - 1] + keys[i]) / 2)
  return [...times]
}

/**
 * 紙面と全開の部品を含む、見開きの構図用境界。
 * 複合部品は描画と同じ面・面上の子を評価し、幅の推測で代用しない。
 * タイムラインのキーと中間時刻をまとめて囲むため、保持中も構図が動かない。
 * 周期運動は時計0で固定し、衝突検査用の全時刻包絡とは区別する。
 */
export function spreadCameraBounds(book: Book, spread: Spread, definitions?: PartDefinitions): THREE.Box3 {
  const { pageWidth, pageAspect } = book.format
  const cached = boundsCache.get(spread)
  if (cached?.pageWidth === pageWidth && cached.pageAspect === pageAspect && cached.definitions === definitions) return cached.bounds.clone()

  const depth = pageWidth / pageAspect
  const bounds = new THREE.Box3(
    new THREE.Vector3(-pageWidth, 0, -depth / 2),
    new THREE.Vector3(pageWidth, 0, depth / 2),
  )
  try {
    const paper = evaluateBookParts({ book, partDefinitions: definitions }, spread, Math.PI, 0)
    for (const face of paper.faces) for (const point of faceCorners(face)) bounds.expandByPoint(point)
  } catch { /* 接続のない下書きでは紙面の構図を使う。 */ }
  for (const time of referenceTimes(spread)) {
    const scene = evaluateAssemblyScene(book, spread, {
      open: 1, leftAngle: Math.PI, rightAngle: 0, spreadTime: time, clock: 0,
    })
    bounds.union(assemblySceneBounds(scene))

    const elements = spread.elements.map((element) => evaluateElementTimeline(element, spread, time))
    const byId = new Map(elements.map((element) => [element.id, element]))
    const isLegacyVisible = (element: StageElement): boolean => {
      const seen = new Set<string>()
      let current: StageElement | undefined = element
      while (current && !seen.has(current.id)) {
        if (!current.visible || current.opacity <= .001 || current.type === 'assembly' || current.type === 'part') return false
        seen.add(current.id)
        if (current.parent.type !== 'element') return true
        current = byId.get(current.parent.elementId)
      }
      return false
    }
    const legacySpread = { ...spread, elements: elements.filter(isLegacyVisible) }
    const children = childrenByParent(legacySpread)
    for (const element of legacySpread.elements) {
      if (element.parent.type === 'element') continue
      const box = spreadOpenBounds(element, children, pageWidth)
      bounds.expandByPoint(new THREE.Vector3(...box.min))
      bounds.expandByPoint(new THREE.Vector3(...box.max))
    }
  }
  boundsCache.set(spread, { pageWidth, pageAspect, definitions, bounds })
  return bounds.clone()
}
