import type { BookProject } from '../schema/bookPackage'
import type { Spread } from '../schema/book'
import type { Asset } from '../schema/assets'
import type { BookRuntimeProps } from '../runtime/types'
import { evaluateBookParts, partIsVisible } from './book'
import { PaperMeshes } from './PaperMeshes'
import { evaluateElementTimeline } from '../runtime/timeline/evaluate'
import { paperDisplayFace, type BookPaperDisplay } from './paperDisplay'

export function BookPartsRenderer({ project, spread: source, spreadTime, leftAngle, rightAngle, assets, isHidden, onSelect, paperDisplay }: {
  project: BookProject; spread: Spread; leftAngle: number; rightAngle: number; assets: Map<string, Asset>
  spreadTime: number
  paperDisplay: BookPaperDisplay
  isHidden?: BookRuntimeProps['isHidden']; onSelect?: BookRuntimeProps['onSelect']
}) {
  try {
    const spread = { ...source, elements: source.elements.map((element) => evaluateElementTimeline(element, source, spreadTime)) }
    const evaluated = evaluateBookParts(project, spread, leftAngle, rightAngle)
    return <group>{spread.elements.filter((element) => element.type === 'part' && partIsVisible(spread, element.id,
      (id) => Boolean(isHidden?.(spread.id, spread.elements.find((item) => item.id === id)!)))).map((element) => <PaperMeshes
        key={element.id} faces={(evaluated.nodes[element.id]?.faces ?? []).map((face) => paperDisplayFace(face, paperDisplay))}
        paperSurfaces={paperDisplay.surfaces} assets={assets} opacity={element.opacity}
        surfaceTarget={{ spreadId: spread.id, nodeId: element.id }}
        onSelect={onSelect ? () => onSelect({ type: 'element', spreadId: spread.id, elementId: element.id }) : undefined} />)}</group>
  } catch {
    // 不適合な下書きはインスペクターの診断で修正する。空中の代替姿勢は描かない。
    return null
  }
}
