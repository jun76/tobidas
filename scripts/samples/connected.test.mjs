import assert from 'node:assert/strict'
import { test } from 'node:test'
import { requiresFiction } from './connected.mjs'

const card = () => ({ type: 'visual', motion: [], parent: { type: 'right-page' } })
const track = (property, values) => ({ property, keys: values.map((value, time) => ({ time, value })) })

test('本体の出現・消失・自由変形を支持なしの演出へ分類する', () => {
  for (const [property, values] of [['opacity', [0, 1]], ['visible', [false, true]], ['position.x', [0, 1]], ['scale', [.6, 1]], ['rotation.z', [0, 15]]]) {
    assert.equal(requiresFiction(card(), [track(property, values)]), true, property)
  }
  assert.equal(requiresFiction({ ...card(), motion: [{ type: 'sway' }] }, []), true)
})

test('絵柄や明かりの変化だけなら親の紙と支持を残す', () => {
  assert.equal(requiresFiction(card(), []), false)
  assert.equal(requiresFiction(card(), [track('opacity', [.8, .8])]), false)
  assert.equal(requiresFiction(card(), [track('visual.image', ['dark.webp', 'lit.webp'])], true), false)
  assert.equal(requiresFiction(card(), [track('opacity', [0, 1])], true), false)
  assert.equal(requiresFiction(card(), [track('scale', [.6, 1])], true), true)
})

test('子の羽根の回転は塔の紙をフィクションにしない', () => {
  assert.equal(requiresFiction(card(), []), false)
  assert.equal(requiresFiction({ ...card(), parent: { type: 'element', elementId: 'tower' } }, [track('rotation.z', [0, 360])]), true)
})
