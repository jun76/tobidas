import { readFileSync } from 'node:fs'

/**
 * 公開サンプルの共通制作基盤 (docs/007 §10)。
 *
 * ここが提供するのは「紙工作の語彙」である。制作者は世界座標ではなく、
 * どちらの紙面の・どのあたりに・どの支持機構で立てるかを書く。
 *
 *   flat    紙へ糊付けした平置き (page-glue)
 *   stand   接地線で立てた立ち板 (flap)
 *   arch    背をまたぐ一枚パネル (v-fold)
 *   hover   透明支持片で浮かせた部品 (strut)
 *
 * 位置は片面内の正規化座標 (u, v) で受け取る。
 *   u = 0 背表紙 → 1 小口 (左右どちらの面でも同じ向き)
 *   v = 0 紙面の奥 → 1 紙面の手前
 *
 * 各ヘルパーは、部品が紙面からはみ出さないこと、閉じたときに縮小なしで
 * 収まることを投入時に検査する。ここで弾かれた配置はビルドが通らない。
 */

export const PAGE_WIDTH = 8
export const PAGE_ASPECT = 1.25
export const PAGE_DEPTH = PAGE_WIDTH / PAGE_ASPECT

/**
 * 作品ごとの縮尺。1世界単位が現実の何メートルにあたるかを決める。
 *
 *   const m = scaleOf(2.6)   // 片面 8 単位 ≒ 20m の街区
 *   m(7)                     // 2階建ての家 = 2.69 単位
 *
 * 部品の寸法は必ずここを通して書く。「画面に映える大きさ」で個別に決めると、
 * 犬も郵便ポストも家も 1 単位前後へ寄ってしまい、大小の梯子が潰れる。
 * 潰れた梯子の上では建物がミニチュアに見え、紙面へ描かれた敷石や落ち葉の粒が
 * 巨大に見える。遠近感が読めなくなる原因はほぼこれ。
 *
 * 縮尺は「紙面の模様の粒」から逆算して決める。敷石が片面幅の 1/20 なら
 * その粒は 0.4 単位で、実物の敷石を 1m とみなせる縮尺が上限になる。
 */
export const scaleOf = (metersPerUnit) => (meters) => Math.round((meters / metersPerUnit) * 1000) / 1000

/**
 * 実物の高さの目安 (m)。作品をまたいで使うので、ここを唯一の出典にする。
 * 迷ったら実測値を足す。値をその場で書き換えない。
 */
export const REAL = {
  child: 1.3, adult: 1.65, dog: 0.55, cat: 0.3, deer: 1.4, badger: 0.35, fox: 0.45,
  owl: 0.4, rabbit: 0.35, mushroom: 0.12, flower: 0.35, fern: 0.5,
  postbox: 1.35, pole: 10, trafficLight: 5, vending: 1.9, bicycle: 1.05, scooter: 1.1,
  house2f: 7, house3f: 10, apartment5f: 15, shop: 6.5, cottage: 5, school: 12,
  cherry: 6, pine: 14, broadleaf: 9, windmill: 12, bridge: 2.6, cottageDoor: 2,
  desk: 0.72, chair: 0.8, window: 2.1, curtain: 2.2, pottedPlant: 0.45, boots: 0.32,
  wateringCan: 0.3, chime: 0.25, scarf: 0.9, acorn: 0.03, shell: 0.08, butterfly: 0.08,
  pot: 0.26, knife: 0.33, scale: 0.22, bowl: 0.14, spoon: 0.3, timer: 0.09,
  onion: 0.09, potato: 0.09, carrot: 0.2, garlic: 0.07, ginger: 0.1, meat: 0.14,
  roux: 0.16, spiceBox: 0.18, tomato: 0.08, chili: 0.12, herb: 0.22, eggplant: 0.22,
  plate: 0.26, riceBowl: 0.12, lantern: 0.3,
}

/**
 * 遠景の帯 (backdrop) の幅。片面をいっぱいに使い切る。
 * これより狭いと左右の外側に素の紙が残り、遠景がちぎれた短冊に見える。
 */
export const BACKDROP_WIDTH = 7.9

/** 紙面から浮かせる基準値。平置きの層はここから layer ぶん積み上げる */
const SURFACE = 0.014
const LAYER_STEP = 0.007
/** 縁からの安全余白。収納コンパイラの余白 0.2 より広く取る */
const EDGE_MARGIN = 0.12
const FOLD_MARGIN = 0.3

