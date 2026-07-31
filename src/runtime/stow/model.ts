import type { StageElement } from '../../schema/stageElement'

export type FaceSide = 'left' | 'right'
export type MechanismKind = 'page-glue' | 'flap' | 'strut' | 'v-fold'
export type FallDirection = 'back' | 'front' | 'spine' | 'outward'

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
}

export interface SpanningVFold {
  element: Extract<StageElement, { type: 'image' }>
  fall: 'back' | 'front'
  creaseU: number
  widthLeft: number
  widthRight: number
  height: number
  baseY: number
  baseZ: number
}

export interface CompiledSpreadStow {
  left: StowItem[]
  right: StowItem[]
  spanning: SpanningVFold[]
  warnings: string[]
}
