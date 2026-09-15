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
      // 寸法だけを読む。透明部分の範囲は使う先がなく、全画素の走査は読み込みを何倍も遅くする。
      return { width: image.naturalWidth, height: image.naturalHeight }
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