/**
 * 揺れる立ち板を紙面から浮かせる量。
 * 接地線で左右へ傾くと下角が紙をくぐるため、傾きぶんの高さを足す。
 */
function swingLift(motion, width) {
  if (!motion?.length) return 0
  let lift = 0
  for (const item of motion) {
    if (item.type === 'sway') lift += (width / 2) * Math.sin(Math.abs(item.amplitude) * Math.PI / 180)
    if (item.type === 'bob') lift += Math.abs(item.amplitude)
  }
  return Math.ceil(lift * 1000) / 1000
}

const faceX = (u) => -PAGE_WIDTH / 2 + u * PAGE_WIDTH
const faceZ = (v) => -PAGE_DEPTH / 2 + v * PAGE_DEPTH
/** 片面座標。左面は背表紙が +x 側にあるため u の向きが反転する */
const pageX = (page, u) => (page === 'left' ? -faceX(u) : faceX(u))

/**
 * WebPの実寸をヘッダから読む。
 *
 * 下書きSVGが宣言する width/height は「こういう寸法で描きたい」という素案でしかなく、
 * 実体のWebPは別の工程 (adopt-alt-asset / trim-assets) が作る。両方を寸法の出典に
 * すると必ずずれるので、部品の縦横比は実ファイルだけから引く。
 */
function webpSize(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('WebPではありません')
  }
  const kind = buffer.toString('ascii', 12, 16)
  if (kind === 'VP8X') {
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 }
  }
  if (kind === 'VP8 ') {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
  }
  if (kind === 'VP8L') {
    const bits = buffer.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  throw new Error(`未知のWebPチャンク ${kind}`)
}

