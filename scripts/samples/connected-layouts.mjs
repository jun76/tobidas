/** 022の配置設計。高さは収納できる紙の寸法、演出の大きさは原作の値を保つ。 */
export const CONNECTED_LAYOUTS = {
  forest_lantern: {
    background: ['canopy', 'canopy', 'ridge', 'great-tree', 'canopy'],
    backgroundSize: [[10.4, 2.8], [10.4, 2.5], [10.4, 2.3], [7.45, 5.65], [10.4, 2.7]],
    scale: 1, backgroundOffset: [-1.7, -1.7, -1.7, -2.65, -1.7],
    paper: {
      // 大きな景観だけ収納寸法を指定する。動物や草花へ一律の縮小率を掛けない。
      ...Object.fromEntries(['spread-1-far-line-l', 'spread-1-far-line-r',
        'spread-2-bank-l', 'spread-2-bank-r', 'spread-2-tree',
        'spread-3-far-hill-l', 'spread-3-far-hill-r', 'spread-3-hill-mid', 'spread-3-hill-mid-r', 'spread-3-tree',
        'spread-4-far-line-l', 'spread-4-far-line-r', 'spread-5-far-line-l', 'spread-5-far-line-r']
        .map((id) => [id, { scale: .76 }])),
      ...Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`spread-5-house-dark-${i + 1}`, { scale: .76 }])),
      ...Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`spread-1-tree-${i + 1}`, { scale: .76, z: -.05 }])),
      'spread-1-tree-5': { scale: .76, x: 6.1, z: .35 },
      'spread-1-far-line-l': { x: -5.25, scale: .76 }, 'spread-1-far-line-r': { x: 5.25, scale: .76 },
      'spread-4-far-line-l': { x: -3.6, scale: .76 }, 'spread-4-far-line-r': { x: 3.6, scale: .76 },
      'spread-1-fox': { x: -1.1, z: 1.5, parent: 'spread-1-rabbit' },
      'spread-2-tree': { z: .15, scale: .76 },
      'spread-4-mushroom': { x: -4.3, parent: 'spread-4-tree-a' },
      'spread-5-house-dark-4': { z: 1.0, scale: .76 }, 'spread-5-house-lit-4': { z: 1.0, scale: .76 },
      // 羽根の回転範囲に接しない上限。交換した部品を逆向きの入力へ置いても支持と交差させない。
      'spread-3-windmill': { scale: .66, x: 3.1, z: -.1, supportCeiling: .54 },
      'spread-3-hill-mid-r': { x: 5.4, parent: 'spread-3-far-hill-r', scale: .76 },
      'spread-4-tree-a': { scale: .66, x: -4.3, z: .35 },
      'spread-4-tree-b': { scale: .66, x: 4.3, z: .35 },
    },
    // 中央の演出は背景の手前に置く。実ページ上の接続点へ縮め、折れる背景を横切らず収納する。
    fiction: {
      'spread-1-ember': { position: [0, 2.4, 1.5], pageAnchor: [4, 2.4] },
      'spread-4-halo': { position: [0, 3.2, 2.9], pageAnchor: [4, 2.9] },
      'spread-5-halo': { position: [0, 3, 1], pageAnchor: [6, 1] },
      'spread-4-lantern': { position: [0, 2.4, 2.5], pageAnchor: [2, 2.9] },
      'spread-5-lantern': { position: [0, 1.6, .9], pageAnchor: [2, .9] },
    },
  },
  morning_walk: {
    background: ['skyline', 'far-row', 'far-row', 'mountain', 'window'],
    backgroundSize: [[14.4, 3.25], [14.4, 3.35], [14.4, 3.2], [14.4, 3.25], [14.2, 3.8]],
    scale: 1, backgroundOffset: -1.8,
    paper: {
      ...Object.fromEntries(['spread-1-house-1', 'spread-1-house-2', 'spread-1-house-3', 'spread-1-house-5', 'spread-1-cherry',
        'spread-2-arcade', 'spread-2-shop-1', 'spread-2-shop-2', 'spread-2-shop-3', 'spread-2-shop-4',
        'spread-4-house-1', 'spread-4-house-2', 'spread-4-house-3', 'spread-4-house-4', 'spread-4-cherry-1', 'spread-4-cherry-2']
        .map((id) => [id, { scale: .74 }])),
      'spread-4-school': { scale: .72, backdrop: true, z: -.9 },
      'spread-1-house-3': { z: -.5, scale: .74 },
      ...Object.fromEntries(['spread-1-pole-1', 'spread-1-pole-2', 'spread-1-pole-3', 'spread-3-pole', 'spread-4-pole-1', 'spread-4-pole-2'].map((id) => [id, { z: -1.3, scale: .74 }])),
      'spread-3-signal': { z: .1, scale: .74 },
      // 車両の通り道を空ける。低い小物は手前の柱へつなぎ、線路を跨ぐ支持だけ屋根より上へ置く。
      'spread-3-post-l': { supportHeight: 1.25, scale: .74 }, 'spread-3-post-r': { supportHeight: 1.25, scale: .74 },
      'spread-3-ped-signal': { supportHeight: 1.25, scale: .74 },
      'spread-3-truck': { x: -2.3, parent: 'spread-3-post-l', supportOffset: -.25 },
      'spread-3-kid-1': { x: -2.9, z: 1.85, parent: 'spread-3-truck' },
      'spread-3-kid-2': { x: -2.25, z: 2.1, parent: 'spread-3-truck' },
      'spread-3-shiba': { x: 4.15, parent: 'spread-3-signal' },
      'spread-1-cherry': { parent: 'spread-1-house-1', scale: .74 },
      'spread-4-house-1': { z: .35, scale: .74 },
      'spread-4-house-4': { z: .35, scale: .74 },
      // 子どもの身長に合わせ、机と椅子を同じ比率で大きくする。
      ...Object.fromEntries(Array.from({ length: 18 }, (_, i) => i + 1)
        .flatMap((i) => ['desk', 'chair'].map((kind) => [`spread-5-${kind}-${i}`, { scale: 1 }]))),
      'spread-5-satchel': { x: -6.45, z: 2, parent: 'spread-5-desk-9' },
    },
    fiction: { 'spread-3-train': { scale: .58,
      route: { from: [-5.8, .005, -.09], to: [5.8, .005, -.09], rotation: [0, 0, 0] } },
      'spread-5-curtain-l': { parent: 'spread-5-window' }, 'spread-5-curtain-r': { parent: 'spread-5-window' },
      'spread-4-climber': { parent: 'spread-4-school', route: { from: [-.9, .01, 2.05], to: [-.22, .01, -.92], rotation: [0, -5, 0] } },
      'spread-5-pupil': { parent: 'spread-5-chair-13', route: { from: [2.7, .01, 1.7], to: [2.95, .01, .55], rotation: [0, 5, 0] } },
      'spread-5-sunbeam': { x: 1.9 } },
  },
  four_seasons: {
    background: ['window', 'window', 'window', 'window', 'window'],
    backgroundSize: Array.from({ length: 5 }, () => [7.03, 3.61]),
    scale: 1, backgroundOffset: -.9,
    paper: {
      ...Object.fromEntries(Array.from({ length: 5 }, (_, i) => i + 1).flatMap(i => [
        [`spread-${i}-curtain-left`, { x: -6.35, z: -.45, parent: `spread-${i}-window` }],
        [`spread-${i}-curtain-right`, { x: 6.35, z: -.45, parent: `spread-${i}-window` }],
      ])),
      'spread-5-keepsake-1': { z: -.2 }, 'spread-5-keepsake-2': { z: .15 },
      'spread-5-keepsake-4': { x: -3.1, z: 1.65, parent: 'spread-5-keepsake-2' }, 'spread-5-keepsake-3': { x: 3.1, z: 1.2, parent: 'spread-5-keepsake-1' } },
    // 途中から現れる小物は支持なし。貝・蝶・葉などを前景で判別できる大きさにする。
    fiction: Object.fromEntries(Array.from({ length: 4 }, (_, index) => {
      const i = index + 1, smallScale = [1.25, 2, 1.4, 1.5][index], accentScale = [1.6, 2.5, 2.8, 2.5][index]
      return [[4.2, i === 2 ? -.75 : i >= 3 ? -.3 : .15, 1], [-3.3, .7, 1],
        [6.2, 1.65, smallScale], [-6.2, 1.65, smallScale], [i === 2 ? -3.3 : 4.2, 1.85, accentScale]]
        .map(([x, z, scale], n) => [`spread-${i}-prop-${n + 1}`, { position: [x, .03, z], pageAnchor: [x, z], scale }])
    }).flat()),
  },
  crooked_castle: {
    background: [], backgroundSize: [], scale: 1, backgroundOffset: -2.2,
    paper: { 'front-left-1': { z: 1.25 }, 'front-right-1': { z: 1.25 },
      'front-left-4': { z: 1.78 }, 'front-right-4': { z: 1.78 },
      'front-left-2': { x: -5.15, z: 2.25, parent: 'fence-left' }, 'front-right-2': { x: 5.3, z: 2.4, parent: 'fence-right' } },
    fiction: { 'bat-swarm': { x: 2.3 }, 'central-twin': { x: 2.5 }, 'back-right-1': { x: 1.2 }, 'mid-right-1': { x: 1.6 },
      'back-left-6': { x: -6.5 },
      'near-left-3': { x: -3.5 }, 'near-right-3': { x: 3.05 },
    },
  },
}
