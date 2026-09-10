import { Color, Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { readFileSync } from 'node:fs'
import { CONNECTED_LAYOUTS } from './connected-layouts.mjs'
import { placeBehindScene } from './rear-supports.mjs'
const SHAPES = JSON.parse(readFileSync(new URL('./paper-shapes.json', import.meta.url), 'utf8'))

const radians = Math.PI / 180, round = (n) => Math.round(n * 1e7) / 1e7
const worldPosition = (element) => {
  const p = [...element.baseTransform.position]
  if (element.parent.type !== 'element') p[0] += element.parent.type === 'left-page' ? -4 : 4
  return p
}
const sizeOf = (e) => [e.width * e.baseTransform.scale[0], e.height * e.baseTransform.scale[1]]
const animated = (e, tracks) => e.motion.length || e.type === 'particle' || e.parent.type === 'element'
  || tracks.some((t) => /^(position|rotation|scale|visual\.(width|height))/.test(t.property))
const identity = () => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] })
const windowShapes = (work) => Object.fromEntries(['panel', 'panel-b'].map((face) => {
  const start = face === 'panel' ? .5 : 0
  return [face, { outer: [[0, 0], [1, 0], [1, 1], [0, 1]], holes: SHAPES[work]['window-frame.webp'].holes
    .filter((ring) => ring.every(([u, v]) => u > start + .004 && u < start + .496 && v > .015 && v < .985))
    .map((ring) => ring.map(([u, v]) => [(u - start) * 2, v])) }]
}))
async function embedPart(project, api, values) {
  const definition = api.partDefinitionSchema.parse({ format: 'tobidas-part', schemaVersion: 2, revision: 1, ...values })
  api.syncDefinitionRequirements(definition)
  const used = new Set()
  const walk = (value) => { if (!value || typeof value !== 'object') return
    for (const [key, v] of Object.entries(value)) {
      if (['image', 'backImage'].includes(key) && typeof v === 'string') used.add(v)
      else walk(v)
    }
    if (value.property === 'visual.image') value.keys.forEach((key) => used.add(key.value))
  }
  walk(definition)
  definition.assets = await Promise.all([...used].map(async (id) => {
    const asset = project.assets.find((item) => item.id === id)
    if (!asset) throw new Error(`部品素材がありません: ${id}`)
    const { data: _data, ...meta } = asset
    return { ...meta, hash: await api.contentHash(await api.assetBytes(asset)) }
  }))
  const hash = await api.definitionHash(definition)
  project.partDefinitions[hash] = definition
  return { custom: hash }
}

