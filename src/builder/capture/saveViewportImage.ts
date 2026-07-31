import { t } from '../i18n'
import { downloadBlob } from '../io/browserFiles'

export async function saveViewportImage(canvas: HTMLCanvasElement | null): Promise<void> {
  if (!canvas) throw new Error(t().viewport.captureFailed)
  const dataUrl = canvas.toDataURL('image/png')
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  downloadBlob(new Blob([bytes], { type: 'image/png' }), 'tobidas-preview.png')
}

