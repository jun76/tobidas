/**
 * 一つの窓、四つの季節 (水彩画風)。
 *
 * 窓枠を背をまたぐ一枚パネルとして全見開きで共有し、その奥の景色を入れ替える。
 * 季節の粒子は前景と遠景で速度を変える。
 *
 * 見開き1〜4は一枚につき一季節で、頭から終わりまで景色も粒子も光も動かさない。
 * 見開きのなかで季節が移ろうと、いま何の季節を見ているのかが読めなくなる。
 * 四季が重なるのは最後の見開きだけで、そこが仕掛けになる。
 */
import { PAGE_ART, PAGE_WIDTH, REAL, artSize, scaleOf, circle, defineWork, ellipse, group, path, poly, rect, svg } from './shared.mjs'

/**
 * 縮尺は二つ立てる。
 *
 *   room  窓枠とカーテンの縮尺。建物の寸法で読む
 *   sill  季節の小物の縮尺。窓辺に並べた見本として一段大きく扱う
 *
 * 部屋の実寸で小物を置くと、どんぐりも貝がらも床の染みにしか見えない。
 * 一段大きくするのは構わないが、小物どうしの比だけは実物のまま保つ。
 * どんぐり (8cm) とマフラー (70cm) が同じ大きさになるのは、一つひとつを
 * 「画面に映える大きさ」で決めているとき。
 */
const room = scaleOf(.7)
const sill = scaleOf(.22)

const C = {
  frame: '#a98058',
  frameDark: '#7f5c3c',
  sill: '#c9a97e',
  spring: '#f2c3d0',
  summer: '#5f9b62',
  autumn: '#d98a45',
  winter: '#cddbe6',
  ink: '#4b4a52',
}

/**
 * 粒子が使ってよい奥行き。窓の外＝景色の板 (z=-2.43) と窓枠のV折り (背で z=-1.41、
 * 翼先で z=-2.21) のあいだ。ここより手前へ出すと室内を横切って見える。
 */
const OUTSIDE_FAR_Z = -2.1
const OUTSIDE_NEAR_Z = -2.1

/**
 * 窓の外の景色。片面ぶんの寸法。
 *
 * 実体のパノラマ (1024x357) を背表紙で二等分し、左右の面へ半分ずつ載せるので、
 * 縦横比は半分ぶん (512:357 ≒ 1.435) に合わせる。ここを守らないと景色だけが
 * 縦に伸びて、窓の外の山が飴のように見える。
 */
const VIEW_WIDTH = 3.73
const VIEW_HEIGHT = 2.6
/** 内側の辺がちょうど背表紙に来る u。左右の半分が背で継がる */
const VIEW_U = VIEW_WIDTH / (2 * PAGE_WIDTH)

/** 見開き1〜4で、窓辺の小物が並び始める時刻 */
const PROP_RISE = .8

/**
 * 変わり目 breaks で区切った、続けざまの落下。
 *
 * 変わり目の前後 ±gap は不透明度0の谷にして、そこで粒子の絵を差し替える。
 * 見えたまま差し替わると弾けて見えるので、谷は差し替え時刻を必ず含める。
 * 落下は等速 (rate) で、区間が長ければ floor で止まる。x は区間ごとに
 * 少しずつ横へ寄りながら dx だけ流れ、ななめに落ちる。
 *
 * 最後の落下は保持の終わりより tail だけ早く畳み切り、そこで visible を
 * false にする。ページを閉じるあいだ支持片は小口の外へ迂回するため、
 * 残しておくと本の外へ部品がはみ出す。不透明度0では消し切れない。
 */
const seasonalFall = (breaks, hold, { top, floor, rate, x0, x1, dx, peak, gap, fade, tail = .5 }) => {
  const done = hold - tail
  const bounds = [0, ...breaks.flatMap((time) => [time - gap, time + gap]), done]
  const y = []
  const x = []
  const opacity = []
  for (let index = 0; index <= breaks.length; index++) {
    const from = bounds[index * 2]
    const to = bounds[index * 2 + 1]
    const base = x0 + (x1 - x0) * (index / Math.max(1, breaks.length))
    y.push([from, top], [to, Math.max(floor, top - rate * (to - from))])
    x.push([from, base], [to, base + dx])
    opacity.push([from, 0], [from + fade, peak], [to - fade, peak], [to, 0])
  }
  return { y, x, opacity, visible: [[0, true], [done, false]] }
}