/** 音声1本の上限。src/schema/assets.ts の AUDIO_BYTE_LIMIT と同じ値 */
const AUDIO_BYTE_LIMIT = 3 * 1024 * 1024
/** 拡張子から音声の形式。src/package/model.ts の EXT_TO_KIND と揃える */
const AUDIO_MIME = { mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav' }

export function defineWork(meta) {
  const webpId = (id) => id.replace(/\.svg$/i, '.webp')
  const normalizedMeta = {
    ...meta,
    cover: Object.fromEntries(Object.entries(meta.cover).map(([side, id]) => [side, webpId(id)])),
  }
  const assets = new Map()
  const spreads = []
  let projectAudio = null

  /**
   * 音声素材。3作品が同じ音を使うので、作品ごとのフォルダではなく
   * `assets/audio/` から読む。絵と違って寸法も透過の余白も持たないので、
   * 実体のバイト列と大きさだけを見る。
   */
  const sound = (file) => {
    if (assets.has(file)) return file
    const mime = AUDIO_MIME[file.split('.').pop()?.toLowerCase()]
    if (!mime) throw new Error(`${meta.id}: 音声 ${file} の形式が分かりません`)
    const content = readFileSync(new URL(`./assets/audio/${file}`, import.meta.url))
    if (content.byteLength > AUDIO_BYTE_LIMIT) {
      throw new Error(`${meta.id}: 音声 ${file} が上限 3MB を超えています (${(content.byteLength / 1024 / 1024).toFixed(1)}MB)`)
    }
    assets.set(file, {
      draft: null,
      content,
      meta: {
        id: file,
        name: file.replace(/\.[^.]+$/, ''),
        type: 'audio',
        mime,
        bytes: content.byteLength,
      },
    })
    return file
  }

  /** 作品に一つのBGM。冒頭からループする (docs/008 §7.1)。音量は編集UIの既定と揃える */
  const bgm = (file) => {
    projectAudio = { bgmAsset: sound(file), volume: 0.7, loop: true }
  }

  /**
   * ページをめくる音。見開きの保持区間の終わりがそのまま送りの始まりなので、
   * そこへ点を置く。見開きを全部組んでから呼ぶこと。
   *
   * **最後の見開きには置かない**。そこで起きるのはページ送りではなく本を閉じる動作で、
   * 紙が一枚めくれる「ぺらっ」は表紙が閉じる絵と噛み合わない。表表紙側にも音は無い
   * (効果音は見開きの保持区間の中にしか置けず、表紙を開く区間はその外にある)。
   */
  const pageTurns = (file) => {
    const assetId = sound(file)
    for (const item of spreads.slice(0, -1)) item.cue(assetId, [item.hold])
  }

  const art = (id, svg, options = {}) => {
    const outputId = webpId(id)
    const existing = assets.get(outputId)
    if (existing) {
      if (existing.draft !== svg) throw new Error(`${meta.id}: アセットID ${outputId} が別の内容で二重登録されています`)
      return outputId
    }
    if (!/width="(\d+)" height="(\d+)"/.test(svg)) {
      throw new Error(`${meta.id}: アセット ${id} に width/height がありません`)
    }
    const content = readFileSync(new URL(`./assets/${meta.id}/${outputId}`, import.meta.url))
    // 寸法は実体のWebPだけを出典にする。下書きの宣言は素案なので採らない
    const size = webpSize(content)
    assets.set(outputId, {
      draft: svg,
      content,
      meta: {
        id: outputId,
        name: outputId.replace(/\.webp$/, ''),
        type: 'image',
        mime: 'image/webp',
        width: size.width,
        height: size.height,
        bytes: content.byteLength,
        ...(options.opaque ? {} : { alphaBounds: options.alphaBounds ?? { x: 0, y: 0, width: 1, height: 1 } }),
      },
    })
    return outputId
  }

  const spread = (config) => {
    const built = createSpread({ ...config, index: spreads.length, workId: meta.id })
    spreads.push(built)
    return built
  }

  const toProject = () => {
    if (spreads.length !== 5) throw new Error(`${meta.id}: 見開きは5つ必要です (現在 ${spreads.length})`)
    return {
      id: meta.id,
      name: meta.title,
      book: {
        sequence: { coverOpenSeconds: meta.coverOpenSeconds ?? 1.8 },
        format: {
          pageAspect: PAGE_ASPECT,
          pageWidth: PAGE_WIDTH,
          coverThickness: 0.18,
          pageThickness: 0.015,
          gutter: 0.08,
          binding: 'left',
        },
        appearance: meta.appearance,
        camera: meta.camera,
        lights: meta.lights,
        frontCover: { frontAsset: normalizedMeta.cover.front, backAsset: normalizedMeta.cover.inside },
        spreads: spreads.map((item) => item.serialize()),
        backCover: {
          frontAsset: normalizedMeta.cover.inside,
          backAsset: normalizedMeta.cover.back ?? normalizedMeta.cover.front,
        },
      },
      assets: [...assets.values()].map((entry) => entry.meta),
      ...(projectAudio ? { audio: projectAudio } : {}),
      updatedAt: meta.updatedAt,
    }
  }

  /**
   * 素材の縦横比 (幅/高さ)。高さから幅を出すときに使う。
   * 実ファイルから引くので、余白を切っても定義を書き換えずに追従する。
   */
  const aspect = (assetId) => {
    const entry = assets.get(assetId)
    if (!entry) throw new Error(`${meta.id}: 未登録の素材 ${assetId} の縦横比を引こうとしています`)
    return entry.meta.width / entry.meta.height
  }

  /** 高さと素材から幅を決める。縦横比は実ファイルが持つ */
  const wide = (height, assetId) => Math.round(height * aspect(assetId) * 100) / 100

  return {
    meta: normalizedMeta,
    art,
    sound,
    bgm,
    pageTurns,
    aspect,
    wide,
    spread,
    toProject,
    files: () => new Map([...assets].map(([id, entry]) => [id, entry.content])),
  }
}

function createSpread({ workId, index, name, hold = 6, turn = 1.7, leftPage, rightPage }) {
  const scene = `spread-${index + 1}`
  const elements = []
  const tracks = []
  const fail = (message) => {
    throw new Error(`${workId} / ${name}: ${message}`)
  }

  const base = (id, { name: label, parent, position, rotation = [0, 0, 0], scale = [1, 1, 1], pivot = [0.5, 0.5], layer = 0, mechanism, preset, motion = [], fall = 'auto', stagger = 0 }) => ({
    id: `${scene}-${id}`,
    name: label,
    visible: true,
    opacity: 1,
    parent,
    baseTransform: { position, rotation, scale },
    pivot,
    layer,
    // 位相は既定値へ頼らず必ず書き出す。生JSONを読む検査でもNaNにならない
    motion: motion.map((item) => (item.type === 'spin' ? item : { phase: 0, ...item })),
    clock: 'visible-elapsed',
    sourcePreset: preset,
    stow: { mechanism, fallDirection: fall, stagger },
  })

  const add = (element) => {
    elements.push(element)
    return element.id
  }

  /** 紙へ糊付けした平置き。道、水面、影、図解の台紙 */
  const flat = (page, { id, name: label, asset, u, v, width, depth, layer = 0, motion }) => {
    const halfU = width / (2 * PAGE_WIDTH)
    const halfV = depth / (2 * PAGE_DEPTH)
    if (u - halfU < -0.001 || u + halfU > 1.001) fail(`${label} の幅が片面をはみ出します (u=${u}, width=${width})`)
    if (v - halfV < -0.001 || v + halfV > 1.001) fail(`${label} の奥行きが片面をはみ出します (v=${v}, depth=${depth})`)
    return add({
      ...base(id, {
        name: label, parent: { type: `${page}-page` }, layer,
        position: [pageX(page, u), SURFACE + layer * LAYER_STEP, faceZ(v)],
        rotation: [-90, 0, 0], pivot: [0.5, 0.5],
        mechanism: 'page-glue', preset: 'paper-stack', motion,
      }),
      type: 'image', asset, width, height: depth, billboard: false,
    })
  }

  /**
   * 接地線で立てた立ち板。奥行き v の線でヒンジし、指定方向へ倒れて畳まれる。
   * 高さは倒れる側の紙面が残っている範囲までしか許さない。
   */
  const stand = (page, { id, name: label, asset, u, v, width, height, layer = 1, backdrop = false, fall, stagger = 0, motion }) => {
    const halfU = width / (2 * PAGE_WIDTH)
    if (u - halfU < -0.001 || u + halfU > 1.001) fail(`${label} の幅が片面をはみ出します (u=${u}, width=${width})`)
    const backRoom = v * PAGE_DEPTH
    const frontRoom = (1 - v) * PAGE_DEPTH
    const chosen = fall ?? (height + FOLD_MARGIN <= backRoom ? 'back' : 'front')
    const room = chosen === 'back' ? backRoom : frontRoom
    if (height + FOLD_MARGIN > room) {
      fail(`${label} は高さ ${height} が ${chosen} 側の紙面 ${room.toFixed(2)} に収まりません`)
    }
    return add({
      ...base(id, {
        name: label, parent: { type: `${page}-page` }, layer,
        position: [pageX(page, u), 0.01 + swingLift(motion, width), faceZ(v)],
        pivot: [0.5, 0], mechanism: 'flap', fall: chosen, stagger, motion,
        preset: backdrop ? 'depth-layer' : 'bottom-upright',
      }),
      type: 'image', asset, width, height, billboard: false,
    })
  }

  /**
   * 背をまたぐ一枚パネル。折り目は必ず背表紙に一致するため、
   * 制作者は幅と高さと足元の奥行きだけを決める。
   */
  const arch = ({ id, name: label, asset, width, height, v, layer = 2, stagger = 0, motion }) => {
    if (width / 2 > PAGE_WIDTH - EDGE_MARGIN) fail(`${label} の片翼が片面の幅を越えます (width=${width})`)
    const z = faceZ(v)
    // 翼は糊しろの傾きぶん背側へ寄り、閉じ際は折り目が手前へ倒れる
    if (z - width * 0.089 < -PAGE_DEPTH / 2 + EDGE_MARGIN) fail(`${label} の翼が紙面の奥を越えます (v=${v}, width=${width})`)
    if (z + height * 0.985 > PAGE_DEPTH / 2) fail(`${label} は閉じたとき手前へはみ出します (v=${v}, height=${height})`)
    return add({
      ...base(id, {
        name: label, parent: { type: 'spread' }, layer,
        position: [0, 0, z], pivot: [0.5, 0],
        mechanism: 'v-fold', preset: 'spine-arch', stagger, motion,
      }),
      type: 'image', asset, width, height, billboard: false,
    })
  }

  /**
   * 透明支持片で浮かせた部品。見開き座標で置き、紙の輪郭の内側だけを動ける。
   * 紙面の奥へ寄せた部品は背後の紙が狭く、既定の自動判定が奥へ倒そうとして
   * 縮小を要求することがある。倒す向きが効く配置では fall を明示する。
   */
  const hover = ({ id, name: label, asset, x, y, z, width, height, layer = 6, billboard = false, motion, parent, fall }) => {
    const reach = billboard ? Math.hypot(width, height) / 2 : width / 2
    // 親部品へ取り付けた子は親の先端が原点なので、見開き座標の検査は通し検査へ委ねる
    if (!parent) {
      if (Math.abs(x) + reach > PAGE_WIDTH - EDGE_MARGIN) fail(`${label} が本の輪郭より外にあります (x=${x})`)
      if (Math.abs(z) + (billboard ? reach : 0) > PAGE_DEPTH / 2 - EDGE_MARGIN) fail(`${label} が紙面の奥行きより外にあります (z=${z})`)
      if (y - (billboard ? reach : height / 2) < 0) fail(`${label} の足元が紙面より下です (y=${y})`)
    }
    return add({
      ...base(id, {
        name: label, parent: parent ?? { type: 'spread' }, layer,
        position: [x, y, z], pivot: [0.5, 0.5],
        mechanism: 'strut', preset: 'floating-character', motion, fall,
      }),
      type: 'image', asset, width, height, billboard,
    })
  }

  /** 紙面へ寝かせた本文。読み手はページを覗き込む向きで読む */
  const caption = (page, { id, text, u, v, size = 0.42, color = '#3a3128', align = 'center', layer = 9 }) => {
    const lines = text.split('\n')
    const em = Math.max(...lines.map((line) => [...line].reduce((sum, ch) => sum + (/[ -~]/.test(ch) ? 0.55 : 1), 0)))
    const height = size * lines.length
    const width = size * (0.8 * em + 0.16)
    const halfU = width / (2 * PAGE_WIDTH)
    const halfV = height / (2 * PAGE_DEPTH)
    if (u - halfU < -0.001 || u + halfU > 1.001) fail(`本文「${lines[0]}」が片面の幅をはみ出します`)
    if (v - halfV < -0.001 || v + halfV > 1.001) fail(`本文「${lines[0]}」が片面の奥行きをはみ出します`)
    return add({
      ...base(id, {
        name: lines[0], parent: { type: `${page}-page` }, layer,
        position: [pageX(page, u), SURFACE + layer * LAYER_STEP, faceZ(v)],
        rotation: [-90, 0, 0], pivot: [0.5, 0.5],
        mechanism: 'page-glue', preset: 'page-text',
      }),
      type: 'text', text, width, height, fontSize: size, color, align,
    })
  }

  /**
   * 立て板の面へ載せる見出し。板と同じ接地線に立ち、正面から読める。
   *
   * 見出しの入る枠を立てておきながら中身を空のままにすると、意味を運ばない
   * 白地の看板が並ぶ。枠を立てるなら必ずこれで文字を入れるか、枠ごと落とす。
   * 文字の箱は板と同じ高さにして、板の中央へ字が来るようにする。
   */
  const signText = (page, { id, text, u, v, size, board, color = '#4a3b2c', align = 'center', layer = 10, fall = 'back', stagger = 0 }) => {
    // 文字は箱いっぱいへ引き伸ばして描かれるので、箱は必ず文字から導く。
    // 板の高さ board を渡すと、その面の中央へ字が来る高さへ持ち上げる
    const em = [...text].reduce((sum, ch) => sum + (/[ -~]/.test(ch) ? 0.55 : 1), 0)
    const height = size
    const width = size * (0.8 * em + 0.16)
    const lift = Math.max(0.01, board / 2 - height / 2)
    const halfU = width / (2 * PAGE_WIDTH)
    if (u - halfU < -0.001 || u + halfU > 1.001) fail(`見出し「${text}」の幅 ${width.toFixed(2)} が片面をはみ出します`)
    const room = fall === 'back' ? v * PAGE_DEPTH : (1 - v) * PAGE_DEPTH
    if (lift + height + FOLD_MARGIN > room) fail(`見出し「${text}」が ${fall} 側の紙面 ${room.toFixed(2)} に収まりません`)
    return add({
      ...base(id, {
        name: text, parent: { type: `${page}-page` }, layer,
        position: [pageX(page, u), lift, faceZ(v)],
        pivot: [0.5, 0], mechanism: 'flap', fall, stagger,
        preset: 'bottom-upright',
      }),
      type: 'text', text, width, height, fontSize: size, color, align,
    })
  }

  /** 発光粒子。部品ではないので空中予算には数えない */
  const sparkle = ({ id, name: label, x, y, z, color, size = 1.4, layer = 12 }) => add({
    ...base(id, {
      name: label, parent: { type: 'spread' }, layer,
      position: [x, y, z], mechanism: 'strut', preset: 'light-particles',
    }),
    type: 'effect', effect: 'sparkles', color, size,
  })

  /** 子部品をぶら下げるための無地の枠。回転させると子ごと回る */
  const pivotGroup = ({ id, name: label, x, y, z, motion, rotation, mechanism = 'strut' }) => add({
    ...base(id, {
      name: label, parent: { type: 'spread' }, layer: 4,
      position: [x, y, z], rotation: rotation ?? [0, 0, 0], mechanism, preset: 'custom', motion,
    }),
    type: 'group',
  })

  const key = (id, time, value, ease) => ({ id, time, value, ease })
  const track = (elementId, property, points, ease = 'easeInOut') => {
    const discrete = property === 'visible' || property === 'asset'
    const id = `${elementId}-${property.replaceAll('.', '-')}`
    if (tracks.some((item) => item.id === id)) fail(`${id} のトラックが重複しています`)
    tracks.push({
      id,
      target: { type: 'element', elementId },
      property,
      keys: points.map(([time, value], order) => {
        if (time < 0 || time > hold) fail(`${id} のキー時刻 ${time} が保持時間 ${hold} の外です`)
        return key(`${id}-${order}`, time, value, discrete ? 'hold' : ease)
      }),
    })
    return id
  }

  /**
   * 効果音の点 (docs/008 §6.1)。時刻だけを持ち、値は場所取りなので true で固定する。
   * 保持区間の外へ置いた点はその端で鳴るが、意図せず端へ寄るのは事故なので弾く。
   */
  const cue = (assetId, times) => {
    const id = `${scene}-cue-${assetId.replace(/[^A-Za-z0-9]+/g, '-')}`
    if (tracks.some((item) => item.id === id)) fail(`${id} のトラックが重複しています`)
    tracks.push({
      id,
      target: { type: 'sound', assetId },
      property: 'cue',
      keys: times.map((time, order) => {
        if (time < 0 || time > hold) fail(`${id} のキー時刻 ${time} が保持時間 ${hold} の外です`)
        return key(`${id}-${order}`, time, true, 'hold')
      }),
    })
    return id
  }

  const camera = (points) => {
    for (const property of ['position', 'target', 'fov']) {
      const keys = points.filter((point) => point[property] !== undefined)
      if (!keys.length) continue
      tracks.push({
        id: `${scene}-camera-${property}`,
        target: { type: 'camera' },
        property,
        keys: keys.map((point, order) => key(`${scene}-camera-${property}-${order}`, point.time, point[property], 'easeInOut')),
      })
    }
  }

  const environment = (points) => {
    for (const property of ['background', 'ambient.color', 'ambient.intensity', 'directional.color', 'directional.intensity']) {
      const keys = points.filter((point) => point[property] !== undefined)
      if (!keys.length) continue
      tracks.push({
        id: `${scene}-env-${property.replaceAll('.', '-')}`,
        target: { type: 'environment' },
        property,
        keys: keys.map((point, order) => key(`${scene}-env-${property}-${order}`, point.time, point[property], 'easeInOut')),
      })
    }
  }

  const serialize = () => ({
    id: scene,
    name,
    leftPage: { backgroundAsset: leftPage },
    rightPage: { backgroundAsset: rightPage },
    elements,
    sequence: { holdSeconds: hold, turnSeconds: turn },
    timeline: { tracks },
  })

  return { scene, hold, flat, stand, arch, hover, caption, signText, sparkle, pivotGroup, track, cue, camera, environment, serialize }
}

// ---------------------------------------------------------------------------
// 配置寸法と透過範囲を宣言するSVG下書き。
// 公開サンプルへは同名の生成済みWebPを defineWork() が読み込んで出力する。
// ---------------------------------------------------------------------------

export const svg = (width, height, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`

export const rect = (x, y, w, h, fill, extra = '') => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}"${extra}/>`
export const circle = (cx, cy, r, fill, extra = '') => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"${extra}/>`
export const ellipse = (cx, cy, rx, ry, fill, extra = '') => `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}"${extra}/>`
export const poly = (points, fill, extra = '') => `<polygon points="${points.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="${fill}"${extra}/>`
export const path = (d, fill, extra = '') => `<path d="${d}" fill="${fill}"${extra}/>`
export const group = (...body) => body.filter(Boolean).join('')

const n = (value) => Math.round(value * 100) / 100

/** 紙面背景。長辺2048px以下、片面の縦横比 (1.25:1) に一致させる */
export const PAGE_ART = { width: 1250, height: 1000 }

/** 部品の作図解像度。1024pxを超えない範囲で世界寸法に比例させる */
export function artSize(worldWidth, worldHeight) {
  const scale = Math.min(190, 1024 / Math.max(worldWidth, worldHeight))
  return { width: Math.round(worldWidth * scale), height: Math.round(worldHeight * scale) }
}
