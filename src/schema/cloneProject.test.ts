import { describe, expect, it } from 'vitest'
import { createBookProject } from './bookDefaults'
import { cloneProject } from './cloneProject'

describe('作品の編集用複製', () => {
  it('素材本体を共有してもメタデータと作品の編集は過去の履歴へ伝わらない', () => {
    const original = createBookProject(), video = new Blob(['video'], { type: 'video/webm' })
    original.assets = [
      { id: 'picture', name: '画像', type: 'image', mime: 'image/webp', data: 'data:image/webp;base64,AA==', alphaBounds: { x: 0, y: 0, width: 1, height: 1 } },
      { id: 'video', name: '動画', type: 'video', mime: 'video/webm', data: video },
    ]
    const copy = cloneProject(original)
    expect(copy.assets[1].data).toBe(video)
    expect(copy.assets[0].data).toBe(original.assets[0].data)
    copy.assets[0].alphaBounds!.x = .2
    copy.assets[0].data = 'data:image/webp;base64,AQ=='
    copy.book.spreads[0].name = '変更後'
    expect(original.assets[0].alphaBounds!.x).toBe(0)
    expect(original.assets[0].data).toBe('data:image/webp;base64,AA==')
    expect(original.book.spreads[0].name).not.toBe('変更後')
  })
})
