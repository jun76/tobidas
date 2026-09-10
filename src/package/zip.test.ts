import { expect, it } from 'vitest'
import { createBookProject, createStageElement } from '../schema/bookDefaults'
import { connectedContentSchema } from '../schema/content'
import { contentAsStage } from '../parts/contents'
import { buildProjectZip, readProjectZip } from './zip'
import { projectFileJson } from './serialize'
import JSZip from 'jszip'

it('編集用ZIPはフォルダーと同じスキーマ・素材・ガイドへ復元する', async () => {
  const project = createBookProject('往復')
  project.assets.push({ id: 'mark.webp', name: 'mark', type: 'image', mime: 'image/webp', data: 'data:image/webp;base64,AQID', bytes: 3 })
  project.book.spreads[0].elements = [contentAsStage(connectedContentSchema.parse({ ...createStageElement('visual'), image: 'mark.webp',
    attachment: { type: 'surface', surface: { nodeId: '$book', portId: 'right-page' }, point: [3, 3], side: 'front' },
    presentation: { kind: 'decal' }, baseTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }))]
  const restored = (await readProjectZip(await buildProjectZip(project))).project
  expect(projectFileJson(restored)).toBe(projectFileJson(project))
  expect(restored.assets[0].data).toBe(project.assets[0].data)
  expect(restored.authoringGuide).toEqual(project.authoringGuide)
})
it('未知の参照を持つZIPはインポート時に拒否する', async () => {
  const project = createBookProject(), zip = new JSZip()
  project.book.spreads[0].elements = [contentAsStage(connectedContentSchema.parse({ ...createStageElement('visual'),
    attachment: { type: 'surface', surface: { nodeId: 'missing', portId: 'face' }, point: [0, 0], side: 'front' }, presentation: { kind: 'decal' } }))]
  zip.file('project.json', projectFileJson(project))
  await expect(readProjectZip(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/surface|parent/)
})
