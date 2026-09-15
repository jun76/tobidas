import type { BookProject } from './bookPackage'

/** 編集用のメタデータだけを複製し、不変の画像・動画・音声本体は共有する。 */
export function cloneProject(project: BookProject): BookProject {
  const copied = structuredClone({ ...project, assets: project.assets.map(({ data: _data, ...asset }) => asset) })
  return { ...copied, assets: copied.assets.map((asset, index) => ({ ...asset, data: project.assets[index].data })) }
}
