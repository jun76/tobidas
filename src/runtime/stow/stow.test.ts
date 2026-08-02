import { describe, expect, it } from 'vitest'
import { createBook, createSpread, createStageElement } from '../../schema/bookDefaults'
import type { ContentMotion, StageElement, Transform } from '../../schema/stageElement'
import { ClockStore } from '../clock'
import { GateSet } from '../gate'
import { IDENTITY_MOTION, evaluateContentMotion, type MotionDelta } from '../motion'
import { compileSpreadStow } from './assign'
import type { StowItem } from './model'
import { spreadDihedrals } from './dihedral'
import { AIRBORNE_FADE_DEG, STOW_HIDDEN_DEG, STOW_SETTLED_DEG, airborneFade, evaluateChildPose, evaluateStow, evaluateVFoldSpan, flourishWindow, safeFlapFactor, settledT, stowIsDrawn, stowOpenFactor } from './evaluate'

/** 収納の変数 t から、それを与える生の二面角 δ/π へ戻す */
const rawFromSettled = (settled: number): number => {
  const floor = STOW_SETTLED_DEG / 180
  return floor + settled * (1 - floor)
}

/** 擬似乱数 (テストの再現性のためSeed固定) */
function rng(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

function randomBookWithElement(next: () => number): { book: ReturnType<typeof createBook>; element: StageElement } {
  const book = createBook()
  const spread = book.spreads[0]
  const parentRoll = next()
  const parent = parentRoll < 0.34 ? { type: 'left-page' as const } : parentRoll < 0.67 ? { type: 'right-page' as const } : { type: 'spread' as const }
  const element = createStageElement('image', parent, 'auto')
  if (element.type !== 'image') throw new Error('unreachable')
  element.width = 0.5 + next() * 10
  element.height = 0.5 + next() * 5
  element.baseTransform.position = [next() * 7 - 3.5, next() * 4, next() * 5 - 2.5]
  // 直立または平置き (実運用の姿勢域)
  element.baseTransform.rotation = next() < 0.4 ? [-90, 0, 0] : [next() * 24 - 12, next() * 40 - 20, next() * 10 - 5]
  element.pivot = [next(), 0]
  element.layer = Math.floor(next() * 6)
  element.stow.stagger = next() * 0.5
  spread.elements.push(element)
  return { book, element }
}

function collectItems(book: ReturnType<typeof createBook>): StowItem[] {
  const compiled = compileSpreadStow(book, book.spreads[0])
  return [...compiled.left, ...compiled.right]
}

describe('二面角の導出', () => {
  it('δ(k) = (α(k) − α(k+1))·π になる', () => {
    expect(spreadDihedrals([1, 0])).toEqual([Math.PI])
    expect(spreadDihedrals([0, 0])).toEqual([0])
    expect(spreadDihedrals([1, 1])).toEqual([0])
    expect(spreadDihedrals([1, 0.5, 0])[0]).toBeCloseTo(Math.PI / 2)
    expect(spreadDihedrals([1, 0.5, 0])[1]).toBeCloseTo(Math.PI / 2)
  })
})

describe('支持機構の端点', () => {
  it('表示効果の混合係数も収納端で0、開姿勢で1になる', () => {
    const { book } = randomBookWithElement(rng(31))
    for (const item of collectItems(book)) {
      expect(stowOpenFactor(item, 0)).toBe(0)
      expect(stowOpenFactor(item, 1)).toBe(1)
    }
  })

  it('t=1で開姿勢へ厳密一致する', () => {
    const next = rng(20260723)
    for (let trial = 0; trial < 200; trial++) {
      const { book, element } = randomBookWithElement(next)
      for (const item of collectItems(book)) {
        const pose = evaluateStow(item, 1, IDENTITY_MOTION)
        const expectedX = element.baseTransform.position[0] + item.offset[0] + (item.half?.centerShiftX ?? 0)
        expect(pose.position[0]).toBe(expectedX)
        expect(pose.position[1]).toBe(element.baseTransform.position[1])
        expect(pose.position[2]).toBe(element.baseTransform.position[2] + item.offset[2])
        expect(pose.rotationDeg).toEqual(element.baseTransform.rotation)
        expect(pose.scale).toEqual(element.baseTransform.scale)
      }
    }
  })

  it('t=0で帰属面の紙面スラブへ収まる', () => {
    const next = rng(7)
    for (let trial = 0; trial < 200; trial++) {
      const { book } = randomBookWithElement(next)
      for (const item of collectItems(book)) {
        const pose = evaluateStow(item, 0, IDENTITY_MOTION)
        // 位置は面のごく近くへ降り、回転は面に平行 (±90) になる。
        // page-glueは元から面上にあることを割り当てが保証する
        expect(pose.position[1]).toBeLessThan(item.mechanism === 'page-glue' ? 0.15 : 0.05)
        if (item.mechanism !== 'page-glue') {
          expect(Math.abs(Math.abs(pose.rotationDeg[0]) - 90)).toBeLessThan(1e-6)
        }
      }
    }
  })

  it(`残り${STOW_SETTLED_DEG}°より閉じた側では部品がまったく動かない`, () => {
    const next = rng(515)
    const floor = STOW_SETTLED_DEG / 180
    for (let trial = 0; trial < 120; trial++) {
      const { book } = randomBookWithElement(next)
      for (const item of collectItems(book)) {
        // 閉じ切りの姿勢と、収納完了の角度ちょうどの姿勢が一致する
        const settled = evaluateStow(item, floor, IDENTITY_MOTION)
        const closed = evaluateStow(item, 0, IDENTITY_MOTION)
        expect(settled).toEqual(closed)
        // そのあいだのどこを取っても動かない。ここで動くと、閉じてくる紙を
        // 突き抜けてちらつく
        for (let step = 0; step <= 10; step++) {
          expect(evaluateStow(item, (floor * step) / 10, IDENTITY_MOTION)).toEqual(closed)
        }
        expect(stowOpenFactor(item, floor)).toBe(0)
        expect(settledT(floor)).toBe(0)
        expect(settledT(1)).toBe(1)
      }
    }
  })

  it(`残り${STOW_HIDDEN_DEG}°より閉じた見開きは中身を描かない`, () => {
    // 紙面に厚みが無いぶん、浅い二面角では隣り合う面の部品が同じ空間を
    // 奪い合う。姿勢では避けられないので描画ごと止める
    expect(stowIsDrawn(1)).toBe(true)
    expect(stowIsDrawn(STOW_HIDDEN_DEG / 180)).toBe(false)
    expect(stowIsDrawn(0)).toBe(false)
    // 描画を止めるのは収納し切ったあと。動いている最中に消すと、
    // 起きたままの部品が突然消えるのが見えてしまう
    expect(STOW_HIDDEN_DEG).toBeLessThan(STOW_SETTLED_DEG)
    expect(stowIsDrawn(STOW_SETTLED_DEG / 180)).toBe(true)
  })

  it(`空中の部品は${AIRBORNE_FADE_DEG}°から薄れ、収納完了で消えている`, () => {
    // 紙に貼った・立てた部品は閉じてくる紙が隠すが、宙に浮いた部品には
    // 隠してくれる紙が無い。とくに背表紙の上の部品は隙間に入らないので、
    // 描画を止める2°まで残すと次の見開きの上に丸ごと出る
    expect(airborneFade('airborne-route', 1)).toBe(1)
    expect(airborneFade('airborne-route', AIRBORNE_FADE_DEG / 180)).toBe(1)
    expect(airborneFade('airborne-route', STOW_SETTLED_DEG / 180)).toBe(0)
    expect(airborneFade('airborne-route', STOW_HIDDEN_DEG / 180)).toBe(0)
    // あいだは単調に薄れる (突然消さない)
    let previous = 0
    for (let step = 0; step <= 20; step++) {
      const t = (STOW_SETTLED_DEG + (AIRBORNE_FADE_DEG - STOW_SETTLED_DEG) * (step / 20)) / 180
      const value = airborneFade('airborne-route', t)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
    // 薄れるのは空中の部品だけ。紙が隠してくれる機構には掛けない
    for (const mechanism of ['page-glue', 'flap', 'v-fold'] as const) {
      expect(airborneFade(mechanism, STOW_SETTLED_DEG / 180)).toBe(1)
      expect(airborneFade(mechanism, 0)).toBe(1)
    }
    // 収納が終わる角度で 0 に達している = 動いている最中に消えることはない
    expect(AIRBORNE_FADE_DEG).toBeGreaterThan(STOW_SETTLED_DEG)
  })

  it('空中の部品の不透明度は姿勢の評価にも乗る', () => {
    const book = createBook()
    const spread = book.spreads[0]
    const element = createStageElement('image', { type: 'spread' }, 'auto')
    if (element.type !== 'image') throw new Error('unreachable')
    element.width = 1
    element.height = 1
    element.baseTransform.position = [0, 2.4, 1.2]
    spread.elements.push(element)
    const items = collectItems(book)
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) {
      expect(evaluateStow(item, 1, IDENTITY_MOTION).opacityMul).toBe(1)
      expect(evaluateStow(item, STOW_SETTLED_DEG / 180, IDENTITY_MOTION).opacityMul).toBe(0)
      expect(evaluateStow(item, 45 / 180, IDENTITY_MOTION).opacityMul).toBeCloseTo(0.5, 6)
    }
  })

  it('子は畳みに従って親の板の上へ寝て、変位も止まる', () => {
    const base: Transform = {
      position: [2.3, 0.4, -1.2], rotation: [0, 30, 0], scale: [1, 1, 1],
    }
    // 開き切りでは制作値へ厳密一致
    expect(evaluateChildPose(base, IDENTITY_MOTION, 1).position).toEqual([2.3, 0.4, -1.2])

    // 畳み切ると親の板の上へ寝る。横と法線を残すと、親が寝るときの90度回転で
    // 隔たりが紙面の法線へ倒れ、子が持ち上がって本の外へ出る。
    // 「開姿勢の足跡へ降ろす」やり方は、軸が背表紙の上にある軌道部品だと
    // 足跡が両面へまたがるため、片面へ収める収納とは両立しない
    const flat = evaluateChildPose(base, IDENTITY_MOTION, 0).position
    expect([Math.abs(flat[0]), flat[1], Math.abs(flat[2])]).toEqual([0, 0.4, 0])
    expect(evaluateChildPose(base, IDENTITY_MOTION, 0.5).position[0]).toBeCloseTo(1.15)

    // 縦だけは畳まない。板が寝るときの回転は接地線まわりなので、縦の隔たりは
    // 寝ても紙面と平行のまま。畳むと親が起き上がる間ずっと子が板の上を滑り、
    // 風車の羽根が塔の軸から外れて見える
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      expect(evaluateChildPose(base, IDENTITY_MOTION, f).position[1]).toBe(0.4)
    }

    // 住人の変位も畳みに従う。残すと紙面へ寝たあとも子が回り続け、
    // 回り続ける板は法線方向へ立ち上がって紙を突き抜ける
    const sway: MotionDelta = { position: [0, 0.5, 0], rotationDeg: [0, 90, 0], spinDeg: [0, 0, 0], scaleMul: 2 }
    expect(evaluateChildPose(base, sway, 1).rotationDeg).toEqual([0, 120, 0])
    expect(evaluateChildPose(base, sway, 1).scale).toEqual([2, 2, 2])
    expect(evaluateChildPose(base, sway, 0).rotationDeg).toEqual([0, 30, 0])
    expect(evaluateChildPose(base, sway, 0).scale).toEqual([1, 1, 1])

    // 自転だけは畳まない。積み上がる角度に f を掛けると f が動く瞬間だけ暴走する
    const spin: MotionDelta = { ...IDENTITY_MOTION, spinDeg: [0, 900, 0] }
    expect(evaluateChildPose(base, spin, 1).rotationDeg).toEqual([0, 930, 0])
    expect(evaluateChildPose(base, spin, 0.5).rotationDeg).toEqual([0, 930, 0])
  })

  it('自転の表示速度はページ送り中も一定 (畳み係数を掛けない)', () => {
    const base: Transform = { position: [0, 3.85, 0.02], rotation: [0, 0, 0], scale: [1, 1, 1] }
    const motion: ContentMotion[] = [{ type: 'spin', axis: 'z', speed: 0.9 }]
    const expected = 0.9 * (180 / Math.PI)
    const dt = 1 / 60

    /** 住人時間 time・畳み係数 f・その変化率 dfdt での表示角の変化率 (度/秒) */
    const rate = (time: number, f: number, dfdt: number): number => {
      const a = evaluateChildPose(base, evaluateContentMotion(motion, time), f).rotationDeg[2]
      const b = evaluateChildPose(base, evaluateContentMotion(motion, time + dt), f + dfdt * dt).rotationDeg[2]
      return (b - a) / dt
    }

    // 表示時間にかかわらず、送り 1.5 秒で f が 1 -> 0 へ動く間も通常の速さを保つ
    for (const residency of [2, 10, 30, 60, 600]) {
      expect(rate(residency, 1, 0)).toBeCloseTo(expected)
      expect(rate(residency, 0.5, -1 / 1.5)).toBeCloseTo(expected)
      expect(rate(residency, 0.05, -1 / 1.5)).toBeCloseTo(expected)
    }
  })

  it('寝かせた部品のリフトは紙の厚みを越えない', () => {
    const book = createBook()
    const spread = book.spreads[0]
    const element = createStageElement('image')
    element.layer = 100
    element.baseTransform.position = [0, 1, 0]
    spread.elements = [element]
    const flatY = evaluateStow(collectItems(book)[0], 0, IDENTITY_MOTION).position[1]

    // 紙面との前後を決めているのはこのリフトだけ (polygonOffset は実装依存で
    // 無視されうる)。深度の分解能を越える高さが要り、薄くすると寝た部品が紙へ埋もれる。
    // 使える幅の半分は使っておく — 0.001 まで削ったときは 45° で紙面の部品が全滅した
    expect(flatY).toBeGreaterThan(book.format.pageThickness / 4)
    // 紙より厚く浮かせると、寝かせた部品が隣の面から見えてしまう。
    // 背表紙のきわに置いた部品は向かい合う二面の隙間が 0 の場所にいるので、
    // 二面角がいくら開いていても隙間で隠せず、送りの最中に前の見開きへ現れる
    expect(flatY).toBeLessThan(book.format.pageThickness / 2)
  })

  it('上位の部品の自転は一回転へ折り返してから畳む', () => {
    const book = createBook()
    const spread = book.spreads[0]
    const element = createStageElement('image')
    element.baseTransform.position = [0, 1, 0]
    element.motion = [{ type: 'spin', axis: 'z', speed: 0.9 }]
    spread.elements = [element]
    const item = collectItems(book)[0]

    // 上位の部品は収納し切っても 30°..10° の間は描かれるので、f=0 で変位が消える
    expect(evaluateStow(item, 0, evaluateContentMotion(element.motion, 600)).rotationDeg[2])
      .toBeCloseTo(element.baseTransform.rotation[2])

    // 畳みの途中でも、掛かる角度は一回転を超えない
    for (const f of [0.25, 0.5, 0.75]) {
      const raw = rawFromSettled(f)
      const spun = evaluateStow(item, raw, evaluateContentMotion(element.motion, 600)).rotationDeg[2]
      const still = evaluateStow(item, raw, IDENTITY_MOTION).rotationDeg[2]
      expect(Math.abs(spun - still)).toBeLessThanOrEqual(180)
    }
  })

  it('スケールは相似縮小の合成を除き不変で、展開の後半では厳密に恒等', () => {
    const next = rng(99)
    for (let trial = 0; trial < 100; trial++) {
      const { book, element } = randomBookWithElement(next)
      for (const item of collectItems(book)) {
        // 展開係数fが0.5となるtより開いた側では縮小は厳密に恒等。
        // fは詰め直したあとの変数から出るので、生の二面角へ戻して与える
        const tIdentity = rawFromSettled(item.phase + 0.5 * (1 - item.phase) + 0.01)
        for (const t of [Math.min(1, tIdentity), 0.9, 1]) {
          expect(evaluateStow(item, Math.max(t, tIdentity), IDENTITY_MOTION).scale).toEqual(element.baseTransform.scale)
        }
      }
    }
  })
})

