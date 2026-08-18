import { t } from '../i18n'
import { assetKindForFile } from '../../package/model'
import { bytesToDataUrl } from '../../package/serialize'
import { AUDIO_BYTE_LIMIT, VIDEO_BYTE_LIMIT, type Asset, type AssetData } from '../../schema/assets'

export async function fileToAsset(file: File, existingIds: ReadonlySet<string>): Promise<Asset> {
  const kind = assetKindForFile(file.name)
  if (!kind) throw new Error(t().assets.unsupported(file.name))
  if (kind.type === 'video' && file.type && file.type !== 'application/octet-stream' && file.type !== kind.mime) {
    throw new Error(t().assets.unsupported(file.name))
  }
  if (kind.type === 'audio' && file.size > AUDIO_BYTE_LIMIT) {
    throw new Error(t().assets.audioTooLarge(file.name, Math.round(AUDIO_BYTE_LIMIT / 1024 / 1024)))
  }
  if (kind.type === 'video' && file.size > VIDEO_BYTE_LIMIT) {
    throw new Error(t().assets.videoTooLarge(file.name, Math.round(VIDEO_BYTE_LIMIT / 1024 / 1024)))
  }
  const data = kind.type === 'svg'
    ? await file.text()
    : kind.type === 'video'
      ? new Blob([file], { type: kind.mime })
      : bytesToDataUrl(await file.arrayBuffer(), kind.mime)
  return {
    id: uniqueAssetId(file.name, existingIds),
    name: file.name.replace(/\.[^.]+$/, ''),
    type: kind.type,
    mime: kind.mime,
    data,
    bytes: file.size,
    ...await readMediaMetadata(file, kind.type, data),
  }
}

export async function readMediaMetadata(file: File, type: Asset['type'], data: AssetData) {
  if (type === 'image' || type === 'svg') {
    const url = type === 'svg' ? URL.createObjectURL(file) : String(data)
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image()
        element.onload = () => resolve(element)
        element.onerror = reject
        element.src = url
      })
      let alphaBounds: { x: number; y: number; width: number; height: number } | undefined
      if (type === 'image') alphaBounds = readAlphaBounds(image)
      return { width: image.naturalWidth, height: image.naturalHeight, alphaBounds }
    } finally {
      if (type === 'svg') URL.revokeObjectURL(url)
    }
  }
  if (type === 'audio') {
    const duration = await new Promise<number>((resolve) => {
      const audio = new Audio(String(data))
      audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0)
      audio.onerror = () => resolve(0)
    })
    return { duration }
  }
  if (type === 'video') {
    const url = URL.createObjectURL(data instanceof Blob ? data : file)
    try {
      return await new Promise<{ width: number; height: number; duration: number }>((resolve, reject) => {
        const video = document.createElement('video')
        video.preload = 'metadata'
        video.muted = true
        video.playsInline = true
        video.onloadedmetadata = () => {
          if (video.videoWidth <= 0 || video.videoHeight <= 0
            || !Number.isFinite(video.duration) || video.duration <= 0) {
            reject(new Error(t().assets.videoUnreadable(file.name)))
            return
          }
          resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration })
        }
        video.onerror = () => reject(new Error(t().assets.videoUnreadable(file.name)))
        video.src = url
      })
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  return {}
}

function readAlphaBounds(image: HTMLImageElement) {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context?.drawImage(image, 0, 0)
  const pixels = context?.getImageData(0, 0, canvas.width, canvas.height).data
  if (!pixels) return undefined
  let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    if (pixels[(y * canvas.width + x) * 4 + 3] <= 8) continue
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  if (maxX < minX || minX === 0 && minY === 0 && maxX === canvas.width - 1 && maxY === canvas.height - 1) {
    return undefined
  }
  return {
    x: minX / canvas.width,
    y: minY / canvas.height,
    width: (maxX - minX + 1) / canvas.width,
    height: (maxY - minY + 1) / canvas.height,
  }
}

function uniqueAssetId(fileName: string, existing: ReadonlySet<string>): string {
  if (!existing.has(fileName)) return fileName
  const dot = fileName.lastIndexOf('.')
  const stem = fileName.slice(0, dot)
  const extension = fileName.slice(dot)
  for (let index = 2; ; index++) {
    const candidate = `${stem}-${index}${extension}`
    if (!existing.has(candidate)) return candidate
  }
}
