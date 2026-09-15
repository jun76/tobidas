import type { BookProject } from '../schema/bookPackage'
import type { Spread } from '../schema/book'
import type { PartElement } from '../schema/stageElement'
import { evaluatePartGraph } from './evaluate'
import { bindingDependencies, type PartNode, type PartMaterial } from './schema'
import { bindBookContents } from './contents'
import { inspectContentBindings, inspectContentsAt, inspectContentMotion } from './contentValidation'
import { faceCorners, logicalPagePorts as pagePorts } from './geometry'
import { deployPaper, planPaperStow, type PaperStowFit } from './deployment'
import { Vector3 } from 'three'
import { createPaperMotionInspector, inspectClosedLayout, validationAngles } from './validate'

export const spreadPartNodes = (spread: Spread): PartNode[] => spread.elements.filter((element): element is PartElement => element.type === 'part')
  .map((element) => ({ id: element.id, name: element.name, ...element.part }))

export function evaluateBookParts(project: Pick<BookProject, 'book' | 'partDefinitions'>, spread: Spread, leftAngle: number, rightAngle: number) {
  const { pageWidth, pageAspect } = project.book.format
  return evaluatePartGraph(spreadPartNodes(spread), project.partDefinitions ?? {}, undefined,
    { $book: pagePorts(pageWidth, pageWidth / pageAspect, leftAngle, rightAngle) })
}

const stowFits = new Map<string, [PaperStowFit, PaperStowFit]>()
export function deployBookParts(project: Pick<BookProject, 'book' | 'partDefinitions'>, spread: Spread,
  result: ReturnType<typeof evaluateBookParts>, left: number, right: number) {
  const angle = Math.abs(left - right) * 180 / Math.PI
  if (angle >= 180 - 1e-8) return result
  const { pageWidth: width, pageAspect } = project.book.format, depth = width / pageAspect
  const key = JSON.stringify([width, depth, spreadPartNodes(spread), Object.keys(project.partDefinitions ?? {})])
  let fits = stowFits.get(key)
  if (!fits) {
    fits = [planPaperStow(evaluateBookParts(project, spread, 0, 0), width, depth),
      planPaperStow(evaluateBookParts(project, spread, Math.PI, Math.PI), width, depth, new Vector3(-1, 0, 0))]
    stowFits.set(key, fits)
    while (stowFits.size > 16) stowFits.delete(stowFits.keys().next().value!)
  }
  const closingLeft = right < 1e-8
  return deployPaper(result, fits[closingLeft ? 0 : 1], angle, new Vector3(closingLeft ? 1 : -1, 0, 0))
}

/** 絵本の保持時計は全開時だけ進む。開き途中は冒頭、閉じ途中は末尾の姿勢で周期演出だけが続く。 */
export const bookContentHoldTime = (angle: number, movingSide: 'left' | 'right', hold: number): number | undefined =>
  angle >= 180 - 1e-8 ? undefined : movingSide === 'left' ? 0 : hold

