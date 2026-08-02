import type { StageElement } from '../../schema/stageElement'

export type FaceSide = 'left' | 'right'
/** 作品へ保存する支持ヒントではなく、コンパイラが開姿勢から決めた収納経路。 */
export type MechanismKind = 'page-glue' | 'flap' | 'airborne-route' | 'v-fold'
export type FallDirection = 'back' | 'front' | 'spine' | 'outward'
export type PlanarElement = Exclude<StageElement, { type: 'group' }>

export interface StowItem {
  element: StageElement
  face: FaceSide
  offset: [number, number, number]
  mechanism: MechanismKind
  fall: FallDirection
  half?: { u0: number; u1: number; width: number; centerShiftX: number }
  phase: number
  fitScale: number
  eject: number
  /** 板の背表紙側の辺から背表紙までの最短距離。安全倒伏角の逆算に使う。 */
  spineClearance: number
  /** 接地線から最も遠い点までの距離。 */
  reach: number
}

export interface SpanningVFold {
  element: PlanarElement
  fall: 'back' | 'front'
  creaseU: number
  widthLeft: number
  widthRight: number
  height: number
  baseY: number
  baseZ: number
  fitScale: number
}

export interface CompiledSpreadStow {
  left: StowItem[]
  right: StowItem[]
  spanning: SpanningVFold[]
  warnings: string[]
}
