import type { BookProject } from '../schema/bookPackage'
import type { Spread } from '../schema/book'
import type { Asset } from '../schema/assets'
import type { BookRuntimeProps } from '../runtime/types'
import { evaluateBookParts, partIsVisible } from './book'
import { PaperMeshes } from './PaperMeshes'
import { evaluateElementTimeline } from '../runtime/timeline/evaluate'

export function BookPartsRenderer({ project, spread: source, spreadTime, leftAngle, rightAngle, assets, isHidden, onSelect }: {
  project: BookProject; spread: Spread; leftAngle: number; rightAngle: number; assets: Map<string, Asset>
  spreadTime: number
  isHidden?: BookRuntimeProps['isHidden']; onSelect?: BookRuntimeProps['onSelect']
}) {
  try {
    const spread = { ...source, elements: source.elements.map((element) => evaluateElementTimeline(element, source, spreadTime)) }
    const evaluated = evaluateBookParts(project, spread, leftAngle, rightAngle)
    // 薄い紙の評価面は共通ヒンジを保つ。描画だけを本の紙束の最上面へ持ち上げる。
    return <group position={[0, Math.max(.006, project.book.format.pageThickness) + .004, 0]}>{spread.elements.filter((element) => element.type === 'part' && partIsVisible(spread, element.id,
      (id) => Boolean(isHidden?.(spread.id, spread.elements.find((item) => item.id === id)!)))).map((element) => <PaperMeshes
        key={element.id} faces={evaluated.nodes[element.id]?.faces ?? []} assets={assets} opacity={element.opacity}
        onSelect={onSelect ? () => onSelect({ type: 'element', spreadId: spread.id, elementId: element.id }) : undefined} />)}</group>
  } catch {
    // 不適合な下書きはインスペクターの診断で修正する。空中の代替姿勢は描かない。
    return null
  }
}