/** 旧配置は全開時の設計資料として読む。途中姿勢は本体の接続評価器だけが作る。 */
export async function remakeConnected(source, api) {
  const project = structuredClone(source), config = CONNECTED_LAYOUTS[source.id], entries = []
  if (!config) throw new Error(`接続設計がありません: ${source.id}`)
  const checkFields = (value, fields, name) => {
    for (const key of Object.keys(value)) if (!fields.includes(key)) throw new Error(`未対応の接続設計項目: ${name}/${key}`)
  }
  checkFields(config, ['background', 'backgroundSize', 'backgroundOffset', 'scale', 'paper', 'fiction'], source.id)
  const sourceIds = new Set(source.book.spreads.flatMap((spread) => spread.elements.map((element) => element.id)))
  for (const kind of ['paper', 'fiction']) for (const [id, design] of Object.entries(config[kind] ?? {})) {
    if (!sourceIds.has(id)) throw new Error(`接続設計の対象がありません: ${source.id}/${id}`)
    checkFields(design, kind === 'paper' ? ['x', 'z', 'scale', 'backdrop', 'parent', 'supportCeiling'] : ['x', 'scale', 'travel', 'parent'], id)
    for (const key of ['x', 'z', 'scale']) if (design[key] !== undefined && (!Number.isFinite(design[key]) || key === 'scale' && design[key] <= 0)) throw new Error(`接続設計の寸法が不正です: ${id}/${key}`)
    if (design.travel && (design.travel.length !== 2 || design.travel.some((n) => !Number.isFinite(n)))) throw new Error(`移動範囲が不正です: ${id}`)
  }
  project.id = `022-${source.id.replaceAll('_', '-')}`
  project.partDefinitions = {}
  // 無照明の絵柄を前提にした旧光源を、拡散反射の紙を読むための明るい補助光へ移す。
  const fill = (n) => 2.35 + n * .4
  const neutral = (color) => '#' + new Color(color).lerp(new Color('#ffffff'), .8).getHexString()
  project.book.lights.ambient = { color: neutral(source.book.lights.ambient.color), intensity: fill(source.book.lights.ambient.intensity) }
  const part = (id, name, builtin, nodeId, portId, parameters, materials = {}) => {
    const element = api.createStageElement('part')
    // 奥へ向かう支持紙は床になじむ紙色にする。隠したり透明にせず実際に描画する。
    const supportColor = source.id === 'morning_walk' ? id.startsWith('spread-5-') ? '#a88b61' : '#c7bca5'
      : source.id === 'forest_lantern' ? id.startsWith('spread-4-') ? '#8d693a' : '#293f30' : source.id === 'crooked_castle' ? '#575649' : '#d4c7ad'
    const backingColor = source.id === 'crooked_castle' ? '#454941' : source.id === 'forest_lantern' ? '#354b33' : '#f0e8d8'
    const artwork = Object.fromEntries(Object.entries(materials).map(([slot, material]) => [slot,
      material.image && !material.color ? { color: backingColor, ...material } : material]))
    return { ...element, id, name, baseTransform: identity(), part: { definition: { builtin, version: builtin === 'backdrop' ? 2 : 1 },
      mount: { type: 'output', nodeId, portId }, parameters, materials: { ...builtin === 'upright' ? { support: { color: supportColor } } : {}, ...artwork } } }
  }
  const screen = (id, name, width, height, z, image) => part(id, name, 'backdrop', '$book', 'gutter',
    { width, height, offset: z, splayAngle: 170 }, image ? { '*': { image } } : { '*': { color: source.book.appearance.paperColor } })
  for (const [index, spread] of project.book.spreads.entries()) {
    const originals = source.book.spreads[index].elements, oldTracks = source.book.spreads[index].timeline.tracks
    const byId = new Map(originals.map((e) => [e.id, e])), mappings = new Map(), tracks = [], elements = []
    const plans = new Map(), fictionPlans = new Map(), suffix = (e) => e.id.replace(`${spread.id}-`, '')
    const remember = (e, ids, kind, reason, extra = {}) => {
      const row = { spreadId: spread.id, oldId: e.id, oldName: e.name, newIds: ids, kind, reason,
        before: { transform: e.baseTransform, width: e.width, height: e.height, parent: e.parent }, ...extra }
      entries.push(row); mappings.set(e.id, row)
    }
    const bgId = config.background[index] && `${spread.id}-${config.background[index]}`, bg = byId.get(bgId)
    const background = bg ? screen(bg.id, bg.name, ...config.backgroundSize[index], Array.isArray(config.backgroundOffset) ? config.backgroundOffset[index] : config.backgroundOffset, bg.image) : undefined
    if (background) {
      if (suffix(bg) === 'window') background.part.shapes = windowShapes(source.id)
      if (source.id === 'four_seasons' || source.id === 'morning_walk' && index === 4) {
        const classroom = source.id === 'morning_walk'
        const frame = { id: 'frame', name: '窓枠', ...background.part, mount: { type: 'input' } }
        const view = { id: 'view', name: '窓の外の紙', ...screen('', '', classroom ? 14.4 : 7.46, classroom ? 3.25 : 2.6, classroom ? -2.55 : -2.1).part, mount: { type: 'input' } }
        if (classroom) view.materials = { '*': { color: '#c8e2ed' } }
        const outputs = Object.fromEntries(['panel', 'panel-b', 'ground-backdrop', 'ground-backdrop-b'].map((portId) => [portId, { type: 'output', nodeId: 'frame', portId }]))
        outputs['view-left'] = { type: 'output', nodeId: 'view', portId: 'panel-b' }; outputs['view-right'] = { type: 'output', nodeId: 'view', portId: 'panel' }
        background.part = { definition: await embedPart(project, api, { id: classroom ? '022-classroom-window' : '022-seasonal-room', name: classroom ? '教室の窓' : '季節の窓の部屋',
          input: { kind: 'fold-pair', maxOpeningAngleDeg: 180 }, nodes: [view, frame], outputs }), mount: background.part.mount, parameters: {}, materials: {} }
      }
      elements.push(background); plans.set(bg.id, { element: background, scale: config.backgroundSize[index][1] / sizeOf(bg)[1], spanning: true })
      remember(bg, [background.id], 'paper', '実見開きの二面に接続した屏風。全開時の寸法を収納範囲へ設計し直す。', { after: background.part })
    }
    if (source.id === 'crooked_castle') {
      const forest = screen('castle-forest', '背後の枯れ森', 14.4, 1.55, -2.5)
      forest.part.materials = { '*': { color: '#75805d' } }
      elements.push(forest)
      for (const old of originals.filter((e) => e.id.startsWith('forest-'))) {
        const left = old.id.includes('left'), inner = old.id.endsWith('-in')
        const [width, height] = sizeOf(old).map((n) => n * config.scale)
        plans.set(old.id, { element: forest, scale: config.scale, merged: true, portId: left ? 'panel-b' : 'panel',
          artwork: { width, height, baseTransform: { ...identity(), position: [left ? inner ? 1.6 : -2.1 : inner ? -1.6 : 2.1, 0, 0] } } })
      }
    }
    const castleZ = (old) => /^back-/.test(old.id) ? -1.7 : /^mid-|central/.test(old.id) ? -.6 : .6
    const plannedZ = (old) => config.paper?.[old.id]?.z ?? (source.id === 'crooked_castle' && animated(old, oldTracks.filter((t) => t.target.elementId === old.id)) ? castleZ(old) : Math.min(1.65, Math.max(-1.4, worldPosition(old)[2] * .68)))
    // 同じ家の画像差分は一枚に印刷する。面のIDは暗い家の旧IDを基に固定する。
    const merged = new Map()
    for (const old of [...originals].sort((a, b) => plannedZ(a) - plannedZ(b))) {
      if (old.id === bgId) continue
      if (source.id === 'crooked_castle' && old.id.startsWith('forest-')) continue
      if (source.id === 'morning_walk' && index === 4 && /^(mountain|town|cherry)-(left|right)$/.test(suffix(old))) {
        const left = suffix(old).endsWith('left'), mountain = suffix(old).startsWith('mountain'), town = suffix(old).startsWith('town')
        plans.set(old.id, { element: background, scale: 1, merged: true, portId: left ? 'view-left' : 'view-right',
          artwork: { width: mountain ? 7.2 : town ? 6.6 : 1.2, height: mountain ? 2.8 : town ? 1.7 : 1.3,
            baseTransform: { ...identity(), position: [mountain || town ? 0 : left ? -2.4 : 2.4, mountain ? .45 : .1, 0] } } })
        continue
      }
      if ((source.id === 'four_seasons' || source.id === 'morning_walk' && index === 4) && /^(view-[lr]|layer-(left|right)-\d+)$/.test(suffix(old))) {
        plans.set(old.id, { element: background, scale: 1, merged: true, portId: /view-l|layer-left/.test(suffix(old)) ? 'view-left' : 'view-right' })
        continue
      }
      const ownTracks = oldTracks.filter((t) => t.target.type === 'element' && t.target.elementId === old.id)
      const flat = Math.abs(Math.abs(old.baseTransform.rotation[0]) - 90) < .001
      if (flat) continue
      if (animated(old, ownTracks)) {
        if (old.parent.type !== 'element' && !/^shutter-/.test(suffix(old)) && !(source.id === 'four_seasons' && /^particle-/.test(suffix(old)))) {
          const p = worldPosition(old), design = config.fiction?.[old.id] ?? {}
          p[0] = design.x ?? p[0]
          const z = source.id === 'crooked_castle' ? castleZ(old) - Math.abs(p[0]) * Math.tan(5 * radians)
            : /^curtain/.test(suffix(old)) ? .1 : Math.max(-1.4, Math.min(1.7, p[2] * .68))
          if (source.id === 'crooked_castle' && old.type === 'visual') {
            // 大きく動く城の絵の足元だけを実紙にする。幅広い横帯で列を一括支持しない。
            const width = Math.min(1.8, Math.max(.3, sizeOf(old)[0] * .6))
            let anchor = part(`${old.id}-anchor`, `${old.name}の接着紙`, 'upright', '$book', 'gutter', { width, height: .2 }, { '*': { color: '#888472' } })
            anchor = placeBehindScene(project, { ...spread, elements }, api, anchor, { x: p[0], z })
            elements.push(anchor)
            fictionPlans.set(old.id, { position: [p[0], p[1], z], ...design, parent: anchor.id })
          } else fictionPlans.set(old.id, { position: [p[0], p[1], z], ...design })
        }
        continue
      }
      const key = suffix(old).replace('house-lit-', 'house-dark-').replace(/^layer-(left|right)-\d+$/, 'view-$1')
      if (merged.has(key)) { plans.set(old.id, { ...plans.get(merged.get(key)), merged: true }); continue }
      const design = config.paper?.[old.id] ?? {}, factor = design.scale ?? config.scale
      const [ow, oh] = sizeOf(old), width = ow * factor, height = oh * factor
      const p = worldPosition(old), x = design.x ?? p[0]
      const z = (design.z ?? Math.min(1.65, Math.max(-1.4, p[2] * .68))) - (source.id === 'crooked_castle' ? Math.abs(x) * Math.tan(5 * radians) : 0)
      let el
      if (design.backdrop || (Math.abs(p[0]) < .05 && width > 5.5)) {
        el = screen(old.id, old.name, width, height, z, old.image)
      } else {
        el = part(old.id, old.name, 'upright', '$book', 'gutter', { width, height },
          old.image ? { panel: { image: old.image } } : { panel: { color: old.backgroundColor.slice(0, 7), text: old.text, textColor: old.foregroundColor } })
        el = placeBehindScene(project, { ...spread, elements }, api, el, { x, z, parentId: design.parent, supportCeiling: design.supportCeiling, contour: old.image && SHAPES[source.id][old.image] })
      }
      const hasLayers = /house-dark-|^layer-/.test(key)
      if (hasLayers) { el.id = `${old.id}-paper`; el.part.materials = { panel: { color: '#ead8b5' } } }
      elements.push(el); plans.set(old.id, { element: el, scale: factor, merged: hasLayers }); merged.set(key, old.id)
      if (!hasLayers) remember(old, [el.id], 'paper', '地面と背後の実部品を固定長の支持紙でつなぐ。支持は絵の裏から奥へ伸ばす。', { after: el.part })
    }
    spread.elements = elements
    let paper = api.evaluateBookParts(project, spread, Math.PI, 0)
    const surfaceFor = (plan, worldX = 0) => {
      const portId = plan.portId ?? (plan.spanning || plan.element.part.definition.builtin === 'backdrop' ? worldX < 0 ? 'panel-b' : 'panel' : 'panel')
      return { face: paper.nodes[plan.element.id].ports[portId].face, reference: { nodeId: plan.element.id, portId } }
    }
    const append = (old, attachment, transform, classification, reason, remap = (t) => t, overrides = {}) => {
      const content = api.connectedContentSchema.parse({ ...old, ...overrides, attachment,
        billboard: false,
        presentation: classification === 'decal' ? { kind: 'decal' } : { kind: 'fiction', closing: 'shrink-to-anchor' }, baseTransform: transform,
        ...(classification === 'decal' ? { motion: [] } : {}) })
      elements.push(api.contentAsStage(content))
      const own = oldTracks.filter((t) => t.target.type === 'element' && t.target.elementId === old.id).map((t) => remap(structuredClone(t))).flat()
      tracks.push(...own)
      remember(old, [content.id], classification, reason + (old.billboard ? ' カメラ追従の絵は接続面に向きをそろえ、開閉中に周囲の紙を横切らないようにする。' : ''), { after: { attachment, transform }, trackIds: own.map((t) => t.id) })
      return content
    }
    for (const old of originals) {
      if (mappings.has(old.id)) continue
      const p = worldPosition(old), plan = plans.get(old.id), ownTracks = oldTracks.filter((t) => t.target.type === 'element' && t.target.elementId === old.id)
      if (plan?.merged) {
        const { face, reference } = surfaceFor(plan, p[0])
        append(old, { type: 'surface', surface: reference, point: [face.width / 2, 0], side: 'front' }, identity(), 'decal',
          '同じ家・景色の紙へ印刷を重ね、元の明暗・季節のタイミングを維持する。', (t) => t,
          { width: face.width, height: face.height, pivot: [.5, 0], baseTransform: identity(), layer: old.layer + 1, ...plan.artwork })
        mappings.get(old.id).newIds.push(plan.element.id)
        continue
      }
      if (old.parent.type === 'element') {
        const parent = plans.get(old.parent.elementId)
        if (!parent) throw new Error(`支持元の移行がありません: ${old.id} -> ${old.parent.elementId}`)
        const { face, reference } = surfaceFor(parent), ratio = parent.scale
        const wanted = [face.width / 2 + old.baseTransform.position[0] * ratio, old.baseTransform.position[1] * ratio]
        const candidates = [wanted, ...Array.from({ length: 100 }, (_, i) => [face.width * (i + .5) / 100, wanted[1]])]
          .filter((point) => api.faceContains(face, api.pointOnFace(face, ...point)))
          .sort((a, b) => Math.abs(a[0] - wanted[0]) - Math.abs(b[0] - wanted[0]))
        if (!candidates.length) throw new Error(`取り付け高さに実紙がありません: ${old.id}`)
        const anchor = candidates[0]
        append(old, { type: 'surface', surface: reference, point: anchor, side: 'front' },
          { position: [wanted[0] - anchor[0], 0, Math.max(.025, old.baseTransform.position[2] * ratio)], rotation: [...old.baseTransform.rotation], scale: old.baseTransform.scale.map((n) => n * ratio) },
          'fiction', '紙の親面に取り付け、保持中の回転を維持する。開閉時は角度を戻さず接続点へ縮小する。')
        continue
      }
      if (source.id === 'morning_walk' && /^shutter-/.test(suffix(old))) {
        const shop = plans.get(old.id.replace('shutter-', 'shop-')), { face, reference } = surfaceFor(shop), ratio = shop.scale
        const transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: old.baseTransform.scale.map((n) => n * ratio) }
        append(old, { type: 'surface', surface: reference, point: [face.width / 2, .01], side: 'front' }, transform,
          'fiction', 'シャッターの移動と縮みを、同じ店舗の紙面を基準に再配置する。', (track) => {
            if (track.property === 'position.y') track.keys.forEach((key) => { key.value = (key.value - old.baseTransform.position[1]) * ratio })
            if (track.property.startsWith('scale.')) track.keys.forEach((key) => { key.value *= ratio })
            return track
          })
        continue
      }
      if (source.id === 'four_seasons' && /^particle-/.test(suffix(old))) {
        const left = old.parent.type === 'left-page', portId = left ? 'view-left' : 'view-right'
        const transform = { position: [0, p[1] - 1.3, 0], rotation: [0, 0, 0], scale: old.baseTransform.scale.map((n) => n * .65) }
        append(old, { type: 'surface', surface: { nodeId: background.id, portId }, point: [1.865, 1.3], side: 'front' }, transform,
          'fiction', '窓外の実紙面に花びら・葉・雪を置き、実際の窓の穴を通して見せる。落下と画像切替の時刻を保持。', (track) => {
            if (track.property === 'position.x') track.keys.forEach((key) => { key.value = (key.value - old.baseTransform.position[0]) * .45 })
            if (track.property === 'position.y') track.keys.forEach((key) => { key.value -= 1.3 })
            return track
          })
        continue
      }
      const fictional = fictionPlans.get(old.id)
      if (fictional) {
        p.splice(0, 3, ...fictional.position)
        const candidates = []
        for (const [nodeId, node] of Object.entries(paper.nodes)) for (const [portId, port] of Object.entries(node.ports)) {
          if (fictional.parent && nodeId !== fictional.parent || portId.startsWith('view-')) continue
          if (port.kind !== 'surface' || port.face.support || port.face.v.y < .9 || port.face.u.clone().cross(port.face.v).z < .8) continue
          const face = port.face
          for (const h of [p[1], face.height * .7, .3, .1]) {
            const point = [Math.max(.04, Math.min(face.width - .04, new Vector3(...p).sub(face.origin).dot(face.u))), Math.min(h, face.height * .8)]
            if (!api.faceContains(face, api.pointOnFace(face, ...point))) continue
            const at = api.pointOnFace(face, ...point)
            candidates.push({ face, point, reference: { nodeId, portId }, at, score: Math.abs(at.x - p[0]) * 4 + Math.abs(at.z - p[2]) + Math.abs(at.y - p[1]) * .1 })
          }
        }
        candidates.sort((a, b) => a.score - b.score)
        if (!candidates.length) throw new Error(`演出の背後に支持元の紙がありません: ${old.id}`)
        const host = candidates[0]
        const delta = new Vector3(...p).sub(host.at)
        const transform = { position: [delta.dot(host.face.u), p[1] - host.at.y, 0],
          rotation: [...old.baseTransform.rotation], scale: old.baseTransform.scale.map((n) => n * (fictional.scale ?? 1)) }
        if (old.type === 'particle') {
          const maxHeight = Math.max(old.height, ...ownTracks.filter((t) => t.property === 'visual.height').flatMap((t) => t.keys.map((key) => key.value)))
          transform.position[1] = Math.max(transform.position[1], maxHeight * old.pivot[1] + old.particles.size / 2 + old.particles.drift + .03 - host.at.y)
        }
        append(old, { type: 'surface', surface: host.reference, point: host.point, side: 'front' }, transform, 'fiction',
          '近くの実部品を基準に演出する。専用の接続帯を設けず、同じ親の開閉へ追従して収納する。', (track) => {
            if (track.property.startsWith('position.')) {
              const axis = 'xyz'.indexOf(track.property.at(-1)), nextAxis = axis === 2 ? 0 : axis
              track.property = `position.${'xyz'[nextAxis]}`
              const first = track.keys[0]?.value, last = track.keys.at(-1)?.value
              track.keys.forEach((key) => { key.value = fictional.travel && nextAxis === 0 && first !== last
                ? fictional.travel[0] + (key.value - first) / (last - first) * (fictional.travel[1] - fictional.travel[0])
                : transform.position[nextAxis] + (key.value - old.baseTransform.position[axis]) })
            }
            return track
          })
        continue
      }
      // ページへ固定する印刷と演出は同じ材料座標を使う。旧ページ座標の軸を正確に写す。
      const left = old.parent.type === 'left-page', portId = left ? 'left-page' : 'right-page'
      const face = api.pagePorts(8, 6.4, Math.PI, 0)[portId].face, flat = Math.abs(Math.abs(old.baseTransform.rotation[0]) - 90) < .001
      const anchor = [Math.max(.05, Math.min(6.35, p[2] + 3.2)), Math.max(.05, Math.min(7.95, Math.abs(p[0])))]
      const attachment = { type: 'surface', surface: { nodeId: '$book', portId }, point: anchor, side: left ? 'back' : 'front' }
      const frame = api.contentSurfaceFrame(face, anchor, attachment.side), inverse = frame.clone().invert()
      const matrix = new Matrix4().compose(new Vector3(...p), new Quaternion().setFromEuler(new Euler(...old.baseTransform.rotation.map((n) => n * radians))), new Vector3(...old.baseTransform.scale))
      const position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3()
      inverse.clone().multiply(matrix).decompose(position, quaternion, scale)
      const rotation = new Euler().setFromQuaternion(quaternion)
      const transform = { position: position.toArray().map(round), rotation: [rotation.x, rotation.y, rotation.z].map((n) => round(n / radians)), scale: scale.toArray().map((n) => n * (fictional?.scale ?? 1)) }
      if (flat) { transform.position[2] = 0; transform.rotation[0] = transform.rotation[1] = 0 }
      const remap = (track) => {
        if (!track.property.startsWith('position.')) return track
        const oldAxis = 'xyz'.indexOf(track.property.at(-1)), axis = new Vector3().setComponent(oldAxis, 1).transformDirection(inverse)
        const index = [Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z)].indexOf(1)
        const newAxis = index < 0 ? [Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z)].indexOf(Math.max(Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z))) : index
        track.property = `position.${'xyz'[newAxis]}`
        track.keys = track.keys.map((key) => ({ ...key, value: round(transform.position[newAxis] + (key.value - old.baseTransform.position[oldAxis]) * axis.getComponent(newAxis)) }))
        return track
      }
      append(old, attachment, transform, flat ? 'decal' : 'fiction', flat ? '実ページへの印刷。紙面内の輪郭で切り抜く。' : '原作の移動・揺れ・拡縮をページ上の基準点に取り付けた演出として維持する。', remap,
        { motion: old.motion.map((motion) => motion.type === 'bob' ? { ...motion, axis: 'z' } : motion) })
    }
    // 紙の可視性だけを動かす既存トラックと、環境・カメラ・音はそのまま引き継ぐ。
    tracks.push(...oldTracks.filter((t) => t.target.type !== 'element' || mappings.get(t.target.elementId)?.kind === 'paper'
      && ['opacity', 'visible'].includes(t.property)).map((t) => structuredClone(t)))
    spread.timeline.tracks = tracks
    for (const track of tracks) if (track.target.type === 'environment') {
      if (track.property === 'ambient.intensity') track.keys.forEach((key) => { key.value = fill(key.value) })
      if (track.property === 'ambient.color') track.keys.forEach((key) => { key.value = neutral(key.value) })
    }
    if (source.id === 'forest_lantern' && index === 2) {
      const tower = elements.find((e) => e.id === `${spread.id}-windmill`), rotor = elements.find((e) => e.id === `${spread.id}-windmill-rotor`)
      const content = api.connectedContentSchema.parse({ ...rotor, id: 'rotor', attachment: { ...rotor.attachment, surface: { nodeId: 'tower', portId: 'panel' } } })
      const internalTracks = tracks.filter((t) => t.target.type === 'element' && t.target.elementId === rotor.id).map((t) => ({ ...t, target: { type: 'element', elementId: 'rotor' } }))
      const outputs = Object.fromEntries(['panel', 'ground', 'ground-panel'].map((portId) => [portId, { type: 'output', nodeId: 'tower', portId }]))
      const reference = await embedPart(project, api, { id: '022-paper-windmill', name: '回る羽根付き風車', input: { kind: 'fold-pair', maxOpeningAngleDeg: 90 },
        nodes: [{ id: 'tower', name: '紙の塔と支持', ...tower.part, mount: { type: 'input' } }], outputs, contents: [{ element: content, tracks: internalTracks }] })
      tower.part = { definition: reference, mount: tower.part.mount, parameters: {}, materials: {} }
      spread.elements = elements.filter((e) => e.id !== rotor.id)
      spread.timeline.tracks = tracks.filter((t) => t.target.type !== 'element' || t.target.elementId !== rotor.id)
      mappings.get(rotor.id).newIds = [tower.id + '/content/rotor']; mappings.get(rotor.id).reason += ' 塔と羽根を一つの共有カスタム部品へ同梱。'
    }
    if (source.id === 'four_seasons' && index === 4) {
      const zoom = oldTracks.find((t) => t.target.type === 'element' && t.target.elementId === bgId && t.property === 'scale')
      if (zoom) {
        const camera = spread.timeline.tracks.find((t) => t.target.type === 'camera' && t.property === 'fov')
        const times = [...new Set([...zoom.keys.map((key) => key.time), ...camera?.keys.map((key) => key.time) ?? [], ...Array.from({ length: 33 }, (_, i) => spread.sequence.holdSeconds * i / 32)])].sort((a, b) => a - b)
        const keys = times.map((time, i) => ({ id: `${zoom.id}-${i}`, time, value: (camera ? api.evaluateTimelineTrack(camera, time) : source.book.camera.fov) / api.evaluateTimelineTrack(zoom, time), ease: 'linear' }))
        if (camera) camera.keys = keys
        else spread.timeline.tracks.push({ id: zoom.id, target: { type: 'camera' }, property: 'fov', keys })
        mappings.get(bgId).reason += ' 最後の2%拡大は紙を伸ばさず、同時刻の寄りカメラへ置換。' }
    }
    if (mappings.size !== originals.length) throw new Error(`${spread.id}: 移行台帳に欠落があります`)
  }
  return { project, entries }
}
