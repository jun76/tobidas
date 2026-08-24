#!/usr/bin/env node
// 小さな場面効果音を、外部依存なしで再現可能なWAVとして生成する。
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const get = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}

if (args.includes('--help')) {
  console.log('node synthesize-sfx.mjs --out <file.wav> --kind sparkle|splash|step|impact|wind|chime [--duration seconds]')
  process.exit(0)
}

const output = get('out', '')
const kind = get('kind', 'sparkle')
const duration = Math.min(3, Math.max(0.08, Number(get('duration', kind === 'wind' ? 1.8 : 0.7))))
if (!output) throw new Error('--out <file.wav> が必要です')

const sampleRate = 44100
const count = Math.floor(sampleRate * duration)
const pcm = Buffer.alloc(count * 2)
const clamp = (value) => Math.max(-1, Math.min(1, value))
const hash = [...kind].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7)
let state = hash || 1
const noise = () => {
  state = (1664525 * state + 1013904223) >>> 0
  return (state / 0xffffffff) * 2 - 1
}

for (let i = 0; i < count; i += 1) {
  const t = i / sampleRate
  const progress = t / duration
  let value = 0

  if (kind === 'sparkle') {
    const tone = Math.sin(2 * Math.PI * (880 + 1100 * progress) * t)
    value = tone * Math.exp(-5.5 * progress) * 0.42
  } else if (kind === 'splash') {
    value = noise() * Math.exp(-4 * progress) * 0.28
      + Math.sin(2 * Math.PI * 220 * t) * Math.exp(-7 * progress) * 0.18
  } else if (kind === 'step') {
    const thump = Math.sin(2 * Math.PI * 105 * t) * Math.exp(-22 * progress)
    value = thump * 0.55 + noise() * Math.exp(-28 * progress) * 0.08
  } else if (kind === 'impact') {
    value = (noise() * 0.45 + Math.sin(2 * Math.PI * 75 * t) * 0.55) * Math.exp(-10 * progress)
  } else if (kind === 'wind') {
    value = noise() * (0.08 + 0.16 * Math.sin(Math.PI * progress))
  } else if (kind === 'chime') {
    const tone = Math.sin(2 * Math.PI * 660 * t) + 0.45 * Math.sin(2 * Math.PI * 990 * t)
    value = tone * Math.exp(-3.2 * progress) * 0.22
  } else {
    throw new Error(`未対応のkindです: ${kind}`)
  }

  const envelope = Math.min(1, t * 90) * Math.min(1, (duration - t) * 35)
  pcm.writeInt16LE(Math.round(clamp(value * envelope) * 32767), i * 2)
}

const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + pcm.length, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(1, 22)
header.writeUInt32LE(sampleRate, 24)
header.writeUInt32LE(sampleRate * 2, 28)
header.writeUInt16LE(2, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(pcm.length, 40)
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
fs.writeFileSync(output, Buffer.concat([header, pcm]))
console.log(`効果音を生成しました: ${output} (${kind}, ${duration.toFixed(2)}s)`)
