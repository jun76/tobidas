import { externalAssetUrl, type Asset } from '../schema/assets'
import type { BookProject, BookProjectFile } from '../schema/bookPackage'

export function stripAssetData(project: BookProject): BookProjectFile {
  return { ...project, assets: project.assets.map(({ data: _data, ...metadata }) => metadata) }
}

export function projectFileJson(project: BookProject): string {
  return JSON.stringify(stripAssetData(project), null, 2)
}

export interface ExternalizedAssets {
  /** 実体を相対URLへ差し替えた作品。埋め込み用 */
  project: BookProject
  /** 書き出し先へ置くファイル。パスは `assets/` からの相対 */
  files: { path: string; bytes: { text: string } | { base64: string }; mime: string }[]
}

/**
 * 素材の実体を作品データから外へ出す (docs/009 §2)。
 *
 * 実体を data URL で抱えたままだと単一HTMLが素材の総量ぶん太り、テキストとして
 * 開けなくなる。実体は元の形式のファイルとして `assets/` へ置き、作品データには
 * 相対URLだけを残す。パスは作品パッケージの `assets/<id>` と同じなので、
 * 書き出したサイトとパッケージで素材の並びが一致する。
 */
export function externalizeAssets(project: BookProject): ExternalizedAssets {
  const files = project.assets.map((asset) => ({
    path: asset.id,
    bytes: assetDataToBytes(asset),
    mime: asset.mime,
  }))
  return {
    project: {
      ...project,
      assets: project.assets.map((asset) => ({ ...asset, data: externalAssetUrl(asset.id) })),
    },
    files,
  }
}

export function assetDataToBytes(asset: Asset): { text: string } | { base64: string } {
  if (asset.type === 'svg') return { text: asset.data }
  return { base64: asset.data.slice(asset.data.indexOf(',') + 1) }
}

export function bytesToDataUrl(buffer: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

