/**
 * 森の灯りを探して (クレヨン・絵本風)。
 *
 * 王道の飛び出す絵本として組む。各見開きは
 *   遠景の立ち板 → 中央線をまたぐ樹冠 → 中景の立ち板 → 前景の平置き
 * という紙の層で構成し、空中に浮くのは光の欠片だけとする。
 */
import { BACKDROP_WIDTH, PAGE_ART, REAL, artSize, circle, defineWork, ellipse, group, path, poly, rect, scaleOf, svg } from './shared.mjs'

/**
 * 縮尺。片面 8 単位が約 14.4m の林床にあたる。
 * 木と家がこの舞台に収まる上限で、これより粗くすると生きものが点になる。
 * きつねとアナグマは道具を持って歩く登場人物なので、野生の寸法ではなく
 * 立ち上がった背丈 (0.8m / 1.1m) で置く。
 */
const forest = scaleOf(1.8)

/**
 * 登場人物の背丈。きつねもアナグマも外套を着て灯りを提げて歩くので、
 * 野生の寸法ではなく人の背丈で置く。家の戸口 (2m) に見合う大きさが下限で、
 * これを下回ると主役が林床の点になる。鹿だけは実寸のまま。
 */
const CAST = { fox: 1.5, badger: 1.7, deer: 1.6 }

const INK = '#20303f'
const C = {
  duskSky: '#3b4b66',
  night: '#141f33',
  moss: '#2f5545',
  mossLight: '#3f6b53',
  bark: '#5b4433',
  lantern: '#ffcf6d',
  glow: '#ffe9a8',
  water: '#3d6b7d',
  clay: '#8c5b3f',
}

