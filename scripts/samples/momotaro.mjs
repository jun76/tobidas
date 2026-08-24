/**
 * 桃太郎を題材にした和紙切り絵風の作例。
 *
 * AIモードで組んだ構図を公開作例へ固定する。
 * 紙面は地面だけを描き、輪郭を持つ山里や建物は遠景の立ち板へ分離する。
 */
import { REAL, defineWork, rect, scaleOf, svg } from './shared.mjs'

/**
 * 人物の縮尺。
 * 片面8単位を約4.2mとみなし、子どもと大人の身長差を同じ縮尺で保つ。
 */
const village = scaleOf(.52)

/**
 * 遠景は人物と別の縮尺を持つ劇場の書き割りとして扱う。
 * 見開き全幅より少し狭くし、小口側へ素の紙が残らない範囲で安全余白を取る。
 */
const BACKDROP = { width: 14.4, height: 3.6, u: 0, v: .15 }

const C = {
  paper: '#f3dfb2',
  edge: '#bf8751',
  sky: '#244e78',
  ink: '#2d2b2a',
  warm: '#f5c55d',
}

export function build(updatedAt) {
  const work = defineWork({
    id: 'momotaro',
    title: 'Momotaro: The Peach Boy',
    description: 'A washi-paper pop-up retelling about courage, friendship, and sharing. Created through the AI workspace workflow.',
    theme: 'washi-cut-paper',
    updatedAt,
    appearance: {
      paperColor: C.paper,
      edgeColor: C.edge,
      roughness: .9,
      background: C.sky,
      shadowOpacity: .3,
    },
    camera: { position: [0, 8.6, 12.2], target: [0, 1, .1], fov: 44 },
    lights: {
      ambient: { color: '#fff5dc', intensity: 1.15 },
      directional: { color: '#ffd9a3', intensity: 1.6, position: [-4, 9, 6] },
    },
    cover: { front: 'cover-front.svg', inside: 'cover-inside.svg', back: 'cover-inside.svg' },
  })
  const { art, wide } = work

  /**
   * 生成画像の実体は同名WebPが持つ。
   * SVGは配置寸法の下書きだけを担い、実寸と縦横比はWebPから取得する。
   */
  const adopted = (id, width, height, opaque = false) => art(
    id,
    svg(width, height, rect(0, 0, width, height, opaque ? C.paper : '#00000000')),
    opaque ? { opaque: true } : {},
  )

  adopted('cover-front.svg', 1250, 1000, true)
  adopted('cover-inside.svg', 1250, 1000, true)

  const pages = Array.from({ length: 5 }, (_, index) => ({
    left: adopted(`page-${index + 1}-left.svg`, 1250, 1000, true),
    right: adopted(`page-${index + 1}-right.svg`, 1250, 1000, true),
  }))
  const backdrops = {
    river: adopted('backdrop-river.svg', 1984, 496, true),
    gate: adopted('backdrop-gate.svg', 1984, 496, true),
    meadow: adopted('backdrop-meadow.svg', 1984, 496, true),
    island: adopted('backdrop-island.svg', 1984, 496, true),
    home: adopted('backdrop-home.svg', 1984, 496, true),
  }
  const peach = adopted('peach.svg', 1185, 1142)
  const grandparents = adopted('grandparents.svg', 955, 1200)
  const momotaro = adopted('momotaro.svg', 665, 1200)
  const companions = adopted('companions.svg', 1200, 968)
  const ogres = adopted('ogres.svg', 1200, 804)
  const treasure = adopted('treasure.svg', 1200, 872)

  const addBackdrop = (spread, asset, name) => spread.stand('left', {
    id: 'backdrop',
    name,
    asset,
    ...BACKDROP,
    layer: 1,
    backdrop: true,
    fall: 'front',
  })

  /**
   * 保持中はカメラをわずかに寄せる。
   * 主役の紙片を大きく揺らさず、静かな絵本らしさの中に時間変化を作る。
   */
  const addCamera = (spread, targetX = 0) => spread.camera([
    { time: 0, position: [0, 8.6, 12.2], target: [targetX, 1, .1], fov: 44 },
    { time: spread.hold, position: [0, 8.35, 11.8], target: [targetX, 1.08, .15], fov: 43 },
  ])

  const adultHeight = village(REAL.adult)
  const heroHeight = village(1.4)
  const groupHeight = village(1.65)
  const ogreHeight = village(1.4)
  const peachHeight = village(1.2)
  const treasureHeight = village(1.15)

  {
    const s = work.spread({
      name: 'The Peach on the River',
      hold: 6,
      turn: 1.7,
      leftPage: pages[0].left,
      rightPage: pages[0].right,
    })
    addBackdrop(s, backdrops.river, 'River village backdrop')
    s.stand('left', {
      id: 'grandparents',
      name: 'Grandparents by the river',
      asset: grandparents,
      u: .5,
      v: .56,
      width: wide(adultHeight, grandparents),
      height: adultHeight,
      layer: 5,
    })
    s.stand('right', {
      id: 'peach',
      name: 'The giant peach',
      asset: peach,
      u: .58,
      v: .52,
      width: wide(peachHeight, peach),
      height: peachHeight,
      layer: 6,
      motion: [{ type: 'sway', amplitude: 1.6, period: 4.8, phase: .4 }],
    })
    s.caption('right', {
      id: 'caption',
      text: 'A giant peach arrived.',
      u: .5,
      v: .88,
      size: .4,
      color: C.ink,
    })
    s.sparkle({ id: 'glimmer', name: 'Peach glimmer', x: 4.8, y: 1.35, z: .2, color: '#fff0a5', size: 1.8 })
    addCamera(s, .25)
  }

  {
    const s = work.spread({
      name: 'A Brave Child Sets Out',
      hold: 6,
      turn: 1.7,
      leftPage: pages[1].left,
      rightPage: pages[1].right,
    })
    addBackdrop(s, backdrops.gate, 'Village gate backdrop')
    s.stand('left', {
      id: 'momotaro',
      name: 'Momotaro sets out',
      asset: momotaro,
      u: .5,
      v: .57,
      width: wide(heroHeight, momotaro),
      height: heroHeight,
      layer: 6,
      motion: [{ type: 'bob', amplitude: .035, period: 3.8, phase: .2 }],
    })
    s.caption('right', {
      id: 'caption',
      text: 'Momotaro set out.',
      u: .5,
      v: .88,
      size: .4,
      color: C.ink,
    })
    addCamera(s, -.35)
  }

  {
    const s = work.spread({
      name: 'Three New Friends',
      hold: 6,
      turn: 1.7,
      leftPage: pages[2].left,
      rightPage: pages[2].right,
    })
    addBackdrop(s, backdrops.meadow, 'Mountain meadow backdrop')
    s.stand('left', {
      id: 'friends',
      name: 'Momotaro and three friends',
      asset: companions,
      u: .5,
      v: .56,
      width: wide(groupHeight, companions),
      height: groupHeight,
      layer: 6,
      motion: [{ type: 'sway', amplitude: 1.1, period: 5.2, phase: .7 }],
    })
    s.caption('right', {
      id: 'caption',
      text: 'Three friends joined him.',
      u: .5,
      v: .88,
      size: .4,
      color: C.ink,
    })
    addCamera(s, -.25)
  }

  {
    const s = work.spread({
      name: 'The Promise at Ogre Island',
      hold: 6.5,
      turn: 1.8,
      leftPage: pages[3].left,
      rightPage: pages[3].right,
    })
    addBackdrop(s, backdrops.island, 'Ogre Island backdrop')
    s.stand('left', {
      id: 'friends',
      name: 'Friends at Ogre Island',
      asset: companions,
      u: .5,
      v: .56,
      width: wide(groupHeight, companions),
      height: groupHeight,
      layer: 6,
    })
    s.stand('right', {
      id: 'ogres',
      name: 'The peaceful ogres',
      asset: ogres,
      u: .52,
      v: .53,
      width: wide(ogreHeight, ogres),
      height: ogreHeight,
      layer: 6,
    })
    s.caption('right', {
      id: 'caption',
      text: 'Together, they made peace.',
      u: .5,
      v: .89,
      size: .38,
      color: C.ink,
    })
    addCamera(s)
  }

  {
    const s = work.spread({
      name: 'Home Together',
      hold: 6.5,
      turn: 1.8,
      leftPage: pages[4].left,
      rightPage: pages[4].right,
    })
    addBackdrop(s, backdrops.home, 'Homecoming village backdrop')
    s.stand('left', {
      id: 'friends',
      name: 'Friends return home',
      asset: companions,
      u: .5,
      v: .56,
      width: wide(groupHeight, companions),
      height: groupHeight,
      layer: 6,
    })
    s.stand('right', {
      id: 'treasure',
      name: 'Returned village goods',
      asset: treasure,
      u: .55,
      v: .54,
      width: wide(treasureHeight, treasure),
      height: treasureHeight,
      layer: 6,
    })
    s.caption('right', {
      id: 'caption',
      text: 'The village shared a feast.',
      u: .5,
      v: .89,
      size: .38,
      color: C.ink,
    })
    addCamera(s, .15)
  }

  work.bgm('bgm.mp3')
  work.pageTurns('page-turn.wav')
  return work
}