describe('楔空間の包含', () => {
  it('全域で部品の先端が対面の天井を越えない', () => {
    const next = rng(4444)
    for (let trial = 0; trial < 150; trial++) {
      const { book, element } = randomBookWithElement(next)
      if (element.type !== 'image') continue
      for (const item of collectItems(book)) {
        if (item.mechanism === 'page-glue') continue
        const w = book.format.pageWidth
        for (let step = 1; step <= 30; step++) {
          const t = step / 30
          const pose = evaluateStow(item, t, IDENTITY_MOTION)
          // 先端の面からの高さ (概算): 位置 + 起き上がり成分
          const lean = Math.abs(Math.cos((pose.rotationDeg[0] * Math.PI) / 180))
          const scaleY = pose.scale[1]
          const tipHeight = pose.position[1] + element.height * (1 - element.pivot[1]) * lean * scaleY
          // 対面の天井: 背表紙から先端x位置までの距離 × tan(δ)。δ≥π/2では制約なし
          const delta = t * Math.PI
          if (delta >= Math.PI / 2) continue
          const spineDist = item.face === 'left' ? w / 2 - pose.position[0] : pose.position[0] + w / 2
          const ceiling = Math.max(0.05, spineDist + element.height * 0.15) * Math.tan(delta)
          expect(tipHeight).toBeLessThanOrEqual(ceiling + 0.35)
        }
      }
    }
  })

  it('背表紙に近い起立板ほど倒伏角を直接制限する', () => {
    const book = createBook()
    const spread = book.spreads[0]
    const element = createStageElement('image', { type: 'right-page' }, 'flap')
    if (element.type !== 'image') throw new Error('unreachable')
    element.width = 1
    element.height = 4
    element.pivot = [0.5, 0]
    element.baseTransform.rotation = [0, 0, 0]
    element.baseTransform.position = [-3.2, 0.01, 0]
    spread.elements.push(element)
    const item = collectItems(book)[0]
    expect(safeFlapFactor(item, 45 / 180)).toBeLessThan(1)
    const pose = evaluateStow(item, 45 / 180, IDENTITY_MOTION)
    expect(Math.abs(pose.rotationDeg[0])).toBeGreaterThan(0)
  })
})

