/** 縦置き背景パネルの素材生成と初期配置で共有する標準仕様。 */
export const BACKGROUND_PANEL_SPEC = {
  imageAspectRatio: 1900 / 560,
  imageExample: [1900, 560] as const,
  size: [15.2, 4.48] as const,
  scale: [1, 1, 1] as const,
  position: [4, 0, -2.25] as const,
  pivot: [0.5, 0] as const,
  parent: { type: 'left-page' as const },
  layer: 0,
} as const
