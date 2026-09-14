import type { BookProject } from '../schema/bookPackage'
import type { Spread } from '../schema/book'
import type { Asset } from '../schema/assets'
import type { BookRuntimeProps } from '../runtime/types'
import { evaluateBookParts, deployBookParts, partIsVisible } from './book'
import { PaperMeshes } from './PaperMeshes'
import { evaluateElementTimeline } from '../runtime/timeline/evaluate'
import { ContentMeshes } from './ContentMeshes'
import { bindBookContents } from './contents'
import type { ClockStore } from '../runtime/clock'
import { paperDisplayFace, paperDisplayFaces, type BookPaperDisplay } from './paperDisplay'

export function BookPartsRenderer({ project, spread: source, spreadTime, leftAngle, rightAngle, assets, isHidden, onSelect, paperDisplay, clocks, playing }: {
  project: BookProject; spread: Spread; leftAngle: number; rightAngle: number; assets: Map<string, Asset>
  spreadTime: number; clocks: ClockStore; playing: boolean
  paperDisplay: BookPaperDisplay
  isHidden?: BookRuntimeProps['isHidden']; onSelect?: BookRuntimeProps['onSelect']
}) {
  try {
    const spread = { ...source, elements: source.elements.map((element) => evaluateElementTimeline(element, source, spreadTime)) }
    const evaluated = deployBookParts(project, spread, evaluateBookParts(project, spread, leftAngle, rightAngle), leftAngle, rightAngle)
    const displayed = new Map(paperDisplayFaces(evaluated.faces, paperDisplay).map((face) => [face.id, face]))
    const bindings = bindBookContents(project, spread, evaluated, leftAngle, rightAngle)
    const hidden = (id: string) => !partIsVisible(spread, id, (key) => Boolean(isHidden?.(spread.id, spread.elements.find((item) => item.id === key)!)))
    return <group>{spread.elements.filter((element) => element.type === 'part' && partIsVisible(spread, element.id,
      (id) => Boolean(isHidden?.(spread.id, spread.elements.find((item) => item.id === id)!)))).map((element) => <PaperMeshes
        key={element.id} faces={(evaluated.nodes[element.id]?.faces ?? []).map((face) => displayed.get(face.id)!)}
        paperSurfaces={paperDisplay.surfaces} assets={assets} opacity={element.opacity}
        surfaceTarget={{ spreadId: spread.id, nodeId: element.id }}
        onSelect={onSelect ? () => onSelect({ type: 'element', spreadId: spread.id, elementId: element.id }) : undefined} />)}
      <ContentMeshes bindings={bindings} assets={assets} clocks={clocks} clockPrefix={project.id + '/' + spread.id} playing={playing}
        surfaces={paperDisplay.surfaces} context={{ openingAngleDeg: Math.abs(leftAngle - rightAngle) * 180 / Math.PI, maxOpeningAngleDeg: 180, holdTime: spreadTime, hidden,
          displayFace: (face) => displayed.get(face.id) ?? paperDisplayFace(face, paperDisplay) }}
        onSelect={onSelect ? (id) => onSelect({ type: 'element', spreadId: spread.id, elementId: id }) : undefined} />
    </group>
  } catch {
    // 不適合な下書きはインスペクターの診断で修正する。空中の代替姿勢は描かない。
    return null
  }
}