// 候補の検査、commit、Undoで同じ設計を再検査しない。参照同一性ではなく設計内容を鍵にする。
// 素材の存在確認はこのキャッシュの外で毎回行う。保存・再生データには含めない。
const spreadInspections = new Map<string, string[]>()
const inspectionKey = (value: unknown) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)
export function validateBookParts(project: BookProject): string[] {
  const errors: string[] = []
  const materials = project.book.spreads.flatMap((spread) => spread.elements.flatMap((element) => element.type === 'part' ? Object.values(element.part.materials) : []))
  for (const definition of Object.values(project.partDefinitions ?? {})) {
    materials.push(...Object.values(definition.materialSlots), ...definition.nodes.flatMap((node) => Object.values(node.materials).filter((value): value is PartMaterial => !('slot' in value))))
  }
  for (const material of materials) for (const id of [material.image, material.backImage]) {
    if (id && !project.assets.some((asset) => asset.id === id && ['image', 'svg'].includes(asset.type))) errors.push(`Missing or unsupported paper artwork: ${id}`)
  }
  const contextKey = inspectionKey([project.book.format, project.partDefinitions ?? {}])
  for (const spread of project.book.spreads) {
    if (!spread.elements.some((element) => element.type === 'part' || element.attachment || element.presentation)) continue
    const key = contextKey + '\n' + inspectionKey(spread), cached = spreadInspections.get(key)
    if (cached) {
      spreadInspections.delete(key); spreadInspections.set(key, cached)
      errors.push(...cached); continue
    }
    const firstError = errors.length
    try {
      for (const element of spread.elements) if (element.type === 'part') {
        if (element.baseTransform.position.some((n) => n !== 0) || element.baseTransform.rotation.some((n) => n !== 0)
          || element.baseTransform.scale.some((n) => n !== 1) || element.motion.length) throw new Error(`Part transforms must preserve their mount: ${element.id}`)
        if (spread.timeline.tracks.some((track) => track.target.type === 'element' && track.target.elementId === element.id
          && !['opacity', 'visible'].includes(track.property))) throw new Error(`Part timeline must preserve its mount: ${element.id}`)
      }
      for (const element of spread.elements) if (Boolean(element.attachment) !== Boolean(element.presentation)) throw new Error('Content attachment and presentation must be specified together: ' + element.id)
      const inspectMotion = createPaperMotionInspector()
      const { pageWidth, pageAspect } = project.book.format
      for (const side of ['left', 'right'] as const) for (const angle of validationAngles(180)) {
        const left = side === 'left' ? angle * Math.PI / 180 : Math.PI
        const right = side === 'right' ? (180 - angle) * Math.PI / 180 : 0
        const result = evaluateBookParts(project, spread, left, right)
        const bindings = bindBookContents(project, spread, result, left, right)
        if (side === 'left' && angle === 0) errors.push(...inspectContentBindings(bindings))
        const holdTime = bookContentHoldTime(angle, side, spread.sequence.holdSeconds)
        for (const time of holdTime === undefined ? [0, spread.sequence.holdSeconds / 2, spread.sequence.holdSeconds] : [holdTime]) errors.push(...inspectContentsAt(bindings, { openingAngleDeg: angle, maxOpeningAngleDeg: 180, holdTime: time }))
        const input = pagePorts(pageWidth, pageWidth / pageAspect, left, right).gutter
        if ([0, 15, 30, 60, 90, 120, 150, 172.5, 180].includes(angle) && input.kind === 'fold-pair') errors.push(...inspectContentMotion(bindings,
          [...result.faces, input.a, input.b], { openingAngleDeg: angle, maxOpeningAngleDeg: 180 }, spread.sequence.holdSeconds, holdTime))
        errors.push(...inspectMotion(result, [input]).map((message) => `${spread.name}: ${message}`))
        if (angle === 0 && input.kind === 'fold-pair') errors.push(...inspectClosedLayout(deployBookParts(project, spread, result, left, right), pageWidth,
          pageWidth / pageAspect, input.rayA).map((message) => `${spread.name}: ${message}`))
      }
    } catch (error) { errors.push(`${spread.name}: ${error instanceof Error ? error.message : String(error)}`) }
    rememberSpreadInspection(key, errors.slice(firstError))
  }
  return [...new Set(errors)]
}
// 大きな入力や過去の編集を無制限に保持しない。
function rememberSpreadInspection(key: string, errors: string[]): void {
  if (key.length >= 2 * 1024 * 1024) return
  spreadInspections.set(key, errors)
  let retained = [...spreadInspections.keys()].reduce((sum, key) => sum + key.length, 0)
  while (spreadInspections.size > 32 || retained > 8 * 1024 * 1024) {
    const oldest = spreadInspections.keys().next().value!
    retained -= oldest.length; spreadInspections.delete(oldest)
  }
}
/** 別スレッドで検査した結果を受け入れる。同じ設計内容の検査を描画スレッドで繰り返さない。 */
export function seedSpreadInspection(project: Pick<BookProject, 'book' | 'partDefinitions'>, spread: Spread, errors: string[]): void {
  const key = inspectionKey([project.book.format, project.partDefinitions ?? {}]) + '\n' + inspectionKey(spread)
  rememberSpreadInspection(key, errors)
}
export function partIsVisible(spread: Spread, id: string, hidden?: (id: string) => boolean, seen = new Set<string>()): boolean {
  if (id === '$book') return true
  if (seen.has(id)) return false
  seen.add(id)
  const element = spread.elements.find((item) => item.id === id)
  if (!element || !element.visible || element.opacity <= 0 || hidden?.(id)) return false
  const parents = element.type === 'part' ? bindingDependencies(element.part.mount) : element.attachment
    ? [element.attachment.type === 'surface' ? element.attachment.surface.nodeId : element.attachment.elementId] : []
  return parents.every((parent) => partIsVisible(spread, parent, hidden, new Set(seen)))
}
export const paperBoundsPoints = (project: BookProject, spread: Spread) => evaluateBookParts(project, spread, Math.PI, 0).faces.flatMap(faceCorners)