export function build(updatedAt) {
  const work = defineWork({
    id: 'forest_lantern',
    title: 'Chasing the Forest Lantern',
    description: 'A crayon-storybook chase after a lantern lost in the twilight forest.',
    theme: 'crayon-storybook',
    updatedAt,
    appearance: {
      paperColor: '#efe3c8', edgeColor: '#c3ad86', roughness: .92,
      background: C.duskSky, shadowOpacity: .34,
    },
    camera: { position: [0, 8.8, 12.2], target: [0, 1.0, .2], fov: 44 },
    lights: {
      ambient: { color: '#cfd8ef', intensity: 1.0 },
      directional: { color: '#ffd9a8', intensity: 1.5, position: [-5, 9, 6] },
    },
    cover: { front: 'cover-front.svg', inside: 'cover-inside.svg', back: 'cover-back.svg' },
  })
  // wide(高さ, 素材) は縦横比を実WebPから引く。余白を切っても定義は追従する
  const { art, wide } = work

  // --- 下書き素材 ---------------------------------------------------------
  /**
   * 紙面の地面。空も稜線も描かない。遠景の木立や丘は必ず立ち板として立てる。
   * 紙に描いた地平線は、その前に立てた板と二重の奥行きになって濁る。
   */
  const ground = (id, soil, patch) => art(id, svg(PAGE_ART.width, PAGE_ART.height, group(
    rect(0, 0, 1250, 1000, soil),
    ...[[180, 300], [520, 640], [900, 520], [1100, 800], [330, 860], [700, 160]].map(([x, y]) =>
      ellipse(x, y, 150, 58, patch, ' opacity=".38"')),
  )), { opaque: true })

  /**
   * scripts/adopt-alt-asset.mjs で取り込んだ森の住人と下草。
   * 下書きは占める寸法の宣言だけを担い、絵は同名の生成済みWebPが持つ。
   */
  const adopted = (id, width, height) => art(id, svg(width, height,
    rect(0, 0, width, height, C.moss, ' opacity=".22"')))

  const fir = (id, body, tip) => {
    const s = artSize(1.6, 2.6)
    return art(id, svg(s.width, s.height, group(
      rect(s.width * .44, s.height * .74, s.width * .12, s.height * .26, C.bark),
      poly([[s.width * .5, 0], [s.width * .96, s.height * .42], [s.width * .74, s.height * .40], [s.width * .93, s.height * .78],
        [s.width * .07, s.height * .78], [s.width * .26, s.height * .40], [s.width * .04, s.height * .42]], body),
      poly([[s.width * .5, s.height * .06], [s.width * .76, s.height * .40], [s.width * .24, s.height * .40]], tip),
    )))
  }

  const roundTree = (id, body, light) => {
    const s = artSize(1.8, 2.2)
    return art(id, svg(s.width, s.height, group(
      rect(s.width * .45, s.height * .62, s.width * .1, s.height * .38, C.bark),
      circle(s.width * .5, s.height * .36, s.height * .34, body),
      circle(s.width * .28, s.height * .48, s.height * .22, body),
      circle(s.width * .73, s.height * .46, s.height * .2, body),
      circle(s.width * .40, s.height * .28, s.height * .13, light, ' opacity=".5"'),
    )))
  }

  const canopy = (id) => {
    const s = artSize(9.4, 2.8)
    return art(id, svg(s.width, s.height, group(
      path(`M0 ${s.height} Q${s.width * .12} ${s.height * .18} ${s.width * .3} ${s.height * .46} Q${s.width * .42} ${s.height * .02} ${s.width * .5} ${s.height * .3} Q${s.width * .6} ${s.height * .02} ${s.width * .71} ${s.height * .46} Q${s.width * .88} ${s.height * .16} ${s.width} ${s.height}Z`, C.moss),
      path(`M${s.width * .18} ${s.height} Q${s.width * .3} ${s.height * .5} ${s.width * .44} ${s.height} Z`, C.mossLight, ' opacity=".55"'),
      path(`M${s.width * .58} ${s.height} Q${s.width * .7} ${s.height * .52} ${s.width * .84} ${s.height} Z`, C.mossLight, ' opacity=".45"'),
      ...[[.22, .58], [.5, .42], [.78, .6]].map(([u, v]) => circle(s.width * u, s.height * v, s.height * .045, C.glow, ' opacity=".8"')),
    )))
  }

  const bigTree = (id) => {
    const s = artSize(8.6, 3.6)
    return art(id, svg(s.width, s.height, group(
      path(`M${s.width * .44} ${s.height} L${s.width * .47} ${s.height * .46} L${s.width * .53} ${s.height * .46} L${s.width * .56} ${s.height}Z`, C.bark),
      path(`M${s.width * .47} ${s.height * .52} L${s.width * .2} ${s.height * .3} M${s.width * .53} ${s.height * .52} L${s.width * .8} ${s.height * .32}`, 'none', ` stroke="${C.bark}" stroke-width="${s.height * .035}"`),
      ellipse(s.width * .5, s.height * .3, s.width * .42, s.height * .3, C.moss),
      ellipse(s.width * .28, s.height * .38, s.width * .17, s.height * .2, C.mossLight, ' opacity=".6"'),
      ellipse(s.width * .72, s.height * .34, s.width * .15, s.height * .18, C.mossLight, ' opacity=".5"'),
      circle(s.width * .5, s.height * .34, s.height * .1, C.lantern),
      circle(s.width * .5, s.height * .34, s.height * .17, C.glow, ' opacity=".35"'),
    )))
  }

  /**
   * 家。灯る前と灯ったあとを同じ位置に重ねて切り替えるので、
   * 2枚の絵は輪郭が1画素ずれてもいけない。
   *
   * cottage-dark.webp は cottage-lit.webp から作る。別々に描き起こすと
   * 屋根や煙突の形が違ってしまい、重なった2枚が二重像として見える。
   * 作り直すときは灯ったほうだけを差し替えて、暗いほうはこれで導出する:
   *
   *   magick scripts/samples/assets/forest_lantern/cottage-lit.webp \
   *     -modulate 46,22,118 -fill '#2a3452' -colorize 26% \
   *     -quality 88 -define webp:method=6 \
   *     scripts/samples/assets/forest_lantern/cottage-dark.webp
   *
   * 明度を落とすだけでは窓の暖色が残って「消し忘れの灯り」に見えるので、
   * 彩度 (22) まで落として窓を硝子の色へ戻す。
   */
  const cottage = (id, wall, roof, lit) => {
    const s = artSize(1.5, 1.4)
    return art(id, svg(s.width, s.height, group(
      rect(s.width * .16, s.height * .42, s.width * .68, s.height * .58, wall),
      poly([[s.width * .06, s.height * .44], [s.width * .5, s.height * .05], [s.width * .94, s.height * .44]], roof),
      rect(s.width * .38, s.height * .58, s.width * .24, s.height * .24, lit),
      rect(s.width * .62, s.height * .7, s.width * .14, s.height * .3, INK, ' opacity=".35"'),
    )))
  }

  const reeds = (id, color) => {
    const s = artSize(2.4, 1.3)
    return art(id, svg(s.width, s.height, group(
      ...[.1, .25, .4, .55, .7, .88].map((u, i) => path(
        `M${s.width * u} ${s.height} Q${s.width * (u + .04)} ${s.height * .4} ${s.width * (u + (i % 2 ? .1 : -.06))} ${s.height * .06}`,
        'none', ` stroke="${color}" stroke-width="${s.height * .06}" stroke-linecap="round"`)),
    )))
  }

  const hill = (id, color, accent) => {
    const s = artSize(6.4, 1.8)
    return art(id, svg(s.width, s.height, group(
      path(`M0 ${s.height} Q${s.width * .22} ${s.height * .1} ${s.width * .48} ${s.height * .42} Q${s.width * .72} ${s.height * .02} ${s.width} ${s.height}Z`, color),
      path(`M${s.width * .55} ${s.height} Q${s.width * .74} ${s.height * .3} ${s.width * .92} ${s.height}Z`, accent, ' opacity=".5"'),
    )))
  }

  const millTower = (id) => {
    const s = artSize(1.4, 2.2)
    return art(id, svg(s.width, s.height, group(
      poly([[s.width * .22, s.height], [s.width * .36, s.height * .28], [s.width * .64, s.height * .28], [s.width * .78, s.height]], C.clay),
      poly([[s.width * .26, s.height * .3], [s.width * .5, s.height * .06], [s.width * .74, s.height * .3]], '#a8724d'),
      rect(s.width * .42, s.height * .6, s.width * .16, s.height * .4, '#5d3a28'),
    )))
  }

  /** 風車の羽根。塔の軸へ子部品として取り付け、住人時間で回り続ける */
  const millRotor = (id) => {
    const s = artSize(1.5, 1.5)
    return art(id, svg(s.width, s.height, group(
      ...[0, 90, 180, 270].map((deg) => `<rect x="${s.width * .47}" y="${s.height * .06}" width="${s.width * .06}" height="${s.height * .4}" fill="${C.glow}" opacity=".9" transform="rotate(${deg} ${s.width * .5} ${s.height * .5})"/>`),
      circle(s.width * .5, s.height * .5, s.width * .06, INK),
    )))
  }

  const fox = (id) => {
    const s = artSize(1.1, 1.0)
    return art(id, svg(s.width, s.height, group(
      ellipse(s.width * .45, s.height * .66, s.width * .3, s.height * .22, '#d9793c'),
      path(`M${s.width * .1} ${s.height * .72} Q${s.width * .02} ${s.height * .4} ${s.width * .2} ${s.height * .46}Z`, '#e79a5e'),
      circle(s.width * .72, s.height * .48, s.width * .16, '#d9793c'),
      poly([[s.width * .62, s.height * .38], [s.width * .66, s.height * .14], [s.width * .76, s.height * .34]], '#b85f2c'),
      poly([[s.width * .8, s.height * .34], [s.width * .86, s.height * .14], [s.width * .9, s.height * .38]], '#b85f2c'),
      circle(s.width * .78, s.height * .46, s.width * .022, INK),
      ...[.32, .5, .62].map((u) => rect(s.width * u, s.height * .84, s.width * .06, s.height * .14, '#b85f2c')),
    )))
  }

  const lantern = (id) => {
    const s = artSize(0.9, 1.2)
    return art(id, svg(s.width, s.height, group(
      circle(s.width * .5, s.height * .52, s.width * .34, C.glow, ' opacity=".28"'),
      rect(s.width * .3, s.height * .3, s.width * .4, s.height * .44, C.lantern),
      rect(s.width * .26, s.height * .26, s.width * .48, s.height * .06, C.bark),
      rect(s.width * .26, s.height * .72, s.width * .48, s.height * .06, C.bark),
      path(`M${s.width * .34} ${s.height * .26} Q${s.width * .5} ${s.height * .04} ${s.width * .66} ${s.height * .26}`, 'none', ` stroke="${C.bark}" stroke-width="${s.width * .05}"`),
    )))
  }

  const mote = (id) => {
    const s = artSize(0.6, 0.6)
    return art(id, svg(s.width, s.height, group(
      circle(s.width * .5, s.height * .5, s.width * .48, C.glow, ' opacity=".22"'),
      circle(s.width * .5, s.height * .5, s.width * .26, C.lantern),
      circle(s.width * .42, s.height * .42, s.width * .1, '#fff', ' opacity=".85"'),
    )))
  }

  const flower = (id, petal) => {
    const s = artSize(0.8, 0.9)
    return art(id, svg(s.width, s.height, group(
      path(`M${s.width * .5} ${s.height} L${s.width * .5} ${s.height * .4}`, 'none', ` stroke="${C.mossLight}" stroke-width="${s.width * .07}"`),
      ...[0, 72, 144, 216, 288].map((deg) => `<ellipse cx="${s.width * .5}" cy="${s.height * .2}" rx="${s.width * .12}" ry="${s.height * .16}" fill="${petal}" transform="rotate(${deg} ${s.width * .5} ${s.height * .34})"/>`),
      circle(s.width * .5, s.height * .34, s.width * .09, C.lantern),
    )))
  }

  art('cover-front.svg', svg(PAGE_ART.width, PAGE_ART.height, group(
    rect(0, 0, 1250, 1000, C.night),
    path('M0 1000 Q210 560 430 780 Q640 470 880 760 Q1060 560 1250 1000Z', C.moss),
    circle(625, 330, 70, C.lantern),
    circle(625, 330, 130, C.glow, ' opacity=".22"'),
    ...[[220, 250], [1020, 220], [880, 400], [330, 430]].map(([x, y]) => circle(x, y, 9, C.glow, ' opacity=".7"')),
  )), { opaque: true })
  art('cover-inside.svg', svg(PAGE_ART.width, PAGE_ART.height, group(
    rect(0, 0, 1250, 1000, '#25384c'),
    ...Array.from({ length: 26 }, (_, i) => circle(70 + (i % 7) * 185, 120 + Math.floor(i / 7) * 250, 26, C.moss, ' opacity=".55"')),
  )), { opaque: true })
  art('cover-back.svg', svg(PAGE_ART.width, PAGE_ART.height,
    rect(0, 0, 1250, 1000, C.night)), { opaque: true })

  const firDark = fir('tree-fir-dark.svg', '#24463a', '#2e5745')
  const firMid = fir('tree-fir-mid.svg', C.moss, C.mossLight)
  const treeRound = roundTree('tree-round.svg', C.mossLight, C.lantern)
  const treeRoundDark = roundTree('tree-round-dark.svg', '#274a3d', C.glow)
  const canopyArt = canopy('canopy-arch.svg')
  const bigTreeArt = bigTree('great-tree.svg')
  const cottageLit = cottage('cottage-lit.svg', '#7d6a52', '#8c4a3a', C.lantern)
  const cottageDark = cottage('cottage-dark.svg', '#4a4438', '#5a3830', '#2b3242')
  const reedArt = reeds('reeds.svg', '#4d7a5e')
  const hillFar = hill('hill-far.svg', '#33506b', '#3d5f7d')
  const hillNear = hill('hill-near.svg', '#2f5545', C.mossLight)
  const millTowerArt = millTower('windmill-tower.svg')
  const millRotorArt = millRotor('windmill-rotor.svg')
  const foxArt = fox('fox.svg')
  const lanternArt = lantern('lantern.svg')
  const moteArt = mote('light-mote.svg')
  const flowerArt = flower('flower.svg', '#e6a3c4')

  // 紙面から抜いた森の細部を、立ち上がる部品として戻す
  const owlArt = adopted('owl.svg', 177, 209)
  const deerArt = adopted('deer.svg', 207, 342)
  const badgerArt = adopted('badger.svg', 220, 266)
  const rabbitArt = adopted('rabbit.svg', 139, 171)
  const mushroomArt = adopted('mushroom-cluster.svg', 158, 190)
  const fernArt = adopted('fern-cluster.svg', 190, 190)
  const logArt = adopted('fallen-log.svg', 456, 177)
  const bridgeArt = adopted('wooden-bridge.svg', 570, 266)

  // --- 見開き1: 暗くなった森 -----------------------------------------------
  {
    const s = work.spread({
      name: '暗くなった森', hold: 6.5,
      leftPage: ground('page-1-left.svg', '#2b4136', '#35513f'),
      rightPage: ground('page-1-right.svg', '#2b4136', '#35513f'),
    })
    s.stand('left', { id: 'far-line-l', name: '遠くの木立 (左)', asset: firDark, u: .5, v: .11, width: BACKDROP_WIDTH, height: 2.2, backdrop: true, layer: 0 })
    s.stand('right', { id: 'far-line-r', name: '遠くの木立 (右)', asset: firDark, u: .5, v: .11, width: BACKDROP_WIDTH, height: 2.2, backdrop: true, layer: 0 })
    s.stand('right', { id: 'canopy', name: '森の樹冠', asset: canopyArt, u: 0, width: 9.4, height: 2.8, v: .22, layer: 2 })

    // 背の高い立ち板は樹冠の二翼が前へ倒れる帯 (v = .22 から高さ 2.8 ぶん = v .66 まで) の
    // 外に置く。中にいると、降りてくる樹冠の翼を突き抜けないよう収納コンパイラが
    // 開き位相を 0.7 台まで遅らせ、その木だけ 140° まで寝たままになる。
    // 紙のほうが正しいので、木を前へ出して帯から抜く
    const trees = [
      { page: 'left', u: .30, v: .68, w: 2.47, h: 3.63, asset: firMid },
      { page: 'left', u: .66, v: .78, w: 2.18, h: 3.05, asset: treeRoundDark },
      { page: 'right', u: .28, v: .70, w: 2.61, h: 3.77, asset: treeRound },
      { page: 'right', u: .62, v: .68, w: 2.32, h: 3.34, asset: firMid },
      { page: 'right', u: .85, v: .82, w: 2.03, h: 2.76, asset: firDark },
    ]
    // 起立はトラックで作らない。収納機構 (flap) が二面角で駆動するのに任せる。
    // タイムラインの時刻は保持区間に入るまで 0 なので、rotation.x のトラックで
    // 起こすと「見開きが開き切ってから、あらためて起き上がる」動きにしかならない。
    // 他の見開きは開きと同時に立つので、ここだけ手順が二段になって鈍く見えていた
    trees.forEach((tree, index) => {
      s.stand(tree.page, {
        id: `tree-${index + 1}`, name: `起き上がる木 ${index + 1}`, asset: tree.asset,
        u: tree.u, v: tree.v, width: tree.w, height: tree.h, fall: 'back', layer: 3 + index,
        motion: [{ type: 'sway', amplitude: 1.1, period: 4.2 + index * .4, phase: index * .7 }],
      })
    })
    s.stand('right', { id: 'owl', name: '枝のフクロウ', asset: owlArt, u: .14, v: .74, width: wide(forest(.75), owlArt), height: forest(.75), fall: 'back', layer: 8 })
    s.stand('left', { id: 'rabbit', name: '草むらのウサギ', asset: rabbitArt, u: .14, v: .84, width: wide(forest(.6), rabbitArt), height: forest(.6), fall: 'back', layer: 8 })
    s.stand('right', { id: 'mushroom', name: '光るキノコ', asset: mushroomArt, u: .46, v: .90, width: wide(forest(.6), mushroomArt), height: forest(.6), fall: 'back', layer: 8 })
    s.stand('right', { id: 'fern', name: 'シダの下草', asset: fernArt, u: .82, v: .88, width: forest(.9), height: forest(.9), fall: 'back', layer: 8 })
    // 子ぎつねは背表紙のきわ (本の中心) へ。小口ぎわに置くと、立っていても寝かせても
    // 同じ面の文字へかぶさる (文字の板は x=±2.71 まで届く)。開きと同時に flap で
    // 起きるだけにして、フェードインは持たせない
    s.stand('left', { id: 'fox', name: '子ぎつね', asset: foxArt, u: .08, v: .74, width: wide(forest(CAST.fox), foxArt), height: forest(CAST.fox), fall: 'back', layer: 9 })
    s.caption('left', { id: 'text', text: 'The lamp that lit the village\nblinked out one night', u: .5, v: .91, size: .42, color: '#efe3c4' })
    // 粒子は手前の木立より前へ出す。z=.6 では5本すべての木の裏に回り、
    // 一粒も見えなかった (木立は z=.64〜2.05)
    const glow = s.sparkle({ id: 'ember', name: '消えゆく残り火', x: .6, y: 2.4, z: 1.9, color: C.lantern, size: 2.0 })

    s.track(glow, 'effect.size', [[0, 2.4], [6.5, .5]])
    s.track(glow, 'effect.color', [[0, C.lantern], [6.5, '#4a5a78']])
    s.camera([
      { time: 0, position: [0, 9.4, 13.2], target: [0, .9, .2], fov: 44 },
      { time: 6.5, position: [-.8, 7.4, 10.4], target: [-.4, 1.1, .2], fov: 43 },
    ])
    s.environment([
      { time: 0, background: C.duskSky, 'ambient.intensity': 1.05, 'directional.intensity': 1.5 },
      { time: 6.5, background: '#233248', 'ambient.intensity': .72, 'directional.intensity': .9 },
    ])
  }

  // --- 見開き2: 川辺の手がかり ---------------------------------------------
  {
    const s = work.spread({
      name: '川辺の手がかり', hold: 6.5,
      leftPage: ground('page-2-left.svg', '#2a3b46', '#33505c'),
      rightPage: ground('page-2-right.svg', '#2a3b46', '#33505c'),
    })
    s.stand('left', { id: 'bank-l', name: '対岸の木立', asset: firDark, u: .5, v: .12, width: BACKDROP_WIDTH, height: 2.3, backdrop: true })
    s.stand('right', { id: 'bank-r', name: '対岸の木立 (右)', asset: firDark, u: .5, v: .12, width: BACKDROP_WIDTH, height: 2.3, backdrop: true })
    s.stand('right', { id: 'canopy', name: '川面へ差し出す枝', asset: canopyArt, u: 0, width: 8.6, height: 2.4, v: .24, layer: 2 })
    // 水面に流れの筋を敷く平らな部品がここにあったが、渡せる絵が岸の草しかなく、
    // 川の真ん中に草が寝そべって見えていた。水面は紙面背景が持っているので置かない
    s.stand('left', { id: 'reed-1', name: '岸の草 (左)', asset: reedArt, u: .30, v: .74, width: 2.2, height: 1.2, fall: 'back', layer: 4 })
    s.stand('right', { id: 'reed-2', name: '岸の草 (右)', asset: reedArt, u: .34, v: .80, width: 2.4, height: 1.3, fall: 'back', layer: 4 })
    s.stand('right', { id: 'reed-3', name: '岸の草 (奥)', asset: reedArt, u: .74, v: .62, width: 1.8, height: 1.1, fall: 'back', layer: 3 })
    s.stand('left', { id: 'fox', name: '子ぎつね', asset: foxArt, u: .84, v: .72, width: wide(forest(CAST.fox), foxArt), height: forest(CAST.fox), fall: 'back', layer: 9 })
    s.stand('right', { id: 'tree', name: '川辺の木', asset: treeRound, u: .82, v: .70, width: 2.47, height: 3.48, fall: 'back', layer: 5 })
    s.stand('right', { id: 'bridge', name: '丸木橋', asset: bridgeArt, u: .50, v: .52, width: wide(forest(2.4), bridgeArt), height: forest(2.4), fall: 'back', layer: 6 })
    s.stand('left', { id: 'deer', name: '水を飲む鹿', asset: deerArt, u: .18, v: .78, width: wide(forest(CAST.deer), deerArt), height: forest(CAST.deer), fall: 'back', layer: 7 })
    s.stand('right', { id: 'log', name: '苔むした倒木', asset: logArt, u: .82, v: .88, width: wide(forest(.7), logArt), height: forest(.7), fall: 'back', layer: 8 })
    s.stand('left', { id: 'fern', name: 'シダの下草', asset: fernArt, u: .14, v: .70, width: forest(.9), height: forest(.9), fall: 'back', layer: 8 })

    /**
     * 光の欠片: 川上から川下へ一方向に流れ、住人時間で上下する。
     *
     * 走る範囲は帰属した面 (ここでは左面) の中に収める。収納コンパイラは
     * 開始位置の符号だけで帰属面を決めるので、トラックで背表紙を越えさせると
     * 部品は左面のものなのに右面の上へ出る。めくりの最中はそこに次の見開きが
     * 来ているため、次のページを貫通して着地したように見える。
     * hover() は開始位置しか検査しないので、トラックの端はここで見る。
     */
    const mote = s.hover({
      id: 'mote', name: '光の欠片', asset: moteArt, x: -6.9, y: 1.1, z: 1.1, width: .8, height: .8, billboard: true, layer: 10,
      motion: [{ type: 'bob', amplitude: .16, period: 1.9 }],
    })
    // 左ページローカル座標。見開き上では -6.9 → -0.8 を走る。
    s.track(mote, 'position.x', [[0, -2.9], [6.5, 3.2]], 'linear')
    s.track(mote, 'position.y', [[0, .9], [1.6, 1.5], [3.2, 1.0], [4.8, 1.6], [6.5, 1.1]])
    s.caption('left', { id: 'text', text: 'A shard of light on the water\nwas pointing upstream', u: .5, v: .91, size: .40, color: '#e6eef0' })
    s.sparkle({ id: 'spray', name: '水しぶき', x: -1.4, y: 1.0, z: 1.6, color: '#9fd7e8', size: 1.8 })
    s.camera([
      { time: 0, position: [-1.5, 7.6, 11.2], target: [-1.2, .9, .4], fov: 43 },
      { time: 6.5, position: [1.5, 7.6, 11.2], target: [1.2, .9, .4], fov: 43 },
    ])
    s.environment([
      { time: 0, background: '#233248', 'ambient.intensity': .72 },
      { time: 6.5, background: '#1d2c44', 'ambient.intensity': .66 },
    ])
  }

  // --- 見開き3: 風の丘 -----------------------------------------------------
  {
    const s = work.spread({
      name: '風の丘', hold: 6.5,
      leftPage: ground('page-3-left.svg', '#334a52', '#3d5c62'),
      rightPage: ground('page-3-right.svg', '#334a52', '#3d5c62'),
    })
    s.stand('left', { id: 'far-hill-l', name: '遠い稜線 (左)', asset: hillFar, u: .5, v: .10, width: BACKDROP_WIDTH, height: 1.8, backdrop: true })
    s.stand('right', { id: 'far-hill-r', name: '遠い稜線 (右)', asset: hillFar, u: .5, v: .10, width: BACKDROP_WIDTH, height: 1.8, backdrop: true })
    s.stand('right', { id: 'ridge', name: '丘の稜線', asset: canopyArt, u: 0, width: 9.0, height: 2.2, v: .26, layer: 2 })
    s.stand('left', { id: 'hill-mid', name: '中景の丘 (左)', asset: hillNear, u: .5, v: .56, width: 5.8, height: 1.7, fall: 'back', layer: 3 })
    s.stand('right', { id: 'hill-mid-r', name: '中景の丘 (右)', asset: hillNear, u: .5, v: .60, width: 5.8, height: 1.8, fall: 'back', layer: 3 })
    const mill = s.stand('right', { id: 'windmill', name: '風車の塔', asset: millTowerArt, u: .40, v: .80, width: wide(forest(8.2), millTowerArt), height: forest(8.2), fall: 'back', layer: 6 })
    s.hover({
      id: 'windmill-rotor', name: '風車の羽根', asset: millRotorArt, parent: { type: 'element', elementId: mill },
      x: 0, y: forest(8.2) * .845, z: .02, width: forest(5.4), height: forest(5.4), layer: 7,
      motion: [{ type: 'spin', axis: 'z', speed: .9 }],
    })
    s.stand('left', { id: 'tree', name: '丘の木', asset: treeRoundDark, u: .28, v: .84, width: 2.32, height: 3.19, fall: 'back', layer: 5 })
    s.stand('right', { id: 'deer', name: '丘を見上げる鹿', asset: deerArt, u: .72, v: .82, width: wide(forest(CAST.deer), deerArt), height: forest(CAST.deer), fall: 'back', layer: 7 })
    s.stand('right', { id: 'log', name: '風に晒された倒木', asset: logArt, u: .30, v: .90, width: wide(forest(.7), logArt), height: forest(.7), fall: 'back', layer: 8 })
    s.stand('left', { id: 'rabbit', name: '草むらのウサギ', asset: rabbitArt, u: .16, v: .72, width: wide(forest(.6), rabbitArt), height: forest(.6), fall: 'back', layer: 8 })
    s.stand('left', { id: 'fern', name: 'シダの下草', asset: fernArt, u: .80, v: .70, width: forest(.9), height: forest(.9), fall: 'back', layer: 8 })
    s.stand('right', { id: 'mushroom', name: '光るキノコ', asset: mushroomArt, u: .90, v: .88, width: wide(forest(.6), mushroomArt), height: forest(.6), fall: 'back', layer: 8 })
    s.stand('left', { id: 'fox', name: '子ぎつね', asset: foxArt, u: .84, v: .92, width: wide(forest(CAST.fox), foxArt), height: forest(CAST.fox), fall: 'back', layer: 9 })

    const mote = s.hover({
      id: 'mote', name: '風に運ばれる欠片', asset: moteArt, x: -6.4, y: 2.4, z: 1.0, width: .9, height: .9, billboard: true, layer: 11,
      motion: [{ type: 'bob', amplitude: .22, period: 2.3 }],
    })
    // 左ページローカル座標。見開き上では -6.4 → -0.9 を走る。
    s.track(mote, 'position.x', [[0, -2.4], [6.5, 3.1]], 'linear')
    s.track(mote, 'position.y', [[0, 1.3], [3.2, 2.6], [6.5, 3.4]])
    s.caption('left', { id: 'text', text: 'The wind caught the shard\nand carried it up the hill', u: .5, v: .91, size: .40, color: '#e9f0f2' })
    s.camera([
      { time: 0, position: [0, 6.2, 11.0], target: [0, .9, .8], fov: 45 },
      { time: 6.5, position: [.5, 9.2, 11.4], target: [.2, 1.4, 0], fov: 42 },
    ])
    s.environment([
      { time: 0, background: '#1d2c44', 'ambient.intensity': .66 },
      { time: 6.5, background: '#182541', 'ambient.intensity': .60 },
    ])
  }

  // --- 見開き4: 眠る大樹 ---------------------------------------------------
  {
    const s = work.spread({
      name: '眠る大樹', hold: 7, turn: 1.8,
      leftPage: ground('page-4-left.svg', '#26382f', '#2f4739'),
      rightPage: ground('page-4-right.svg', '#26382f', '#2f4739'),
    })
    s.stand('left', { id: 'far-line-l', name: '奥の木立 (左)', asset: firDark, u: .5, v: .11, width: BACKDROP_WIDTH, height: 2.0, backdrop: true })
    s.stand('right', { id: 'far-line-r', name: '奥の木立 (右)', asset: firDark, u: .5, v: .11, width: BACKDROP_WIDTH, height: 2.0, backdrop: true })
    s.stand('right', { id: 'great-tree', name: '眠る大樹', asset: bigTreeArt, u: 0, width: 8.6, height: 6.8, v: .30, layer: 3 })
    s.stand('left', { id: 'root-l', name: '根もとの倒木 (左)', asset: logArt, u: .40, v: .62, width: wide(forest(.7), logArt), height: forest(.7), fall: 'back', layer: 4 })
    s.stand('right', { id: 'root-r', name: '根もとの倒木 (右)', asset: logArt, u: .40, v: .62, width: wide(forest(.7), logArt), height: forest(.7), fall: 'back', layer: 4 })
    s.stand('left', { id: 'tree-a', name: '脇の木', asset: firMid, u: .80, v: .74, width: 2.18, height: 3.19, fall: 'back', layer: 5 })
    s.stand('right', { id: 'tree-b', name: '脇の木 (右)', asset: treeRoundDark, u: .82, v: .78, width: 2.32, height: 3.19, fall: 'back', layer: 5 })
    s.stand('left', { id: 'owl', name: '大樹のフクロウ', asset: owlArt, u: .16, v: .78, width: wide(forest(.75), owlArt), height: forest(.75), fall: 'back', layer: 7 })
    s.stand('right', { id: 'badger', name: 'ランタンを運ぶアナグマ', asset: badgerArt, u: .18, v: .82, width: wide(forest(CAST.badger), badgerArt), height: forest(CAST.badger), fall: 'back', layer: 7 })
    s.stand('left', { id: 'mushroom', name: '光るキノコ', asset: mushroomArt, u: .84, v: .70, width: wide(forest(.6), mushroomArt), height: forest(.6), fall: 'back', layer: 8 })
    s.stand('right', { id: 'fern', name: 'シダの下草', asset: fernArt, u: .60, v: .90, width: forest(.9), height: forest(.9), fall: 'back', layer: 8 })
    s.stand('left', { id: 'fox', name: '子ぎつね', asset: foxArt, u: .84, v: .92, width: wide(forest(CAST.fox), foxArt), height: forest(CAST.fox), fall: 'back', layer: 9 })
    const light = s.hover({ id: 'lantern', name: '失われた灯り', asset: lanternArt, x: 0, y: 2.4, z: 1.2, width: wide(forest(1.0), lanternArt), height: forest(1.0), billboard: true, layer: 12 })

    // 大樹は紙工作の起立だけで姿を現し、枝の間から灯りが現れる
    s.track(light, 'opacity', [[0, 0], [2.6, 0], [4.2, 1]])
    s.track(light, 'position.y', [[0, 2.0], [7, 2.7]])
    s.caption('left', { id: 'text', text: 'Among the sleeping great tree\nthe lantern lay hidden', u: .5, v: .91, size: .40, color: '#ecf1de' })
    // 明るい紙面の手前に置くと淡い粒が沈むので、暗い樹冠を背にする高さへ上げる
    const halo = s.sparkle({ id: 'halo', name: '灯りの粒', x: 0, y: 3.2, z: .4, color: C.glow, size: .6 })
    s.track(halo, 'effect.size', [[0, .5], [7, 2.6]])
    s.camera([
      { time: 0, position: [0, 8.0, 12.0], target: [0, 1.2, .2], fov: 44 },
      { time: 7, position: [0, 6.6, 11.0], target: [0, 1.9, .2], fov: 42 },
    ])
    s.environment([
      { time: 0, background: '#182541', 'ambient.intensity': .60 },
      { time: 7, background: '#20304e', 'ambient.intensity': .84, 'directional.color': '#ffe0ad' },
    ])
  }

  // --- 見開き5: 森に戻る光 -------------------------------------------------
  {
    const s = work.spread({
      name: '森に戻る光', hold: 7.5, turn: 2.2,
      leftPage: ground('page-5-left.svg', '#2d4438', '#3a5945'),
      rightPage: ground('page-5-right.svg', '#2d4438', '#3a5945'),
    })
    s.stand('left', { id: 'far-line-l', name: '奥の木立 (左)', asset: firDark, u: .5, v: .11, width: BACKDROP_WIDTH, height: 2.1, backdrop: true })
    s.stand('right', { id: 'far-line-r', name: '奥の木立 (右)', asset: firDark, u: .5, v: .11, width: BACKDROP_WIDTH, height: 2.1, backdrop: true })
    s.stand('right', { id: 'canopy', name: '森の樹冠', asset: canopyArt, u: 0, width: 9.4, height: 2.6, v: .24, layer: 2 })

    // 家と花が順番に点灯する
    // 見開き1の木と同じ理由で、樹冠の倒れる帯 (v .24 から高さ 2.6 ぶん = v .65 まで)
    // の外へ出す。家 1 だけ帯の中にいて、開き位相が 0.65 まで遅れていた
    const houses = [
      { page: 'left', u: .30, v: .68, w: forest(5.4), h: forest(5.0) },
      { page: 'left', u: .66, v: .76, w: forest(5.0), h: forest(4.6) },
      { page: 'right', u: .34, v: .66, w: forest(5.8), h: forest(5.4) },
      { page: 'right', u: .72, v: .80, w: forest(5.0), h: forest(4.6) },
    ]
    houses.forEach((house, index) => {
      // 暗い家を紙の下敷きにし、灯った家を同じ位置で重ねて順に浮かび上がらせる
      const dark = s.stand(house.page, {
        id: `house-dark-${index + 1}`, name: `家 ${index + 1}`, asset: cottageDark,
        u: house.u, v: house.v, width: house.w, height: house.h, fall: 'back', layer: 4 + index * 2,
      })
      const lit = s.stand(house.page, {
        id: `house-lit-${index + 1}`, name: `灯った家 ${index + 1}`, asset: cottageLit,
        u: house.u, v: house.v, width: house.w, height: house.h, fall: 'back', layer: 5 + index * 2,
      })
      const litAt = 1.9 + index * .85
      s.track(lit, 'opacity', [[0, 0], [1.1 + index * .85, 0], [litAt, 1]])
      // 灯し終えたら下敷きの暗い家を消す。同じ位置に不透明な板を2枚
      // 残したままページを閉じると、閉じ際に前後が入れ替わってちらつく。
      // 不透明度0の板は alphaTest で描かれず影も落とさないので、
      // めくりに入る時点で灯った家だけが残る (spreadTime は保持秒で
      // 止まるため、この最終値がめくりの間ずっと保たれる)
      s.track(dark, 'opacity', [[0, 1], [litAt, 1], [litAt + .5, 0]])
    })
    const flowers = [
      { page: 'left', u: .16, v: .70, w: forest(.55), h: forest(.6) },
      { page: 'right', u: .52, v: .92, w: forest(.55), h: forest(.6) },
      { page: 'right', u: .88, v: .86, w: forest(.5), h: forest(.55) },
    ]
    flowers.forEach((item, index) => {
      const id = s.stand(item.page, {
        id: `flower-${index + 1}`, name: `咲く花 ${index + 1}`, asset: flowerArt,
        u: item.u, v: item.v, width: item.w, height: item.h, fall: 'back', layer: 14 + index,
      })
      s.track(id, 'opacity', [[0, 0], [3.4 + index * .7, 0], [4.1 + index * .7, 1]])
      s.track(id, 'scale', [[0, .5], [4.1 + index * .7, 1]])
    })
    s.stand('right', { id: 'deer', name: '灯りを見にきた鹿', asset: deerArt, u: .12, v: .88, width: wide(forest(CAST.deer), deerArt), height: forest(CAST.deer), fall: 'back', layer: 17 })
    s.stand('left', { id: 'badger', name: 'ランタンを運ぶアナグマ', asset: badgerArt, u: .10, v: .70, width: wide(forest(CAST.badger), badgerArt), height: forest(CAST.badger), fall: 'back', layer: 17 })
    s.stand('right', { id: 'mushroom', name: '光るキノコ', asset: mushroomArt, u: .90, v: .92, width: wide(forest(.6), mushroomArt), height: forest(.6), fall: 'back', layer: 17 })
    s.stand('left', { id: 'fox', name: '子ぎつね', asset: foxArt, u: .84, v: .70, width: wide(forest(CAST.fox), foxArt), height: forest(CAST.fox), fall: 'back', layer: 18 })

    const light = s.hover({ id: 'lantern', name: '空へ昇る灯り', asset: lanternArt, x: 0, y: 1.6, z: .9, width: wide(forest(1.1), lanternArt), height: forest(1.1), billboard: true, layer: 20 })
    s.track(light, 'position.y', [[0, 1.4], [7.5, 3.4]])
    s.track(light, 'scale', [[0, 1], [7.5, 1.25]])
    // 同上。雪明かりの紙面ではなく樹冠と空を背にする
    const halo = s.sparkle({ id: 'halo', name: '森へ戻る光', x: 0, y: 3.0, z: .3, color: C.glow, size: 1.2 })
    s.track(halo, 'effect.size', [[0, .8], [7.5, 3.4]])
    s.caption('left', { id: 'text', text: 'The lantern rose to the sky\nand the forest was bright again', u: .5, v: .91, size: .38, color: '#f5ecd6' })
    s.camera([
      { time: 0, position: [0, 6.8, 10.6], target: [0, 1.4, .3], fov: 43 },
      { time: 7.5, position: [0, 10.8, 12.6], target: [0, 1.0, 0], fov: 46 },
    ])
    s.environment([
      { time: 0, background: '#20304e', 'ambient.intensity': .84 },
      { time: 7.5, background: '#3c4f6b', 'ambient.intensity': 1.15, 'directional.color': '#ffe7bd', 'directional.intensity': 1.7 },
    ])
  }

  // 音は3作品で共通。BGMは冒頭からループし、ページをめくる音は
  // 各見開きの保持区間の終わり (= 送りの始まり) で鳴る
  work.bgm('bgm.mp3')
  work.pageTurns('page-turn.wav')

  return work
}