/** 季節の変わり目で絵を差し替える。時刻は seasonalFall の谷の中央と一致する */
const seasonalAssets = (swaps, assets) =>
  [[0, assets[0]], ...swaps.map((time, index) => [time, assets[index + 1]])]

/** 落下の4トラックをまとめて張る */
const trackFall = (s, id, fall) => {
  s.track(id, 'position.y', fall.y, 'linear')
  s.track(id, 'position.x', fall.x, 'linear')
  s.track(id, 'opacity', fall.opacity)
  s.track(id, 'visible', fall.visible)
}

export function build(updatedAt) {
  const work = defineWork({
    id: 'four_seasons',
    title: 'One Window, Four Seasons',
    description: 'A watercolour piece: one windowsill, a whole year passing.',
    theme: 'watercolor-seasons',
    updatedAt,
    appearance: {
      paperColor: '#fbf6ec', edgeColor: '#ddd0bb', roughness: .9,
      background: '#e8dfe6', shadowOpacity: .24,
    },
    camera: { position: [0, 8.4, 12.0], target: [0, 1.2, .2], fov: 44 },
    lights: {
      ambient: { color: '#ffffff', intensity: 1.25 },
      directional: { color: '#fff3e2', intensity: 1.4, position: [-4, 10, 6] },
    },
    cover: { front: 'cover-front.svg', inside: 'cover-inside.svg', back: 'cover-back.svg' },
  })
  const { art } = work

  /**
   * scripts/adopt-alt-asset.mjs で取り込んだ季節の小物。
   * 下書きは占める寸法の宣言だけを担い、絵は同名の生成済みWebPが持つ。
   */
  const adopted = (id, width, height) => art(id, svg(width, height,
    rect(0, 0, width, height, C.sill, ' opacity=".2"')))

  /** 水彩のにじみ: 半透明の色面を少しずらして重ねる */
  const wash = (x, y, rx, ry, color, alpha = .5) =>
    group(ellipse(x, y, rx, ry, color, ` opacity="${alpha}"`), ellipse(x + rx * .12, y - ry * .1, rx * .82, ry * .78, color, ` opacity="${alpha * .7}"`))

  const floor = (id, tint, accent) => art(id, svg(PAGE_ART.width, PAGE_ART.height, group(
    rect(0, 0, 1250, 1000, '#f6efe2'),
    rect(0, 620, 1250, 380, tint),
    ...[[200, 760], [640, 700], [980, 820]].map(([x, y]) => wash(x, y, 150, 34, accent, .13)),
    ...Array.from({ length: 6 }, (_, i) => rect(0, 640 + i * 60, 1250, 3, '#e2d6c2')),
  )), { opaque: true })

  /** 窓枠。ガラス面は抜いておき、奥の景色が透けて見えるようにする */
  const frameArt = (id) => {
    const s = artSize(9.2, 3.2)
    const bar = s.height * .055
    return art(id, svg(s.width, s.height, group(
      rect(0, 0, s.width, bar * 1.4, C.frame),
      rect(0, s.height - bar * 2.4, s.width, bar * 1.4, C.frame),
      rect(0, 0, bar * 1.2, s.height, C.frame),
      rect(s.width - bar * 1.2, 0, bar * 1.2, s.height, C.frame),
      rect(s.width * .5 - bar * .7, 0, bar * 1.4, s.height - bar, C.frame),
      rect(0, s.height * .46, s.width, bar, C.frameDark),
      ...[.25, .75].map((u) => rect(s.width * u - bar * .3, 0, bar * .6, s.height - bar, C.frame, ' opacity=".85"')),
      rect(-s.width * .01, s.height - bar * 1.1, s.width * 1.02, bar * 1.1, C.sill),
    )), { alphaBounds: { x: 0, y: 0, width: 1, height: 1 } })
  }

  /**
   * 窓の外の景色。四季ぶんを同じ画角で作り、差し替えだけで切り替わる。
   *
   * 一枚のパノラマを左右の面へ半分ずつ割り当てて、背表紙で継ぐ。
   * 同じ絵を両面へ置くと、一つの窓の中に同じ景色が二つ並んで見える。
   *
   * 半分の実体は、取り込んだパノラマ view-<季節>.webp (1024x357) から作る。
   * パノラマ自体は参照されないが、割り直せるように素材置き場へ残してある:
   *
   *   magick view-<季節>.webp -crop 50%x100%+0+0   +repage -resize 709x494! \
   *     -quality 88 -define webp:method=6 view-<季節>-l.webp
   *   magick view-<季節>.webp -crop 50%x100%+512+0 +repage -resize 709x494! \
   *     -quality 88 -define webp:method=6 view-<季節>-r.webp
   *
   * 割ったあとは scripts/trim-assets.mjs が透明の縁を落とす。左右の半分と
   * 四季ぶんは同じ枠を共有させてあるので、綴じ目でも季節の変わり目でも
   * 地平線が段違いにならない。部品の縦横比は実体のWebPから引くので、
   * 下書きの宣言寸法と実体が一致している必要はない。
   */
  const view = (id, sky, land, canopy, extras) => {
    const half = (suffix) => drawView(id.replace('.svg', `-${suffix}.svg`), sky, land, canopy, extras)
    return { left: half('l'), right: half('r') }
  }

  const drawView = (id, sky, land, canopy, extras) => {
    const s = artSize(VIEW_WIDTH, VIEW_HEIGHT)
    return art(id, svg(s.width, s.height, group(
      rect(0, 0, s.width, s.height, sky),
      wash(s.width * .24, s.height * .26, s.width * .16, s.height * .16, '#ffffff', .5),
      wash(s.width * .72, s.height * .2, s.width * .13, s.height * .13, '#ffffff', .42),
      path(`M0 ${s.height * .74} Q${s.width * .2} ${s.height * .56} ${s.width * .44} ${s.height * .7} Q${s.width * .72} ${s.height * .84} ${s.width} ${s.height * .64} V${s.height} H0Z`, land),
      ...[.16, .38, .62, .84].map((u, i) => group(
        rect(s.width * (u - .012), s.height * (.66 + i % 2 * .04), s.width * .024, s.height * .3, '#8a6a4a'),
        ellipse(s.width * u, s.height * (.58 + i % 2 * .04), s.width * .07, s.height * .14, canopy, ' opacity=".92"'),
      )),
      extras(s),
    )))
  }

  const petalArt = (id, color, count) => {
    const s = artSize(2.4, 1.2)
    return art(id, svg(s.width, s.height, group(
      ...Array.from({ length: count }, (_, i) => ellipse(
        s.width * (.06 + (i * .137) % .92), s.height * (.2 + ((i * 37) % 60) / 100), s.width * .028, s.height * .05, color,
        ` opacity="${.55 + (i % 3) * .15}" transform="rotate(${(i * 47) % 90 - 45} ${s.width * (.06 + (i * .137) % .92)} ${s.height * (.2 + ((i * 37) % 60) / 100)})"`)),
    )))
  }

  const curtain = (id, color) => {
    const s = artSize(1.6, 2.6)
    return art(id, svg(s.width, s.height, group(
      path(`M0 0 H${s.width} V${s.height * .9} Q${s.width * .5} ${s.height} 0 ${s.height * .88}Z`, color, ' opacity=".85"'),
      ...[.2, .42, .64, .86].map((u) => path(`M${s.width * u} 0 V${s.height * .9}`, 'none', ` stroke="#ffffff" stroke-opacity=".35" stroke-width="${s.width * .05}"`)),
    )))
  }


  const potPlant = (id, leaf) => {
    const s = artSize(1.1, 1.3)
    return art(id, svg(s.width, s.height, group(
      ...[[.3, -.16], [.5, 0], [.7, .16]].map(([u, tilt]) => path(
        `M${s.width * u} ${s.height * .68} Q${s.width * (u + tilt)} ${s.height * .3} ${s.width * (u + tilt * 1.7)} ${s.height * .08}`,
        'none', ` stroke="${leaf}" stroke-width="${s.width * .1}" stroke-linecap="round"`)),
      poly([[s.width * .24, s.height * .66], [s.width * .76, s.height * .66], [s.width * .66, s.height], [s.width * .34, s.height]], '#c08a63'),
    )))
  }


  art('cover-front.svg', svg(PAGE_ART.width, PAGE_ART.height, group(
    rect(0, 0, 1250, 1000, '#f4eee2'),
    ...[[C.spring, 0], [C.summer, 1], [C.autumn, 2], [C.winter, 3]].map(([color, i]) =>
      wash(240 + i * 260, 420 + (i % 2) * 130, 210, 210, color, .5)),
    rect(300, 240, 650, 520, 'none', ` stroke="${C.frame}" stroke-width="26"`),
    rect(300, 490, 650, 20, C.frame),
    rect(615, 240, 20, 520, C.frame),
  )), { opaque: true })
  art('cover-inside.svg', svg(PAGE_ART.width, PAGE_ART.height, group(
    rect(0, 0, 1250, 1000, '#f2ece0'),
    ...Array.from({ length: 24 }, (_, i) => wash(120 + (i % 6) * 210, 150 + Math.floor(i / 6) * 240, 84, 84,
      [C.spring, C.summer, C.autumn, C.winter][i % 4], .3)),
  )), { opaque: true })
  art('cover-back.svg', svg(PAGE_ART.width, PAGE_ART.height,
    rect(0, 0, 1250, 1000, '#f2ece0')), { opaque: true })

  const window = frameArt('window-frame.svg')
  const viewSpring = view('view-spring.svg', '#dff0f6', '#c6dfa8', C.spring, (s) => group(
    ...[[.3, .3], [.55, .22], [.78, .34]].map(([u, v]) => circle(s.width * u, s.height * v, s.width * .012, '#ffffff'))))
  const viewSummer = view('view-summer.svg', '#bfe2f4', '#7fae63', '#2f6f42', (s) =>
    group(wash(s.width * .5, s.height * .2, s.width * .2, s.height * .17, '#ffffff', .85)))
  const viewAutumn = view('view-autumn.svg', '#f6d9b6', '#c99a5c', C.autumn, (s) =>
    group(circle(s.width * .78, s.height * .24, s.width * .045, '#e8894a')))
  const viewWinter = view('view-winter.svg', '#dfe8ef', '#eef3f7', '#b9c9d6', (s) =>
    group(...Array.from({ length: 18 }, (_, i) => circle(s.width * ((i * .0721) % .96), s.height * ((i * .131) % .6), s.width * .006, '#ffffff'))))
  const petalSpring = petalArt('particle-petal.svg', '#f4b8cb', 22)
  const petalSummer = petalArt('particle-leaf.svg', '#7fbb7c', 18)
  const petalAutumn = petalArt('particle-maple.svg', '#d4703a', 20)
  const petalWinter = petalArt('particle-snow.svg', '#ffffff', 26)
  const curtainWarm = curtain('curtain-light.svg', '#f7e4ea')
  const curtainCool = curtain('curtain-cool.svg', '#dcefef')
  const plantArt = potPlant('pot-plant.svg', C.summer)

  /**
   * 季節を運ばない部屋の道具。5つの見開きすべてで同じ場所に置く。
   *
   * カーテンと鉢を見開きごとに面や位置で入れ替えると、部屋そのものが毎回
   * 組み替わって見え、移ろったのが季節なのか部屋なのかが読めなくなる。
   * 窓の外だけが移ろう本なので、部屋の側は一年を通して動かさない。
   *
   * カーテンは窓の見かけの幅 (片翼 6.0 = u .75) のすぐ外側へ左右一対で吊る。
   * 鉢は窓辺の奥列 (v=.40) の背側。ここを先に押さえ、残りへ季節の小物を配る。
   */
  const ROOM = {
    curtain: { u: .80, v: .50, width: room(1.35), height: room(1.9) },
    plant: { u: .18, v: .40, width: sill(.38), height: sill(.45) },
  }

  /**
   * 部屋の道具を一式立てる。左右のカーテンは周期をずらし、同じ拍で
   * 揺れないようにする (対になった二枚が一枚の板に見えるのを避ける)。
   */
  const placeRoom = (s) => {
    for (const [page, asset, period, phase] of [['left', curtainWarm, 5.2, 0], ['right', curtainCool, 4.6, 1.4]]) {
      s.stand(page, {
        id: `curtain-${page}`, name: `カーテン (${page === 'left' ? '左' : '右'})`, asset,
        ...ROOM.curtain, fall: 'back', layer: 6,
        motion: [{ type: 'sway', amplitude: 2.6, period, phase }],
      })
    }
    s.stand('left', { id: 'plant', name: '窓辺の鉢', asset: plantArt, ...ROOM.plant, fall: 'back', layer: 8 })
  }

  /**
   * 季節の小物を置く5か所。部屋の道具の足跡を避けた残りの余白がこれ。
   *
   * 面ごとに「中列 (v≈.65)」と「前列 (v≈.85)」の二列を作り、同じ列の中では
   * u が重ならないようにする。列が違えば手前の小物が奥のものを部分的に隠すが、
   * それは奥行きとして正しい。潰してはいけないのは同じ列どうしの重なりのほう。
   *
   * season.props は大きい順なので、中列の2つが大きいほうの2点を受ける。
   * 前列の小口寄りは左右とも3番目を採り、対として片方だけ少し小さくする。
   * ここへ4番目 (どんぐり 3cm、雪の飾り) を置くと、小さすぎて片面が空いて
   * 見える。季節の素材は各4点しかないので、余白は点数ではなく配りかたで埋める。
   * 4番目はいちばん camera に近い前列の背側へ回し、小さいまま近くで見せる。
   */
  const PROP_SLOTS = [
    { page: 'right', u: .30, v: .66, layer: 20 },
    { page: 'left', u: .44, v: .62, layer: 21 },
    { page: 'right', u: .84, v: .84, layer: 22 },
    { page: 'left', u: .86, v: .86, layer: 23, of: 2, scale: .85 },
    { page: 'right', u: .20, v: .86, layer: 24, of: 3 },
  ]

  const artPx = (width, height) => {
    const s = artSize(width, height)
    return [s.width, s.height]
  }
  const prop = (id, width, height, name) => ({ asset: adopted(id, ...artPx(width, height)), width, height, name })

  const seasons = [
    {
      name: '春', view: viewSpring, petal: petalSpring, tint: C.spring, sky: '#e6dfe9', light: '#ffe9ef',
      props: [
        prop('cherry-blossom-branch.svg', 2.16, 2.73, '桜の小枝'),
        prop('spring-watering-can.svg', 2.14, 1.36, 'じょうろ'),
        prop('spring-rain-boot.svg', .98, 1.45, '長ぐつ'),
        prop('spring-bird.svg', .66, .68, '窓辺の小鳥'),
      ],
    },
    {
      name: '夏', view: viewSummer, petal: petalSummer, tint: C.summer, sky: '#cfe6f2', light: '#ffffff',
      props: [
        prop('summer-parasol.svg', 3.76, 3.64, '日傘'),
        prop('summer-sun-hat.svg', 2.72, 1.59, '麦わら帽子'),
        prop('summer-butterfly.svg', .49, .36, '蝶'),
        prop('summer-seashell.svg', .37, .36, '貝がら'),
      ],
    },
    {
      name: '秋', view: viewAutumn, petal: petalAutumn, tint: C.autumn, sky: '#efd9bd', light: '#ffdfae',
      props: [
        prop('autumn-scarf.svg', 2.63, 3.18, '秋のスカーフ'),
        prop('autumn-pumpkins.svg', 1.52, 1.36, 'かぼちゃ'),
        prop('autumn-leaves.svg', 1.39, 1.36, '紅葉の束'),
        prop('autumn-acorns.svg', .41, .36, 'どんぐり'),
      ],
    },
    {
      name: '冬', view: viewWinter, petal: petalWinter, tint: C.winter, sky: '#dde5ec', light: '#e8f1f8',
      props: [
        prop('winter-scarf.svg', 2.54, 3.18, '冬のマフラー'),
        prop('winter-mitten.svg', .76, 1.14, '手ぶくろ'),
        prop('winter-snow-rabbit.svg', .73, 1.14, '雪うさぎ'),
        prop('winter-snowflake.svg', .31, .45, '雪の飾り'),
      ],
    },
  ]

  const lines = [
    'Beyond the window\npetals are falling',
    'Deep green and towering clouds\nthe longest day of the year',
    'Red leaves drift sideways\nand evening comes early',
    'Grains of snow\nsome large and some small',
    'Through the same window\na year of light goes by',
  ]

  // --- 見開き1〜4: 四季 -----------------------------------------------------
  seasons.forEach((season, index) => {
    const s = work.spread({
      name: season.name, hold: 6.5,
      leftPage: floor(`page-${index + 1}-left.svg`, '#e9dcc6', season.tint),
      rightPage: floor(`page-${index + 1}-right.svg`, '#e9dcc6', season.tint),
    })
    // 窓の外の景色は片面ごとの立ち板。見開き1〜4は頭から終わりまでこの季節だけ
    for (const [side, id] of [['left', 'view-l'], ['right', 'view-r']]) {
      s.stand(side, {
        id, name: `背景の窓外 (${side === 'left' ? '左' : '右'})`, asset: season.view[side],
        u: VIEW_U, v: .12, width: VIEW_WIDTH, height: VIEW_HEIGHT, backdrop: true,
      })
    }
    s.stand('right', { id: 'window', name: '窓枠', asset: window, u: 0, width: 7.03, height: 3.61, v: .28, layer: 4 })
    // 部屋の道具は季節によらず同じ場所。カーテンは窓枠のすぐ外へ、壁ぎわに
    // 束ねた一枚として立てる。窓のV折りの真下は蓋になっていて背の高い立ち板を
    // 畳めないので、窓の見かけの幅の外側で、かつ紙面の内側に収まる u を使う。
    // 空中へ置ける部品は見開きあたり4個までで、そこは落ちる粒子の二層が使う
    placeRoom(s)

    // 窓辺の小物。その季節のものが、頭から少し遅れて一つずつ並ぶ
    PROP_SLOTS.forEach((slot, order) => {
      const item = season.props[slot.of ?? order]
      const shrink = slot.scale ?? 1
      const size = (value) => Math.round(value * shrink * 1000) / 1000
      const id = s.stand(slot.page, {
        id: `prop-${order + 1}`, name: item.name, asset: item.asset,
        u: slot.u, v: slot.v, width: size(item.width), height: size(item.height), fall: 'back', layer: slot.layer,
      })
      s.track(id, 'opacity', [[0, 0], [PROP_RISE + order * .35, 0], [PROP_RISE + .9 + order * .35, 1]])
      s.track(id, 'scale', [[0, .6], [PROP_RISE + order * .35, .6], [PROP_RISE + .9 + order * .35, 1]])
    })

    // 落ちた粒は床にも溜まる。空を落ちるのと同じ絵を紙へ寝かせ、
    // 前列の余白をその季節の色で埋める。立ち板ではないので視界を塞がない
    s.flat('left', {
      id: 'fallen-left', name: `${season.name}の名残 (左)`, asset: season.petal,
      u: .20, v: .78, width: 2.2, depth: 1.1, layer: 2,
    })
    s.flat('right', {
      id: 'fallen-right', name: `${season.name}の名残 (右)`, asset: season.petal,
      u: .46, v: .83, width: 3.0, depth: 1.5, layer: 2,
    })

    // 粒子は窓の外を落ちる。ガラス面の奥 (景色の板と窓枠のあいだ) だけを使い、
    // 室内側へは出さない。落ちるのはこの季節のものだけで、途中で入れ替わらない。
    // 奥はゆっくり一度、窓ぎわは速く二度ななめに落ちる。
    // 流れる向きは見開きごとに入れ替える
    const side = index % 2 ? -1 : 1
    const far = s.hover({
      id: 'particle-far', name: '奥を落ちる粒子', asset: season.petal, x: -1.4 * side, y: 2.5, z: OUTSIDE_FAR_Z, width: 2.0, height: 1.0, fall: 'front', layer: 10,
      motion: [{ type: 'bob', amplitude: .1, period: 3.4 }],
    })
    trackFall(s, far, seasonalFall([], 6.5,
      { top: 2.5, floor: .75, rate: .6, x0: -1.4 * side, x1: .6 * side, dx: .45 * side, peak: .7, gap: .22, fade: .32 }))
    const near = s.hover({
      id: 'particle-near', name: '窓ぎわを落ちる粒子', asset: season.petal, x: 1.3 * side, y: 2.4, z: OUTSIDE_NEAR_Z, width: 2.4, height: 1.2, fall: 'front', layer: 14,
      motion: [{ type: 'bob', amplitude: .18, period: 2.1 }],
    })
    trackFall(s, near, seasonalFall([3.1], 6.5,
      { top: 2.4, floor: .9, rate: 1.0, x0: 1.3 * side, x1: -.9 * side, dx: -.45 * side, peak: .95, gap: .15, fade: .3 }))

    s.caption('left', { id: 'text', text: lines[index], u: .5, v: .90, size: .36, color: C.ink })
    s.camera([
      { time: 0, position: [index % 2 ? 1.4 : -1.4, 8.0, 12.2], target: [0, 1.2, .2], fov: 44 },
      { time: 6.5, position: [index % 2 ? -1.0 : 1.0, 8.8, 11.6], target: [0, 1.3, .2], fov: 43 },
    ])
    // 光もこの季節のまま。色を動かすと季節が移ろって見えるので、
    // 動かすのは明るさだけにして、日が高くなるぶんだけ持ち上げる
    s.environment([
      { time: 0, background: season.sky, 'ambient.intensity': 1.2, 'directional.color': season.light },
      { time: 6.5, background: season.sky, 'ambient.intensity': index === 3 ? 1.35 : 1.25, 'directional.color': season.light },
    ])
  })

  // --- 見開き5: 一年の重なり -----------------------------------------------
  {
    const s = work.spread({
      name: '一年の重なり', hold: 8, turn: 2.2,
      leftPage: floor('page-5-left.svg', '#ece2d2', '#d8c8dd'),
      rightPage: floor('page-5-right.svg', '#ece2d2', '#d8c8dd'),
    })
    // 層 index が現れ始める / 現れ切る時刻。粒子の季節もここから導く
    const layerRise = (index) => 1.1 + index * 1.3
    const layerFull = (index) => 2.2 + index * 1.3
    /** 景色が半分入れ替わった瞬間。ここが季節の変わり目 */
    const seasonSwap = [1, 2, 3].map((index) => (layerRise(index) + layerFull(index)) / 2)

    /**
     * 四季の景色を同じ位置へ重ね、順に入れ替える。
     *
     * 古い季節は、次の季節が立ち上がるのと同じ区間で0まで落とす。薄いまま
     * 残すと窓の外が4枚の多重露光になり、どの季節も読めない濁りになる。
     * 見えているのは常に1枚か、入れ替わり中の2枚の溶暗だけ。
     */
    seasons.forEach((season, index) => {
      const fadeIn = index === 0
        ? [[0, 1]]
        : [[0, 0], [layerRise(index), 0], [layerFull(index), 1]]
      // 最後の季節だけは落とさずに残す
      const fadeOut = index === 3
        ? []
        : [[layerRise(index + 1), 1], [layerFull(index + 1), 0]]
      for (const page of ['left', 'right']) {
        const id = s.stand(page, {
          id: `layer-${page}-${index + 1}`, name: `背景の${season.name}の層 (${page === 'left' ? '左' : '右'})`, asset: season.view[page],
          u: VIEW_U, v: .12 + index * .006, width: VIEW_WIDTH, height: VIEW_HEIGHT, backdrop: true, fall: 'front', layer: index,
        })
        s.track(id, 'opacity', [...fadeIn, ...fadeOut])
      }
    })
    const frameId = s.stand('right', { id: 'window', name: '窓枠', asset: window, u: 0, width: 7.03, height: 3.61, v: .28, layer: 4 })
    s.track(frameId, 'scale', [[0, 1], [8, 1.02]])
    // 部屋の道具は見開き1〜4と同じ場所。四季が重なるこの見開きでも、
    // 動かないものが動かないままだから、移ろったのが窓の外だと分かる
    placeRoom(s)

    /**
     * 四季の小物をひとつずつ、部屋の道具を避けた四隅へ残す。
     *
     * どんぐり (3cm) や貝がら (8cm) のような小さい実物を選ぶと、桜の小枝と
     * 釣り合わずにその面だけ寂しくなる。小物どうしの比は実物のままにして
     * おきたいので、大きさは倍率ではなく「何を残すか」で決める。
     * 春は桜、夏は麦わら帽子、秋はかぼちゃ、冬はマフラーと、背丈のあるものを採る。
     *
     * 置き場は見開き1〜4と同じ二列。背の高い2つを中列へ、低い2つを前列へ。
     */
    ;[
      { item: seasons[3].props[0], page: 'right', u: .24, v: .66 },
      { item: seasons[0].props[0], page: 'left', u: .44, v: .62 },
      { item: seasons[1].props[1], page: 'right', u: .68, v: .86 },
      { item: seasons[2].props[1], page: 'left', u: .84, v: .84 },
    ].forEach(({ item, page, u, v }, order) => {
      s.stand(page, {
        id: `keepsake-${order + 1}`, name: item.name, asset: item.asset,
        u, v, width: item.width, height: item.height, fall: 'back', layer: 24 + order,
      })
    })

    // 粒子も景色と同じ順に四季を巡る。花びら→若葉→紅葉→雪
    const petals = [petalSpring, petalSummer, petalAutumn, petalWinter]
    const far = s.hover({
      id: 'particle-far', name: '奥を落ちる粒子', asset: petals[0], x: -1.4, y: 2.5, z: OUTSIDE_FAR_Z, width: 2.0, height: 1.0, fall: 'front', layer: 16,
      motion: [{ type: 'bob', amplitude: .12, period: 3.6 }],
    })
    trackFall(s, far, seasonalFall(seasonSwap, 8,
      { top: 2.5, floor: .75, rate: .6, x0: -1.4, x1: .6, dx: .45, peak: .75, gap: .22, fade: .32 }))
    s.track(far, 'asset', seasonalAssets(seasonSwap, petals))
    const near = s.hover({
      id: 'particle-near', name: '窓ぎわを落ちる粒子', asset: petals[0], x: 1.3, y: 2.4, z: OUTSIDE_NEAR_Z, width: 2.4, height: 1.2, fall: 'front', layer: 18,
      motion: [{ type: 'bob', amplitude: .2, period: 2.2 }],
    })
    trackFall(s, near, seasonalFall(seasonSwap, 8,
      { top: 2.4, floor: .9, rate: 1.0, x0: 1.3, x1: -.9, dx: -.45, peak: .95, gap: .15, fade: .3 }))
    s.track(near, 'asset', seasonalAssets(seasonSwap, petals))
    s.caption('left', { id: 'text', text: lines[4], u: .5, v: .93, size: .34, color: C.ink })
    s.camera([
      { time: 0, position: [0, 8.2, 11.6], target: [0, 1.3, .2], fov: 43 },
      { time: 8, position: [0, 12.6, 14.6], target: [0, .9, 0], fov: 46 },
    ])
    s.environment([
      { time: 0, background: seasons[3].sky, 'ambient.intensity': 1.35 },
      { time: 8, background: '#efe6ee', 'ambient.intensity': 1.45, 'directional.color': '#fff6ea' },
    ])
  }

  // 音は3作品で共通。BGMは冒頭からループし、ページをめくる音は
  // 各見開きの保持区間の終わり (= 送りの始まり) で鳴る
  work.bgm('bgm.mp3')
  work.pageTurns('page-turn.wav')

  return work
}
