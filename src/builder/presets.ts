/** プリセットは保存形式ではなく、よく使う初期姿勢を作るUIショートカット。 */
export type PresetGroup = 'visual' | 'sound'
export type VisualPresetId = 'paper-stack' | 'bottom-upright' | 'depth-layer' | 'light-particles' | 'page-text'

export interface PartPreset {
  id: VisualPresetId
  group: 'visual'
  requiresAsset: boolean
}

export const PART_PRESETS: PartPreset[] = [
  { id: 'paper-stack', group: 'visual', requiresAsset: true },
  { id: 'bottom-upright', group: 'visual', requiresAsset: true },
  { id: 'depth-layer', group: 'visual', requiresAsset: true },
  { id: 'light-particles', group: 'visual', requiresAsset: false },
  { id: 'page-text', group: 'visual', requiresAsset: false },
]

export type PlacementMode = VisualPresetId | 'sound-cue'

export function assetKindForMode(mode: PlacementMode | null): 'image' | 'audio' | null {
  if (mode === 'sound-cue') return 'audio'
  return PART_PRESETS.find((preset) => preset.id === mode)?.requiresAsset ? 'image' : null
}
