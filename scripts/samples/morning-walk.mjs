/**
 * 朝の通学路 (段ボール・ペーパークラフト風)。
 *
 * すべての部品を素材の板から切り出したものとして扱う。
 * 遮断機の腕や電車のような動く部品も、必ずどちらかの紙面へ帰属させる。
 */
import { PAGE_ART, REAL, artSize, circle, defineWork, group, path, poly, rect, scaleOf, svg } from './shared.mjs'

/**
 * 縮尺。屋外の見開きと教室の見開きで別の縮尺を使う。
 * 片面 8 単位が、街では約 17.6m、教室では約 9.2m にあたる。
 *
 * 屋外は 2.2m/単位。紙面の敷石が 0.4 単位 ≒ 0.9m で読めるところが上限で、
 * これより粗い縮尺にすると建物がミニチュアに見える。
 */
const street = scaleOf(2.2)

/** 中央線をまたぐ遠景板の寸法。奥行きは手前の二翼板より奥、翼が紙面の奥を越えない範囲 */
/**
 * 遠景板の寸法。幅と高さは奥行き v から二つの不等式で挟まれる:
 *   翼が紙面の奥を越えない   z - 0.089×width  >= -PAGE_DEPTH/2 + EDGE_MARGIN
 *   閉じたとき手前へ出ない   z + 0.985×height <=  PAGE_DEPTH/2
 * 縦横比を固定すると幅の上限は v=.20 前後で頭打ちになり、約11が限界。
 * 見開き幅16を埋め切ることはできないので、左右の余白は設計上の帰結。
 */
const BACKDROP_SPAN = { width: 11.0, height: 5.0, v: .19 }
/**
 * 手前の小物と人の縮尺。街の実寸 (street) のまま置くと、自転車もポストも
 * 子どもも敷石の染みにしか見えない。手前に立てるものだけ一段大きく扱う。
 * 大きくするのは構わないが、小物どうしの比は実物のまま保つ
 * (犬 0.55m とポスト 1.35m が同じ大きさになるのは、一つひとつを
 * 「画面に映える大きさ」で決めているとき)。建物と樹木は street のまま。
 */
const near = scaleOf(1.25)
/**
 * 踏切の見開きだけは道幅ぶんの舞台でよいので締める。片面 8 単位 ≒ 12.8m。
 * ただし人と乗り物はここでも near を使う。同じ子どもが見開きごとに
 * 大きさを変えては困るし、手前へ置いたものが奥のものより小さく見えると
 * 遠近が逆さまに読める (信号や電柱は実寸のままでよい)。
 */
const crossing = scaleOf(1.6)
const room = scaleOf(.8)

const C = {
  kraft: '#c39a6b',
  kraftDark: '#9c7548',
  kraftDeep: '#7a5834',
  ink: '#4a3a26',
  edge: '#fdf6e6',
  dawn: '#5d5470',
  slate: '#6d7f8c',
  signal: '#c8503c',
  leaf: '#7f9a5c',
  school: '#f4efe2',
  schoolTrim: '#d8d0bd',
  wood: '#d8b483',
}

/** 塗り分けた色紙。段ボールの下地へ貼った色画用紙として扱う */
const WALL = ['#f0dfc0', '#bfd8c8', '#c2d6e6', '#f2cdb0', '#dccbe4', '#f0e2a8']
const ROOF = ['#c85b46', '#46789c', '#5f8f5c', '#dd8b46', '#8a5a7a', '#3f8f8a']

