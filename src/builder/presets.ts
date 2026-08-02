import type { ParentSpace, SourcePreset, StageElement, StageElementType, StowMechanism } from '../schema/stageElement'

/**
 * プリセットの分類。
 *
 * 分類は「何を掴んで置くか」で分かれる。画像は画像アセット、音声は音声アセットを
 * ドラッグして置き、その他はアセットを要さない。
 */
export type PresetGroup = 'image' | 'sound' | 'other'

export interface PartPreset {
  /** 'custom' は「プリセット経由ではない」印なので、プリセット側は名乗らない */
  id: Exclude<SourcePreset, 'custom'>
  group: PresetGroup
  mechanism: StowMechanism
  parent: ParentSpace
  type: StageElementType
  /** 片面へ属するものは、投入先を見開きではなく選択中の紙面から決める */
  singlePage?: true
}

export const PART_PRESETS: PartPreset[] = [
  { id: 'paper-stack', group: 'image', mechanism: 'page-glue', parent: { type: 'right-page' }, type: 'image' },
  { id: 'bottom-upright', group: 'image', mechanism: 'flap', parent: { type: 'right-page' }, type: 'image' },
  { id: 'depth-layer', group: 'image', mechanism: 'flap', parent: { type: 'right-page' }, type: 'image', singlePage: true },
  { id: 'floating-character', group: 'image', mechanism: 'auto', parent: { type: 'spread' }, type: 'image' },
  { id: 'light-particles', group: 'other', mechanism: 'auto', parent: { type: 'spread' }, type: 'effect' },
  { id: 'page-text', group: 'other', mechanism: 'page-glue', parent: { type: 'right-page' }, type: 'text', singlePage: true },
]

/**
 * 掴んで置くプリセットの選択 (モード)。押した瞬間に用が済むボタン
 * (BGM・パーティクル・テキスト) はここへ入らない。
 *
 * 'sound-cue' は要素を作らないので PART_PRESETS には無い。効果音は
 * タイムラインの点であって紙面の部品ではない。
 */
export type PlacementMode = Exclude<SourcePreset, 'custom'> | 'sound-cue'

/** そのモードで掴めるアセットの種類。アセット一覧の絞り込みもこれで決める */
export function assetKindForMode(mode: PlacementMode | null): 'image' | 'audio' | null {
  if (mode === null) return null
  if (mode === 'sound-cue') return 'audio'
  return PART_PRESETS.find((preset) => preset.id === mode)?.group === 'image' ? 'image' : null
}

export function presetForElement(element: StageElement): PartPreset | undefined {
  return PART_PRESETS.find((preset) => preset.id === element.sourcePreset)
}

export function parentForPreset(preset: PartPreset, selectedPage?: 'left' | 'right'): ParentSpace {
  if (!preset.singlePage) return structuredClone(preset.parent)
  return { type: `${selectedPage ?? 'right'}-page` }
}