describe('連続性と可逆性', () => {
  it('tに対して姿勢が連続する', () => {
    const next = rng(1234)
    for (let trial = 0; trial < 60; trial++) {
      const { book } = randomBookWithElement(next)
      for (const item of collectItems(book)) {
        let previous = evaluateStow(item, 0, IDENTITY_MOTION)
        for (let step = 1; step <= 200; step++) {
          const pose = evaluateStow(item, step / 200, IDENTITY_MOTION)
          for (let axis = 0; axis < 3; axis++) {
            expect(Math.abs(pose.position[axis] - previous.position[axis])).toBeLessThan(1.2)
            expect(Math.abs(pose.rotationDeg[axis] - previous.rotationDeg[axis])).toBeLessThan(20)
          }
          previous = pose
        }
      }
    }
  })

  it('同じtから同じ姿勢を返す (決定性)', () => {
    const next = rng(31)
    const { book } = randomBookWithElement(next)
    for (const item of collectItems(book)) {
      for (const t of [0, 0.21, 0.5, 0.87, 1]) {
        expect(evaluateStow(item, t, IDENTITY_MOTION)).toEqual(evaluateStow(item, t, IDENTITY_MOTION))
      }
    }
  })
})

describe('コンパイラの割り当て', () => {
  it('平置き、直立、空中経路、中央線またぎを開姿勢から決める', () => {
    const book = createBook()
    const spread = book.spreads[0]
    const flat = createStageElement('image', { type: 'right-page' }, 'auto')
    flat.baseTransform.rotation = [-90, 0, 0]
    const upright = createStageElement('image', { type: 'right-page' }, 'auto')
    upright.baseTransform.rotation = [0, 0, 0]
    upright.baseTransform.position = [1, 0.04, 1]
    const floating = createStageElement('image', { type: 'spread' }, 'auto')
    floating.baseTransform.rotation = [0, 0, 0]
    floating.baseTransform.position = [2, 3, 0]
    const wide = createStageElement('image', { type: 'right-page' }, 'flap')
    wide.baseTransform.rotation = [0, 0, 0]
    // 右面ローカルx=-4は見開き中央。明示flapでも中央線交差を優先して二翼化する。
    wide.baseTransform.position = [-4, 0.05, 1]
    if (wide.type === 'image') { wide.width = 10; wide.height = 3 }
    spread.elements.push(flat, upright, floating, wide)
    const compiled = compileSpreadStow(book, spread)
    const all = [...compiled.left, ...compiled.right]
    expect(all.find((i) => i.element.id === flat.id)?.mechanism).toBe('page-glue')
    expect(all.find((i) => i.element.id === upright.id)?.mechanism).toBe('flap')
    expect(all.find((i) => i.element.id === floating.id)?.mechanism).toBe('airborne-route')
    // 背をまたぐv-foldは一枚パネルとして楔区分へ入り、面リストには入らない
    expect(all.some((i) => i.element.id === wide.id)).toBe(false)
    expect(compiled.spanning.map((s) => s.element.id)).toEqual([wide.id])
  })

  it('形を持たないグループは子孫の最下端から空中経路を決める', () => {
    const book = createBook()
    const spread = book.spreads[0]
    const group = createStageElement('group', { type: 'spread' }, 'auto')
    group.baseTransform.position = [0, 0, 0]
    const child = createStageElement('image', { type: 'element', elementId: group.id }, 'auto')
    child.baseTransform.position = [0, 2, 0]
    child.pivot = [0.5, 0.5]
    spread.elements.push(group, child)
    const item = collectItems(book).find((candidate) => candidate.element.id === group.id)
    expect(item?.mechanism).toBe('airborne-route')
  })

  it('隣接見開きの片面背景をページ送り中に同時起立させない', () => {
    const makeBackground = () => {
      const element = createStageElement('image', { type: 'right-page' }, 'flap')
      if (element.type !== 'image') throw new Error('unreachable')
      element.sourcePreset = 'depth-layer'
      element.baseTransform.rotation = [0, 0, 0]
      element.width = 6.6
      element.height = 3.6
      return element
    }
    const book = createBook()
    book.spreads.push(createSpread('次'))
    const outgoing = makeBackground()
    const incoming = makeBackground()
    book.spreads[0].elements.push(outgoing)
    book.spreads[1].elements.push(incoming)
    const outgoingItem = compileSpreadStow(book, book.spreads[0]).right.find((item) => item.element.id === outgoing.id)!
    const incomingItem = compileSpreadStow(book, book.spreads[1]).right.find((item) => item.element.id === incoming.id)!
    expect(outgoingItem.phase).toBeGreaterThan(.5)
    expect(incomingItem.phase).toBeGreaterThan(.5)

    for (let step = 0; step <= 100; step++) {
      const turn = step / 100
      const outgoingOpen = stowOpenFactor(outgoingItem, 1 - turn)
      const incomingOpen = stowOpenFactor(incomingItem, turn)
      expect(outgoingOpen > 0 && incomingOpen > 0).toBe(false)
    }
  })
})