export function build(updatedAt) {
  const work = defineWork({
    id: 'morning_walk',
    title: 'The Walk to School',
    description: 'A cardboard miniature of one morning, from the houses to the classroom.',
    theme: 'cardboard-miniature',
    updatedAt,
    appearance: {
      paperColor: '#e6cfa8', edgeColor: '#b18c5c', roughness: .95,
      background: C.dawn, shadowOpacity: .3,
    },
    camera: { position: [0, 8.8, 12.4], target: [0, 1.0, .2], fov: 44 },
    lights: {
      ambient: { color: '#dcd4e6', intensity: 1.0 },
      directional: { color: '#ffd7b0', intensity: 1.4, position: [-6, 9, 5] },
    },
    cover: { front: 'cover-front.svg', inside: 'cover-inside.svg', back: 'cover-back.svg' },
  })
  // wide(高さ, 素材) は縦横比を実WebPから引く。余白を切っても定義は追従する
  const { art, aspect, wide } = work

  /** 段ボールらしさは断面の筋で出す。板の下端に波線を一本入れる */
  const corrugation = (w, h) => `<g opacity=".35">${Array.from({ length: Math.round(w / 14) }, (_, i) =>
    rect(i * 14, h - h * .06, 7, h * .06, C.kraftDeep)).join('')}</g>`

  /**
   * 紙面の地面。舗装や床といった「面」だけを持たせ、建物も山も描かない。
   * 立体で見せるものを紙にも描くと、立ち上がった部品と二重になって濁る。
   */
  const ground = (id, base, patch) => art(id, svg(PAGE_ART.width, PAGE_ART.height, group(
    rect(0, 0, 1250, 1000, base),
    ...[[100, 240], [600, 160], [1000, 330], [380, 700], [940, 780]].map(([x, y]) =>
      rect(x, y, 220, 130, patch, ' opacity=".26"')),
  )), { opaque: true })

  /**
   * scripts/adopt-alt-asset.mjs で取り込んだ部品。
   * 下書きは占める寸法の宣言だけを担い、絵は同名の生成済みWebPが持つ。
   */
  const adopted = (id, width, height) => art(id, svg(width, height,
    rect(0, 0, width, height, C.kraftDark, ' opacity=".18"')))

  const house = (id, wall, roof) => {
    const s = artSize(2.0, 2.0)
    return art(id, svg(s.width, s.height, group(
      rect(s.width * .12, s.height * .38, s.width * .76, s.height * .62, wall),
      poly([[s.width * .04, s.height * .4], [s.width * .5, s.height * .06], [s.width * .96, s.height * .4]], roof),
      rect(s.width * .22, s.height * .5, s.width * .2, s.height * .18, C.edge),
      rect(s.width * .58, s.height * .5, s.width * .2, s.height * .18, C.edge),
      rect(s.width * .42, s.height * .74, s.width * .18, s.height * .26, C.kraftDeep),
      rect(s.width * .12, s.height * .38, s.width * .76, s.height * .04, '#ffffff', ' opacity=".45"'),
      corrugation(s.width, s.height),
    )))
  }

  const apartment = (id, wall = '#c2d6e6', band = '#46789c') => {
    const s = artSize(2.4, 2.8)
    return art(id, svg(s.width, s.height, group(
      rect(s.width * .1, s.height * .12, s.width * .8, s.height * .88, wall),
      rect(s.width * .06, s.height * .06, s.width * .88, s.height * .08, band),
      ...[0, 1, 2, 3].flatMap((row) => [0, 1, 2].map((col) =>
        rect(s.width * (.2 + col * .22), s.height * (.22 + row * .18), s.width * .14, s.height * .11, C.edge))),
      corrugation(s.width, s.height),
    )))
  }

  const mountain = (id, color) => {
    const s = artSize(6.6, 1.6)
    return art(id, svg(s.width, s.height, group(
      poly([[0, s.height], [s.width * .22, s.height * .18], [s.width * .38, s.height * .62], [s.width * .56, s.height * .06],
        [s.width * .74, s.height * .5], [s.width * .9, s.height * .24], [s.width, s.height]], color),
    )))
  }

  const pole = (id) => {
    const s = artSize(.34, 2.6)
    return art(id, svg(s.width, s.height, group(
      rect(s.width * .34, 0, s.width * .32, s.height, C.kraftDeep),
      rect(0, s.height * .1, s.width, s.height * .04, C.kraftDeep),
      rect(s.width * .1, s.height * .22, s.width * .8, s.height * .035, C.kraftDeep),
    )))
  }

  const shopFront = (id, awning, wall = '#f0dfc0') => {
    const s = artSize(2.6, 2.2)
    return art(id, svg(s.width, s.height, group(
      rect(s.width * .06, s.height * .2, s.width * .88, s.height * .8, wall),
      rect(s.width * .06, s.height * .1, s.width * .88, s.height * .12, awning),
      ...[0, 1, 2, 3, 4].map((i) => poly([
        [s.width * (.08 + i * .17), s.height * .24], [s.width * (.165 + i * .17), s.height * .42],
        [s.width * (.25 + i * .17), s.height * .24]], awning)),
      rect(s.width * .2, s.height * .5, s.width * .6, s.height * .5, '#5b4a3a'),
      rect(s.width * .18, s.height * .46, s.width * .64, s.height * .06, C.kraftDeep),
      corrugation(s.width, s.height),
    )))
  }

  const shutter = (id) => {
    const s = artSize(2.2, 1.4)
    return art(id, svg(s.width, s.height, group(
      rect(0, 0, s.width, s.height, C.slate),
      ...Array.from({ length: 9 }, (_, i) => rect(0, (i + .3) * s.height / 9, s.width, s.height / 22, '#55646f')),
    )))
  }

  const bicycle = (id) => {
    const s = artSize(1.4, .9)
    return art(id, svg(s.width, s.height, group(
      circle(s.width * .24, s.height * .72, s.height * .26, 'none', ` stroke="${C.ink}" stroke-width="${s.height * .07}"`),
      circle(s.width * .78, s.height * .72, s.height * .26, 'none', ` stroke="${C.ink}" stroke-width="${s.height * .07}"`),
      path(`M${s.width * .24} ${s.height * .72} L${s.width * .45} ${s.height * .34} L${s.width * .72} ${s.height * .34} L${s.width * .78} ${s.height * .72}Z`,
        'none', ` stroke="${C.signal}" stroke-width="${s.height * .07}"`),
      rect(s.width * .38, s.height * .26, s.width * .18, s.height * .08, C.ink),
    )))
  }

  const crossingPost = (id) => {
    const s = artSize(.6, 2.0)
    return art(id, svg(s.width, s.height, group(
      rect(s.width * .34, 0, s.width * .32, s.height, C.slate),
      circle(s.width * .5, s.height * .12, s.width * .26, C.signal),
      rect(s.width * .1, s.height * .9, s.width * .8, s.height * .1, C.kraftDeep),
    )))
  }

  const crossingArm = (id) => {
    const s = artSize(3.2, .3)
    return art(id, svg(s.width, s.height, group(
      ...Array.from({ length: 8 }, (_, i) => rect(i * s.width / 8, 0, s.width / 8, s.height, i % 2 ? C.signal : '#f0ead8')),
    )))
  }

  const train = (id) => {
    const s = artSize(4.6, 1.2)
    return art(id, svg(s.width, s.height, group(
      path(`M${s.width * .02} ${s.height * .82} L${s.width * .02} ${s.height * .3} Q${s.width * .06} ${s.height * .1} ${s.width * .16} ${s.height * .08} L${s.width * .96} ${s.height * .08} L${s.width * .98} ${s.height * .82}Z`, '#6f8ea8'),
      rect(0, s.height * .78, s.width, s.height * .1, '#3f5364'),
      ...Array.from({ length: 7 }, (_, i) => rect(s.width * (.1 + i * .12), s.height * .24, s.width * .08, s.height * .3, C.edge)),
      ...[.2, .78].map((u) => circle(s.width * u, s.height * .93, s.height * .07, '#33424f')),
      rect(s.width * .02, s.height * .3, s.width * .06, s.height * .22, '#f2c34a'),
    )))
  }

  const rails = (id) => {
    const s = artSize(7.4, 1.3)
    return art(id, svg(s.width, s.height, group(
      rect(0, 0, s.width, s.height, '#8b7a63'),
      ...Array.from({ length: 14 }, (_, i) => rect(i * s.width / 14 + s.width / 60, s.height * .1, s.width / 22, s.height * .8, '#6d5b45')),
      rect(0, s.height * .26, s.width, s.height * .07, '#9aa5ac'),
      rect(0, s.height * .66, s.width, s.height * .07, '#9aa5ac'),
    )), { opaque: true })
  }

  const child = (id, coat) => {
    const s = artSize(.7, 1.1)
    return art(id, svg(s.width, s.height, group(
      circle(s.width * .5, s.height * .16, s.width * .26, '#f0c89c'),
      path(`M${s.width * .2} ${s.height * .16} A${s.width * .3} ${s.height * .2} 0 0 1 ${s.width * .8} ${s.height * .16}Z`, '#5b4632'),
      rect(s.width * .26, s.height * .32, s.width * .48, s.height * .4, coat),
      rect(s.width * .3, s.height * .7, s.width * .16, s.height * .3, '#3f4a5a'),
      rect(s.width * .54, s.height * .7, s.width * .16, s.height * .3, '#3f4a5a'),
      rect(s.width * .68, s.height * .36, s.width * .22, s.height * .26, C.signal),
    )))
  }

  /** 校舎。白い壁に淡い縁取りで、住宅街の色紙から浮き立たせる */
  const school = (id) => {
    const s = artSize(6.2, 2.4)
    return art(id, svg(s.width, s.height, group(
      rect(0, s.height * .22, s.width, s.height * .78, C.school),
      rect(0, s.height * .12, s.width, s.height * .12, '#9fb6c4'),
      rect(0, s.height * .22, s.width, s.height * .03, C.schoolTrim),
      rect(s.width * .44, 0, s.width * .12, s.height * .16, C.schoolTrim),
      ...[0, 1, 2].flatMap((row) => Array.from({ length: 9 }, (_, col) => group(
        rect(s.width * (.05 + col * .105), s.height * (.32 + row * .2), s.width * .07, s.height * .13, '#bcd4e4'),
        rect(s.width * (.05 + col * .105), s.height * (.32 + row * .2), s.width * .07, s.height * .13, 'none',
          ` stroke="${C.schoolTrim}" stroke-width="${s.width * .004}"`)))),
      ...[0, 1].map((i) => rect(0, s.height * (.44 + i * .2), s.width, s.height * .015, C.schoolTrim)),
      rect(s.width * .44, s.height * .72, s.width * .12, s.height * .28, '#9fb6c4'),
      corrugation(s.width, s.height),
    )))
  }

  /** 遠くの家並みを一枚に切り抜いた、中央線をまたぐ帯 */
  const townscape = (id, worldWidth = 9.2, worldHeight = 2.2) => {
    const s = artSize(worldWidth, worldHeight)
    const block = (x, w, h, wall, roof) => group(
      rect(x, s.height - h, w, h, wall),
      poly([[x - w * .08, s.height - h], [x + w * .5, s.height - h - s.height * .16], [x + w * 1.08, s.height - h]], roof),
      ...[0, 1].map((i) => rect(x + w * (.18 + i * .42), s.height - h + s.height * .12, w * .22, s.height * .1, C.edge)),
    )
    return art(id, svg(s.width, s.height, group(
      ...[[.02, .5], [.14, .68], [.27, .46], [.39, .74], [.52, .58], [.63, .8], [.76, .52], [.87, .66]].map(([u, k], i) =>
        block(s.width * u, s.width * .1, s.height * k, WALL[i % WALL.length], ROOF[(i * 5) % ROOF.length])),
    )))
  }

  /** 商店街のアーケード屋根。中央が背表紙にあたる */
  const arcade = (id) => {
    const s = artSize(9.0, 2.4)
    return art(id, svg(s.width, s.height, group(
      rect(0, s.height * .52, s.width, s.height * .2, C.kraftDark),
      poly([[0, s.height * .52], [s.width * .5, s.height * .06], [s.width, s.height * .52]], '#a9633f'),
      ...Array.from({ length: 9 }, (_, i) => rect(s.width * (.06 + i * .1), s.height * .72, s.width * .05, s.height * .28, C.kraftDeep)),
      ...Array.from({ length: 4 }, (_, i) => rect(s.width * (.14 + i * .22), s.height * .74, s.width * .12, s.height * .16, i % 2 ? C.signal : '#4a7f8f')),
    )))
  }

  /** 教室の窓。ガラス面は抜いておき、奥の景色が透けて見えるようにする */
  const windowFrame = (id) => {
    const s = artSize(9.0, 3.0)
    const bar = s.height * .05
    return art(id, svg(s.width, s.height, group(
      rect(0, 0, s.width, bar * 1.5, '#e8e2d2'),
      rect(0, 0, bar * 1.3, s.height, '#e8e2d2'),
      rect(s.width - bar * 1.3, 0, bar * 1.3, s.height, '#e8e2d2'),
      rect(s.width * .5 - bar * .8, 0, bar * 1.6, s.height - bar * 2.2, '#e8e2d2'),
      ...[.25, .75].map((u) => rect(s.width * u - bar * .35, 0, bar * .7, s.height - bar * 2.2, '#e8e2d2')),
      rect(0, s.height * .5, s.width, bar * .8, '#d6cdb8'),
      rect(-s.width * .012, s.height - bar * 2.2, s.width * 1.024, bar * 1.1, C.wood),
      rect(-s.width * .012, s.height - bar * 1.1, s.width * 1.024, bar * 1.1, '#bd9a6c'),
    )), { alphaBounds: { x: 0, y: 0, width: 1, height: 1 } })
  }

  /** 教室の椅子。机の奥へ置いて座席に見せる */
  const chair = (id) => {
    const s = artSize(.8, 1.0)
    return art(id, svg(s.width, s.height, group(
      rect(s.width * .16, 0, s.width * .68, s.height * .5, C.wood, ' rx="6"'),
      rect(s.width * .16, s.height * .5, s.width * .68, s.height * .12, '#a9835a'),
      rect(s.width * .22, s.height * .62, s.width * .1, s.height * .38, '#7f8794'),
      rect(s.width * .68, s.height * .62, s.width * .1, s.height * .38, '#7f8794'),
    )))
  }


  /** 教室のカーテン。窓の左右へ寄せる */
  const curtain = (id) => {
    const s = artSize(1.0, 2.4)
    return art(id, svg(s.width, s.height, group(
      path(`M0 0 H${s.width} V${s.height * .92} Q${s.width * .5} ${s.height} 0 ${s.height * .9}Z`, '#e8eef0'),
      ...[.24, .5, .76].map((u) => path(`M${s.width * u} 0 V${s.height * .9}`, 'none', ` stroke="#c6d2d6" stroke-width="${s.width * .08}"`)),
    )))
  }

  /** 床に置いたかばん */
  const satchel = (id) => {
    const s = artSize(.7, .6)
    return art(id, svg(s.width, s.height, group(
      rect(s.width * .1, s.height * .3, s.width * .8, s.height * .62, '#b8543f', ' rx="8"'),
      rect(s.width * .1, s.height * .3, s.width * .8, s.height * .18, '#9c4130', ' rx="6"'),
      path(`M${s.width * .3} ${s.height * .3} Q${s.width * .5} ${s.height * .02} ${s.width * .7} ${s.height * .3}`,
        'none', ` stroke="#9c4130" stroke-width="${s.width * .07}"`),
    )))
  }

  const desk = (id) => {
    const s = artSize(1.4, .9)
    return art(id, svg(s.width, s.height, group(
      rect(0, 0, s.width, s.height * .2, C.wood, ' rx="5"'),
      rect(0, s.height * .2, s.width, s.height * .07, '#a9835a'),
      rect(s.width * .08, s.height * .27, s.width * .09, s.height * .73, '#7f8794'),
      rect(s.width * .83, s.height * .27, s.width * .09, s.height * .73, '#7f8794'),
      rect(s.width * .12, s.height * .58, s.width * .76, s.height * .06, '#7f8794'),
    )))
  }

  art('cover-front.svg', svg(PAGE_ART.width, PAGE_ART.height, group(
    rect(0, 0, 1250, 1000, C.kraft),
    rect(0, 640, 1250, 360, C.kraftDark),
    ...[[160, 380], [430, 300], [700, 400], [960, 320]].map(([x, y], i) => group(
      rect(x, y, 180, 260, WALL[(i * 2) % WALL.length]),
      poly([[x - 20, y], [x + 90, y - 90], [x + 200, y]], ROOF[(i * 3) % ROOF.length]))),
    circle(1080, 190, 78, '#ffdc9b'),
  )), { opaque: true })
  art('cover-inside.svg', svg(PAGE_ART.width, PAGE_ART.height, group(
    rect(0, 0, 1250, 1000, '#d8b98d'),
    ...Array.from({ length: 40 }, (_, i) => rect((i % 8) * 156 + 20, Math.floor(i / 8) * 200 + 30, 110, 8, C.kraftDark, ' opacity=".4"')),
  )), { opaque: true })
  art('cover-back.svg', svg(PAGE_ART.width, PAGE_ART.height,
    rect(0, 0, 1250, 1000, C.kraft)), { opaque: true })

  const houseA = house('house-a.svg', WALL[0], ROOF[0])
  const houseB = house('house-b.svg', WALL[1], ROOF[2])
  const houseC = house('house-c.svg', WALL[2], ROOF[3])
  const houseD = house('house-d.svg', WALL[5], ROOF[1])
  const houseE = house('house-e.svg', WALL[3], ROOF[4])
  const apartmentArt = apartment('apartment.svg', WALL[4], ROOF[5])
  /**
   * 遠景。中央線をまたぐ一枚の立ち板として置き、自動的に二翼化する。
   *
   * 片面ごとの立ち板を2枚並べると、綴じ目で絵が切れて短冊が2本に見える。
   * また片面幅 (7.9) に絵の縦横比 (約4.2:1) を掛けると高さが1.9で頭打ちになり、
   * 家並みが低い帯にしかならない。背をまたげば絵は一続きになり、
   * 帯を切り詰めたぶん一軒ずつが大きく読める。
   *
   * 素材は元のパノラマを BACKDROP_SPAN の縦横比へ切り出して作る:
   *   magick townscape.webp   -crop 704x245+160+0 +repage -resize 1024x356!    *     -quality 88 -define webp:method=6 backdrop-town.webp
   *   magick town-row.webp    -crop 1024x356+0+7  +repage -resize 1024x356! ... backdrop-row.webp
   *   magick mountain-far.webp -crop 713x248+155+0 +repage -resize 1024x356! ... backdrop-mountain.webp
   */
  const backdrop = (id) => {
    const s = artSize(BACKDROP_SPAN.width, BACKDROP_SPAN.height)
    return art(id, svg(s.width, s.height, group(
      rect(0, s.height * .3, s.width, s.height * .7, C.slate, ' opacity=".35"'),
    )))
  }

  const mountainFar = mountain('mountain-far.svg', '#7e8fa6')
  const mountainNear = mountain('mountain-near.svg', '#6b7f96')
  const backdropTown = backdrop('backdrop-town.svg')
  const backdropRow = backdrop('backdrop-row.svg')
  const backdropMountain = backdrop('backdrop-mountain.svg')
  const poleArt = pole('utility-pole.svg')
  const shopArt = shopFront('shop-front.svg', C.signal, WALL[0])
  const shopArtB = shopFront('shop-front-b.svg', '#46789c', WALL[1])
  const shopArtC = shopFront('shop-front-c.svg', '#5f8f5c', WALL[5])
  const shopArtD = shopFront('shop-front-d.svg', '#dd8b46', WALL[2])
  const shutterArt = shutter('shutter.svg')
  const bicycleArt = bicycle('bicycle.svg')
  const postArt = crossingPost('crossing-post.svg')
  const armArt = crossingArm('crossing-arm.svg')
  const trainArt = train('train.svg')
  const railArt = rails('rails.svg')
  const childRed = child('child-red.svg', '#c8503c')
  const childBlue = child('child-blue.svg', '#3f6f9c')
  const schoolArt = school('school.svg')
  const windowArt = windowFrame('window-frame.svg')
  const townscapeArt = townscape('townscape.svg')
  const townRowArt = townscape('town-row.svg', 6.2, 2.2)
  const arcadeArt = arcade('arcade.svg')
  const deskArt = desk('desk.svg')
  const chairArt = chair('chair.svg')
  const curtainArt = curtain('curtain.svg')
  const satchelArt = satchel('satchel.svg')

  // 取り込んだ街の部品。紙面へ描かずに立てるためのもの
  const postboxArt = adopted('postbox.svg', 106, 200)
  const vendingArt = adopted('vending-machine.svg', 198, 304)
  const signalArt = adopted('traffic-signal.svg', 135, 513)
  const pedSignalArt = adopted('pedestrian-signal.svg', 86, 456)
  const cherryArt = adopted('cherry-tree.svg', 372, 380)
  const cherrySmallArt = adopted('cherry-tree-small.svg', 279, 285)
  const dogArt = adopted('walking-dog.svg', 141, 137)
  const shibaArt = adopted('walking-dog-2.svg', 158, 118)
  const bakeryArt = adopted('bakery-front.svg', 300, 437)
  const storeArt = adopted('convenience-store-front.svg', 543, 333)
  const truckArt = adopted('kei-truck.svg', 386, 257)
  const scooterArt = adopted('scooter.svg', 230, 218)
  const hydrangeaArt = adopted('hydrangea-planter.svg', 192, 209)
  const clockArt = adopted('school-clock.svg', 234, 323)

  /** 教室の床。板張りの筋と、窓ぎわへ落ちる朝日の帯 */
  const classroom = (id) => art(id, svg(PAGE_ART.width, PAGE_ART.height, group(
    rect(0, 0, 1250, 1000, '#e3c79c'),
    ...Array.from({ length: 12 }, (_, i) => rect(0, i * 84, 1250, 5, '#c9a878', ' opacity=".5"')),
    ...[[180, 0], [700, 0]].map(([x]) => rect(x, 0, 260, 1000, '#f9edd4', ' opacity=".38"')),
  )), { opaque: true })

  // --- 見開き1: 目覚める住宅街 ---------------------------------------------
  {
    const s = work.spread({
      name: '目覚める住宅街', hold: 6.5,
      leftPage: ground('page-1-left.svg', '#cdb086', '#b2966f'),
      rightPage: ground('page-1-right.svg', '#cdb086', '#b2966f'),
    })
    s.stand('right', { id: 'mountain', name: '遠景の山', asset: backdropMountain, u: 0, width: BACKDROP_SPAN.width, height: BACKDROP_SPAN.height, v: BACKDROP_SPAN.v, backdrop: true, layer: 1 })
    // 遠景の稜線は前景の家より低く抑える。同じ高さだと奥行きが出ない
    s.stand('right', { id: 'skyline', name: '遠景の街並み', asset: townscapeArt, u: 0, width: 9.2, height: 1.7, v: .20, backdrop: true, layer: 2 })

    // 一戸建ての絵は正方形、集合住宅は縦長。どちらも絵の縦横比のまま拡げる。
    // 集合住宅は 4 単位ぶんしか紙に畳めないので、奥へ置いて手前へ倒す
    const detached = street(REAL.house2f)
    const small = street(6)
    const houses = [
      { page: 'left', u: .30, v: .56, w: detached, h: detached, asset: houseA },
      { page: 'left', u: .72, v: .48, w: small, h: small, asset: houseC },
      { page: 'right', u: .24, v: .66, w: wide(3.7, apartmentArt), h: 3.7, asset: apartmentArt },
      { page: 'right', u: .62, v: .56, w: detached, h: detached, asset: houseD },
      { page: 'right', u: .82, v: .48, w: small, h: small, asset: houseE },
    ]
    houses.forEach((item, index) => {
      s.stand(item.page, {
        id: `house-${index + 1}`, name: `家並み ${index + 1}`, asset: item.asset,
        u: item.u, v: item.v, width: item.w, height: item.h, fall: item.fall ?? 'back', layer: 3 + index,
      })
      // 起立は収納機構に任せ、背景パネルの起立後に部品が紙面へ残らないようにする。
    })
    ;[['left', .48, .78], ['right', .44, .84], ['right', .84, .90]].forEach(([page, u, v], index) => {
      s.stand(page, {
        id: `pole-${index + 1}`, name: `電柱 ${index + 1}`, asset: poleArt,
        u, v, width: wide(street(REAL.pole), poleArt), height: street(REAL.pole), fall: 'back', layer: 9 + index,
      })
    })
    // 紙面から抜いた町の細部を、立ち上がる部品として戻す
    s.stand('left', { id: 'cherry', name: '角の桜', asset: cherryArt, u: .19, v: .74, width: wide(street(REAL.cherry), cherryArt), height: street(REAL.cherry), fall: 'back', layer: 12 })
    s.stand('left', { id: 'store', name: '角のコンビニ', asset: storeArt, u: .68, v: .40, width: wide(street(4.2), storeArt), height: street(4.2), fall: 'back', layer: 13 })
    s.stand('right', { id: 'postbox', name: '郵便ポスト', asset: postboxArt, u: .13, v: .86, width: wide(near(REAL.postbox), postboxArt), height: near(REAL.postbox), fall: 'back', layer: 14 })
    s.stand('left', { id: 'dog', name: '散歩の犬', asset: dogArt, u: .90, v: .90, width: wide(near(REAL.dog), dogArt), height: near(REAL.dog), fall: 'back', layer: 16 })
    s.caption('left', { id: 'text', text: 'I left the house\nwhile the town was still quiet', u: .5, v: .92, size: .40, color: '#4a3a26' })
    s.camera([
      { time: 0, position: [0, 11.6, 16.2], target: [0, 1.2, .2], fov: 44 },
      { time: 6.5, position: [.8, 10.4, 14.6], target: [.4, 1.4, .2], fov: 43 },
    ])
    s.environment([
      { time: 0, background: C.dawn, 'ambient.intensity': .82, 'directional.color': '#ffb28a', 'directional.intensity': 1.1 },
      { time: 6.5, background: '#8fb0cd', 'ambient.intensity': 1.15, 'directional.color': '#ffe4c0', 'directional.intensity': 1.6 },
    ])
  }

  // --- 見開き2: 商店街の朝 -------------------------------------------------
  {
    const s = work.spread({
      name: '商店街の朝', hold: 6.5,
      leftPage: ground('page-2-left.svg', '#d2b58b', '#bb9c70'),
      rightPage: ground('page-2-right.svg', '#d2b58b', '#bb9c70'),
    })
    s.stand('right', { id: 'far-row', name: '遠景の家並み', asset: backdropRow, u: 0, width: BACKDROP_SPAN.width, height: BACKDROP_SPAN.height, v: BACKDROP_SPAN.v, backdrop: true, layer: 1 })
    s.stand('right', { id: 'arcade', name: '商店街のアーケード', asset: arcadeArt, u: 0, width: 9.0, height: 2.4, v: .22, layer: 2 })

    const shops = [
      { page: 'left', u: .28, v: .58, asset: shopArt },
      { page: 'left', u: .76, v: .58, asset: shopArtB },
      { page: 'right', u: .28, v: .58, asset: shopArtC },
      { page: 'right', u: .76, v: .58, asset: shopArtD },
    ]
    // 高さは4軒とも揃える。幅は絵ごとの縦横比で決まるので店ごとに違う。
    // シャッターも高さを共通化し、左右端の店だけ上端が下がらないようにする。
    const SHOP_HEIGHT = street(5.6)
    const SHUTTER_HEIGHT = Math.max(...shops.map((shop) => {
      const shopWidth = wide(SHOP_HEIGHT, shop.asset)
      const shutterWidth = Math.round(shopWidth * 84) / 100
      return Math.round((shutterWidth / aspect(shutterArt)) * 100) / 100
    }))
    shops.forEach((shop, index) => {
      const shopWidth = wide(SHOP_HEIGHT, shop.asset)
      const shutterWidth = Math.round(shopWidth * 84) / 100
      s.stand(shop.page, {
        id: `shop-${index + 1}`, name: `商店 ${index + 1}`, asset: shop.asset,
        u: shop.u, v: shop.v, width: shopWidth, height: SHOP_HEIGHT, fall: 'back', layer: 3 + index,
      })
      // シャッターは店先の一枚手前に立て、上端を残したまま巻き上がる。
      // 接地線のPivotは動かせないので、下端を上げながら同じだけ縮めて
      // 上端の高さ (position.y + height×scale.y) を一定に保つ。
      const shutterId = s.stand(shop.page, {
        id: `shutter-${index + 1}`, name: `シャッター ${index + 1}`, asset: shutterArt,
        u: shop.u, v: shop.v + .014, width: shutterWidth, height: SHUTTER_HEIGHT, fall: 'back', layer: 8 + index,
      })
      const opens = .6 + index * .95
      const opened = opens + 1.2
      s.track(shutterId, 'position.y', [[0, .01], [opens, .01], [opened, SHUTTER_HEIGHT * .93]])
      s.track(shutterId, 'scale.y', [[0, 1], [opens, 1], [opened, .07]])
    })
    s.stand('left', { id: 'bicycle', name: '自転車', asset: bicycleArt, u: .52, v: .86, width: wide(near(REAL.bicycle), bicycleArt), height: near(REAL.bicycle), fall: 'back', layer: 14 })
    ;[['left', .16, .82], ['right', .16, .84], ['right', .64, .88]].forEach(([page, u, v], index) => {
      s.stand(page, {
        id: `planter-${index + 1}`, name: `アジサイの植え込み ${index + 1}`, asset: hydrangeaArt,
        u, v, width: wide(near(.9), hydrangeaArt), height: near(.9), fall: 'back', layer: 15 + index,
      })
    })
    s.stand('left', { id: 'vending', name: '自販機', asset: vendingArt, u: .82, v: .74, width: wide(near(REAL.vending), vendingArt), height: near(REAL.vending), fall: 'back', layer: 19 })
    s.stand('left', { id: 'postbox', name: '郵便ポスト', asset: postboxArt, u: .36, v: .76, width: wide(near(REAL.postbox), postboxArt), height: near(REAL.postbox), fall: 'back', layer: 20 })
    s.stand('right', { id: 'scooter', name: '配達のスクーター', asset: scooterArt, u: .88, v: .90, width: wide(near(REAL.scooter), scooterArt), height: near(REAL.scooter), fall: 'back', layer: 21 })
    const walker = s.stand('right', { id: 'walker', name: '通学する子', asset: childBlue, u: .5, v: .93, width: wide(near(REAL.child), childBlue), height: near(REAL.child), fall: 'back', layer: 18 })
    s.track(walker, 'position.x', [[0, -1.6], [6.5, 2.4]], 'linear')
    s.caption('left', { id: 'text', text: 'The shutters roll up one by one\nand the town starts moving', u: .5, v: .92, size: .38, color: '#463726' })
    s.camera([
      { time: 0, position: [-.7, 10.6, 15.8], target: [-.4, 1.3, .3], fov: 44 },
      { time: 6.5, position: [1.1, 11.2, 16.2], target: [.6, 1.3, .1], fov: 44 },
    ])
    s.environment([
      { time: 0, background: '#8fb0cd', 'ambient.intensity': 1.15 },
      { time: 6.5, background: '#a7c8de', 'ambient.intensity': 1.25 },
    ])
  }

  // --- 見開き3: 踏切 -------------------------------------------------------
  {
    const s = work.spread({
      name: '踏切', hold: 7,
      leftPage: ground('page-3-left.svg', '#8d8b90', '#75737a'),
      rightPage: ground('page-3-right.svg', '#8d8b90', '#75737a'),
    })
    s.stand('right', { id: 'far-row', name: '遠景の家並み', asset: backdropTown, u: 0, width: BACKDROP_SPAN.width, height: BACKDROP_SPAN.height, v: BACKDROP_SPAN.v, backdrop: true, layer: 1 })
    // 中央線の端がページ送り中に次の見開きへ露出しないよう、左右対称に逃がす
    const RAIL_WIDTH = 7.6
    s.flat('left', { id: 'rails', name: '線路 (左)', asset: railArt, u: .5, v: .40, width: RAIL_WIDTH, depth: 1.39, layer: 1 })
    s.flat('right', { id: 'rails-r', name: '線路 (右)', asset: railArt, u: .5, v: .40, width: RAIL_WIDTH, depth: 1.39, layer: 1 })

    // 遮断機: 支柱は紙に立ち、腕は支柱の先端へ取り付けた子部品として回る
    const POST_HEIGHT = crossing(3.6)
    const ARM_WIDTH = crossing(4.6)
    const postL = s.stand('left', { id: 'post-l', name: '遮断機の柱 (左)', asset: postArt, u: .30, v: .62, width: wide(POST_HEIGHT, postArt), height: POST_HEIGHT, fall: 'back', layer: 6 })
    const armL = s.hover({
      id: 'arm-l', name: '遮断機の腕 (左)', asset: armArt, parent: { type: 'element', elementId: postL },
      x: .12, y: POST_HEIGHT * .85, z: .02, width: ARM_WIDTH, height: Math.round(ARM_WIDTH * 3 / 32 * 100) / 100, layer: 7,
    })
    const postR = s.stand('right', { id: 'post-r', name: '遮断機の柱 (右)', asset: postArt, u: .30, v: .62, width: wide(POST_HEIGHT, postArt), height: POST_HEIGHT, fall: 'back', layer: 6 })
    const armR = s.hover({
      id: 'arm-r', name: '遮断機の腕 (右)', asset: armArt, parent: { type: 'element', elementId: postR },
      x: .12, y: POST_HEIGHT * .85, z: .02, width: ARM_WIDTH, height: Math.round(ARM_WIDTH * 3 / 32 * 100) / 100, layer: 7,
    })
    // 腕は左端を軸に、垂直から水平へ下りる
    for (const arm of [armL, armR]) {
      s.track(arm, 'rotation.z', [[0, 88], [.8, 88], [2.0, 2]])
    }

    // 電車は透明支持片で運ぶ唯一の部品。本の輪郭の内側を端から端まで通る
    const TRAIN_HEIGHT = crossing(3.1)
    const TRAIN_WIDTH = wide(TRAIN_HEIGHT, trainArt)
    const trainId = s.hover({
      id: 'train', name: '通過する電車', asset: trainArt, x: -4.12, y: TRAIN_HEIGHT / 2 + .45, z: -.5, width: TRAIN_WIDTH, height: TRAIN_HEIGHT, layer: 10,
    })
    // hover のルートは開始位置に応じた片面座標へ保存される。電車は左ページ所属なので、
    // 見開き上の -4.12 → 4.12 を左ページローカルの -.12 → 8.12 へ直して追跡する。
    s.track(trainId, 'position.x', [[0, -.12], [2.2, -.12], [5.0, 8.12], [7, 8.12]], 'linear')
    s.track(trainId, 'visible', [[0, false], [2.2, true], [5.2, false]])

    s.stand('left', { id: 'kid-1', name: '待つ子ども 1', asset: childRed, u: .66, v: .88, width: wide(near(REAL.child), childRed), height: near(REAL.child), fall: 'back', layer: 12 })
    s.stand('left', { id: 'kid-2', name: '待つ子ども 2', asset: childBlue, u: .78, v: .92, width: wide(near(REAL.child), childBlue), height: near(REAL.child), fall: 'back', layer: 13 })
    s.stand('right', { id: 'pole', name: '電柱', asset: poleArt, u: .86, v: .92, width: wide(crossing(8.5), poleArt), height: crossing(8.5), fall: 'back', layer: 11 })
    // 踏切まわりの設備。紙に描かず、それぞれ一枚の板として立てる
    s.stand('left', { id: 'ped-signal', name: '歩行者信号', asset: pedSignalArt, u: .54, v: .76, width: wide(crossing(3.2), pedSignalArt), height: crossing(3.2), fall: 'back', layer: 14 })
    s.stand('right', { id: 'signal', name: '信号機', asset: signalArt, u: .52, v: .80, width: wide(crossing(REAL.trafficLight), signalArt), height: crossing(REAL.trafficLight), fall: 'back', layer: 15 })
    s.stand('left', { id: 'truck', name: '待つ軽トラック', asset: truckArt, u: .32, v: .80, width: wide(near(1.9), truckArt), height: near(1.9), fall: 'back', layer: 16 })
    s.stand('right', { id: 'shiba', name: '散歩の柴犬', asset: shibaArt, u: .62, v: .94, width: wide(near(REAL.dog), shibaArt), height: near(REAL.dog), fall: 'back', layer: 17 })
    s.caption('left', { id: 'text', text: 'The bell goes ding-ding\nand the train slides past', u: .42, v: .92, size: .38, color: '#463726' })
    s.camera([
      { time: 0, position: [0, 11.2, 16.0], target: [0, 1.3, 0], fov: 44 },
      { time: 3.6, position: [0, 10.4, 14.9], target: [0, 1.5, -.3], fov: 43 },
      { time: 7, position: [0, 11.4, 16.2], target: [0, 1.3, 0], fov: 44 },
    ])
    s.environment([
      { time: 0, background: '#a7c8de', 'ambient.intensity': 1.25 },
      { time: 7, background: '#b6d5e8', 'ambient.intensity': 1.3 },
    ])
  }

  // --- 見開き4: 坂道と校舎 -------------------------------------------------
  {
    const s = work.spread({
      name: '坂道と校舎', hold: 7, turn: 1.8,
      leftPage: ground('page-4-left.svg', '#d5b98e', '#c0a476'),
      rightPage: ground('page-4-right.svg', '#d5b98e', '#c0a476'),
    })
    s.stand('right', { id: 'mountain', name: '遠景の山', asset: backdropMountain, u: 0, width: BACKDROP_SPAN.width, height: BACKDROP_SPAN.height, v: BACKDROP_SPAN.v, backdrop: true, layer: 1 })
    s.stand('right', { id: 'school', name: '校舎', asset: schoolArt, u: 0, width: wide(4.2, schoolArt), height: 4.2, v: .24, layer: 3 })
    const slopeHouse = street(REAL.house2f)
    const slopeSmall = street(6)
    ;[['left', .26, .58, slopeHouse], ['left', .74, .72, slopeSmall], ['right', .28, .60, slopeHouse], ['right', .76, .74, slopeSmall]].forEach(([page, u, v, size], index) => {
      s.stand(page, {
        id: `house-${index + 1}`, name: `坂の家 ${index + 1}`, asset: [houseA, houseB, houseC, houseD][index % 4],
        u, v, width: size, height: size, fall: 'back', layer: 4 + index,
      })
    })
    ;[['left', .50, .80], ['right', .52, .82]].forEach(([page, u, v], index) => {
      s.stand(page, {
        id: `pole-${index + 1}`, name: `坂の電柱 ${index + 1}`, asset: poleArt,
        u, v, width: wide(street(REAL.pole), poleArt), height: street(REAL.pole), fall: 'back', layer: 9 + index,
      })
    })
    // 坂の並木と町角。校舎までの道のりを紙の板で埋める
    s.stand('left', { id: 'cherry-1', name: '坂の桜 (左)', asset: cherryArt, u: .19, v: .76, width: wide(street(REAL.cherry), cherryArt), height: street(REAL.cherry), fall: 'back', layer: 11 })
    s.stand('right', { id: 'cherry-2', name: '坂の桜 (右)', asset: cherryArt, u: .19, v: .82, width: wide(street(REAL.cherry), cherryArt), height: street(REAL.cherry), fall: 'back', layer: 12 })
    s.stand('left', { id: 'bakery', name: '坂下のパン屋', asset: bakeryArt, u: .84, v: .62, width: wide(street(REAL.shop), bakeryArt), height: street(REAL.shop), fall: 'back', layer: 13 })
    s.stand('right', { id: 'clock', name: '校門の時計', asset: clockArt, u: .40, v: .74, width: wide(street(3.2), clockArt), height: street(3.2), fall: 'back', layer: 15 })
    s.stand('left', { id: 'postbox', name: '郵便ポスト', asset: postboxArt, u: .72, v: .88, width: wide(near(REAL.postbox), postboxArt), height: near(REAL.postbox), fall: 'back', layer: 16 })
    const climber = s.stand('right', { id: 'climber', name: '坂をのぼる子', asset: childRed, u: .62, v: .94, width: wide(near(REAL.child), childRed), height: near(REAL.child), fall: 'back', layer: 14 })
    s.track(climber, 'position.z', [[0, 1.9], [7, .2]])
    s.track(climber, 'scale', [[0, 1.1], [7, .78]])
    s.stand('left', { id: 'friend', name: '追いかける友だち', asset: childBlue, u: .30, v: .94, width: wide(near(REAL.child), childBlue), height: near(REAL.child), fall: 'back', layer: 14 })
    s.caption('left', { id: 'text', text: 'Up the hill\nthe school roof comes into view', u: .5, v: .92, size: .36, color: '#463726' })
    // 坂を進む構図へのカメラ移動
    s.camera([
      { time: 0, position: [-.5, 12.0, 17.0], target: [-.2, 1.4, 1.2], fov: 45 },
      { time: 7, position: [.5, 9.4, 13.6], target: [.2, 2.2, -.6], fov: 41 },
    ])
    s.environment([
      { time: 0, background: '#b6d5e8', 'ambient.intensity': 1.3 },
      { time: 7, background: '#c6e0ef', 'ambient.intensity': 1.35, 'directional.intensity': 1.75 },
    ])
  }

  // --- 見開き5: 教室の窓から -----------------------------------------------
  {
    // 室内から窓の外を見る構図。窓枠より奥に景色、手前に机と椅子を置く。
    // 窓は幅 12.0 なので見開き座標で |x| <= 6.0 が窓の内側。景色もカーテンも
    // この範囲へ収める。外へ出すと壁のない宙に貼られて見える。
    const s = work.spread({
      name: '教室の窓から', hold: 7, turn: 2.2,
      leftPage: classroom('page-5-left.svg'),
      rightPage: classroom('page-5-right.svg'),
    })
    for (const [page, side] of [['left', '左'], ['right', '右']]) {
      s.stand(page, {
        id: `mountain-${page}`, name: `遠景の山 (${side})`, asset: page === 'left' ? mountainFar : mountainNear,
        u: .375, v: .05, width: 6.0, height: 2.86, backdrop: true, fall: 'front', layer: 0,
      })
      s.stand(page, {
        id: `town-${page}`, name: `遠景の町 (${side})`, asset: townRowArt,
        u: .375, v: .13, width: 6.0, height: 2.32, backdrop: true,
      })
      // 窓の外の桜も背景グループとして先に起立させ、町の板を貫通させない
      s.stand(page, {
        id: `cherry-${page}`, name: `背景の桜 (${side})`, asset: cherrySmallArt,
        u: .62, v: .09, width: 2.06, height: 2.1, backdrop: true, fall: 'front', layer: 1,
      })
    }
    s.stand('right', { id: 'window', name: '教室の窓', asset: windowArt, u: 0, width: 12.0, height: 4.0, v: .30, layer: 4 })
    // カーテンは窓枠の内側に吊る。楔をまたぐ窓パネルの蓋の下には背の高い
    // 立て板を畳めないので、接地線ヒンジではなく透明支持片で浮かせる。
    // レールから下がって床には届かない高さが、そのまま吊り下がりに見える。
    for (const [side, x] of [['左', -4.7], ['右', 4.7]]) {
      s.hover({
        id: `curtain-${x < 0 ? 'l' : 'r'}`, name: `カーテン (${side})`, asset: curtainArt,
        x, y: 2.24, z: -1.02, width: wide(room(1.92), curtainArt), height: room(1.92), layer: 6,
        motion: [{ type: 'sway', amplitude: 1.6, period: 5.4, phase: x < 0 ? 0 : 1.3 }],
      })
    }

    // 机と椅子は前後3列・左右4列に整列させる。椅子は机の奥、かばんは足元へ置く
    const seats = []
    for (const page of ['left', 'right']) {
      for (const [row, v] of [[0, .54], [1, .72], [2, .90]]) {
        for (const [col, u] of [[0, .22], [1, .50], [2, .78]]) {
          seats.push({ page, u, v, order: row * 6 + col + (page === 'left' ? 0 : 3) })
        }
      }
    }
    seats.forEach((seat, index) => {
      s.stand(seat.page, {
        id: `chair-${index + 1}`, name: `椅子 ${index + 1}`, asset: chairArt,
        u: seat.u, v: seat.v - .07, width: wide(room(REAL.chair), chairArt), height: room(REAL.chair), fall: 'back', layer: 8 + index,
      })
      s.stand(seat.page, {
        id: `desk-${index + 1}`, name: `机 ${index + 1}`, asset: deskArt,
        u: seat.u, v: seat.v, width: wide(room(REAL.desk), deskArt), height: room(REAL.desk), fall: 'back', layer: 20 + index,
      })
    })
    s.stand('left', { id: 'satchel', name: '足元のかばん', asset: satchelArt, u: .82, v: .88, width: wide(room(.36), satchelArt), height: room(.36), fall: 'back', layer: 34 })
    const pupil = s.stand('right', {
      id: 'pupil', name: '窓ぎわの子', asset: childRed, u: .22, v: .48, width: wide(room(REAL.child), childRed), height: room(REAL.child), fall: 'back', layer: 35,
    })
    s.track(pupil, 'position.z', [[0, .9], [7, .5]])

    const sun = s.sparkle({ id: 'sunbeam', name: '差し込む朝日', x: 0, y: 2.0, z: .2, color: '#ffe6b0', size: 1.2 })
    s.track(sun, 'effect.size', [[0, 1.0], [7, 3.2]])
    s.caption('left', { id: 'text', text: 'Beyond the window\nthe same old town spreads out', u: .5, v: .92, size: .34, color: '#463726' })
    s.camera([
      { time: 0, position: [0, 8.2, 11.8], target: [0, 1.6, -.4], fov: 42 },
      { time: 7, position: [0, 13.6, 16.6], target: [0, 1.1, 0], fov: 45 },
    ])
    s.environment([
      { time: 0, background: '#c6e0ef', 'ambient.intensity': 1.35 },
      { time: 7, background: '#dcecf6', 'ambient.intensity': 1.45, 'directional.color': '#fff0d4' },
    ])
  }

  // 音は3作品で共通。BGMは冒頭からループし、ページをめくる音は
  // 各見開きの保持区間の終わり (= 送りの始まり) で鳴る
  work.bgm('bgm.mp3')
  work.pageTurns('page-turn.wav')

  return work
}