describe('背をまたぐ一枚パネル', () => {
  function makeSpan(fallDirection: 'auto' | 'back' | 'front' = 'auto') {
    const book = createBook()
    const spread = book.spreads[0]
    const wide = createStageElement('image', { type: 'spread' }, 'v-fold')
    if (wide.type !== 'image') throw new Error('unreachable')
    wide.width = 10
    wide.height = 6.5
    wide.baseTransform.position = [0, 0.08, -2.7]
    wide.baseTransform.rotation = [0, 0, 0]
    wide.pivot = [0.5, 0]
    wide.stow.fallDirection = fallDirection
    spread.elements.push(wide)
    const compiled = compileSpreadStow(book, spread)
    expect(compiled.spanning).toHaveLength(1)
    return compiled.spanning[0]
  }

  it('開き切り (A=π, B=0) で折り目は垂直、水平スパンは制作値に一致する', () => {
    const span = makeSpan()
    const pose = evaluateVFoldSpan(span, Math.PI, 0, IDENTITY_MOTION)
    expect(pose.creaseDir[0]).toBeCloseTo(0)
    expect(pose.creaseDir[1]).toBeCloseTo(1)
    expect(pose.creaseDir[2]).toBeCloseTo(0)
    // 糊しろは面内 (y=0) で、水平投影の幅は制作者の半幅5になる
    expect(pose.leftDir[1]).toBeCloseTo(0)
    expect(pose.rightDir[1]).toBeCloseTo(0)
    expect(span.widthLeft * Math.abs(pose.leftDir[0])).toBeCloseTo(5)
    expect(span.widthRight * pose.rightDir[0]).toBeCloseTo(5)
    expect(pose.origin).toEqual([0, 0.08, -2.7])
  })

  it('剛体のまま畳まれる: 翼の基底は直交し、糊しろは自面内に留まる', () => {
    const span = makeSpan()
    const dot = (a: [number, number, number], b: [number, number, number]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    for (let step = 0; step <= 40; step++) {
      const rightAngle = (step / 40) * Math.PI // ページ送り: 右面が0→πへ立ち上がる
      const pose = evaluateVFoldSpan(span, Math.PI, rightAngle, IDENTITY_MOTION)
      // 直交基底 = アートワークが歪まない (せん断ゼロ)
      expect(Math.abs(dot(pose.creaseDir, pose.leftDir))).toBeLessThan(1e-6)
      expect(Math.abs(dot(pose.creaseDir, pose.rightDir))).toBeLessThan(1e-6)
      expect(Math.hypot(...pose.creaseDir)).toBeCloseTo(1)
      // 糊しろは自面の平面内 (面の法線と直交)
      const normalLeft: [number, number, number] = [-Math.sin(Math.PI), Math.cos(Math.PI), 0]
      const normalRight: [number, number, number] = [-Math.sin(rightAngle), Math.cos(rightAngle), 0]
      expect(Math.abs(dot(pose.leftDir, normalLeft))).toBeLessThan(1e-6)
      expect(Math.abs(dot(pose.rightDir, normalRight))).toBeLessThan(1e-6)
    }
  })

  it('折り畳み中は折り目が本の手前へ倒れる', () => {
    const span = makeSpan()
    for (let step = 1; step < 40; step++) {
      const pose = evaluateVFoldSpan(span, Math.PI, (step / 40) * Math.PI, IDENTITY_MOTION)
      expect(pose.creaseDir[2]).toBeGreaterThan(0)
    }
  })

  it('奥へを指定するとV字が反転し、折り目が本の奥へ倒れる', () => {
    const span = makeSpan('back')
    expect(span.fall).toBe('back')
    for (let step = 1; step < 40; step++) {
      const pose = evaluateVFoldSpan(span, Math.PI, (step / 40) * Math.PI, IDENTITY_MOTION)
      expect(pose.creaseDir[2]).toBeLessThan(0)
    }
  })

  it('姿勢がtに対して連続する', () => {
    const span = makeSpan()
    let previous = evaluateVFoldSpan(span, Math.PI, 0, IDENTITY_MOTION)
    for (let step = 1; step <= 200; step++) {
      const pose = evaluateVFoldSpan(span, Math.PI, (step / 200) * Math.PI, IDENTITY_MOTION)
      for (let axis = 0; axis < 3; axis++) {
        expect(Math.abs(pose.creaseDir[axis] - previous.creaseDir[axis])).toBeLessThan(0.05)
        expect(Math.abs(pose.origin[axis] - previous.origin[axis])).toBeLessThan(0.05)
      }
      previous = pose
    }
  })
})

describe('空中要素の外側迂回', () => {
  function makeAirborne() {
    const book = createBook()
    const spread = book.spreads[0]
    const floating = createStageElement('image', { type: 'spread' }, 'auto')
    floating.baseTransform.rotation = [0, 0, 0]
    floating.baseTransform.position = [2.1, 3.6, -0.25]
    spread.elements.push(floating)
    const compiled = compileSpreadStow(book, spread)
    const item = compiled.right.find((i) => i.element.id === floating.id)!
    expect(item.mechanism).toBe('airborne-route')
    return item
  }

  it('端点では膨らみが厳密にゼロ (t=1で開姿勢、t=0で真下へ平坦)', () => {
    const item = makeAirborne()
    // 見開き親は右面ローカルへ帰属補正される (x: 2.1 − w/2 = −1.9)
    const open = evaluateStow(item, 1, IDENTITY_MOTION)
    expect(open.position[0]).toBeCloseTo(-1.9)
    expect(open.position[1]).toBeCloseTo(3.6)
    const flat = evaluateStow(item, 0, IDENTITY_MOTION)
    expect(flat.position[0]).toBeCloseTo(-1.9) // 迂回後は真下へ着地する
    expect(flat.position[1]).toBeLessThan(0.05)
  })

  it('中間では小口の外まで張り出す', () => {
    const item = makeAirborne()
    expect(item.eject).toBeGreaterThan(0)
    const tMid = item.phase + 0.5 * (1 - item.phase)
    const pose = evaluateStow(item, tMid, IDENTITY_MOTION)
    // 右面の小口 (面ローカル+w/2=4) より外へ出る
    expect(pose.position[0]).toBeGreaterThan(4)
  })
})

describe('装飾トラックの窓', () => {
  it('端点では必ず0になる', () => {
    expect(flourishWindow(0)).toBe(0)
    expect(flourishWindow(1)).toBe(0)
    expect(flourishWindow(0.5)).toBeGreaterThan(0.9)
  })
})

describe('Visibility Gateのヒステリシス', () => {
  it('閾値付近の往復で振動しない', () => {
    const gate = new GateSet({ openAt: 0.015, closeAt: 0.006 })
    expect(gate.evaluate('a', 0.01)).toBe(false)
    expect(gate.evaluate('a', 0.02)).toBe(true)
    expect(gate.evaluate('a', 0.01)).toBe(true)
    expect(gate.evaluate('a', 0.004)).toBe(false)
  })
})

describe('Content Clock', () => {
  it('mountを跨いで続きから進む', () => {
    const clocks = new ClockStore()
    clocks.advance('e1', 0.5)
    clocks.advance('e1', 0.25)
    expect(clocks.peek('e1')).toBeCloseTo(0.75)
    expect(clocks.advance('e1', 0.25)).toBeCloseTo(1)
  })
})
