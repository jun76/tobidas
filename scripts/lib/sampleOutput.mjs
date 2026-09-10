import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

export const hashBytes = (value) => createHash('sha256').update(value).digest('hex')
export function directoryHashes(dir) {
  const hashes = {}
  if (!existsSync(dir)) return hashes
  const walk = (at) => { for (const entry of readdirSync(at, { withFileTypes: true })) {
    const full = join(at, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`生成先にシンボリックリンクがあります: ${full}`)
    if (entry.isDirectory()) walk(full)
    else if (entry.name !== '.generated-files.json') hashes[relative(dir, full).replaceAll('\\', '/')] = hashBytes(readFileSync(full))
  } }
  walk(dir); return hashes
}
/** 対象作品だけを書き出し、前回以降の手直しがあればフォルダー全体を隣へ退避する。削除はしない。 */
export function writeSampleFolder(root, name, files) {
  const base = resolve(root), dir = resolve(base, name)
  if (!/^[a-zA-Z0-9_-]+$/.test(name) || !dir.startsWith(base + sep) || dir === base) throw new Error(`不正な生成先: ${dir}`)
  const incoming = Object.fromEntries([...files].map(([file, bytes]) => [file, hashBytes(bytes)]))
  const old = directoryHashes(dir), marker = join(dir, '.generated-files.json')
  const known = existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')) : {}
  const edited = Object.keys(old).some((file) => old[file] !== known[file]) || Object.keys(known).some((file) => !old[file])
  if (existsSync(dir) && (edited || Object.keys(old).some((file) => !(file in incoming)))) {
    const backup = `${dir}-saved-${new Date().toISOString().replace(/[^0-9]/g, '')}`
    renameSync(dir, backup); console.log(`前の内容を保管: ${backup}`)
  }
  mkdirSync(dir, { recursive: true })
  for (const [file, bytes] of files) {
    const target = resolve(dir, file)
    if (!target.startsWith(dir + sep)) throw new Error(`不正な生成ファイル: ${target}`)
    mkdirSync(resolve(target, '..'), { recursive: true }); writeFileSync(target, bytes)
  }
  writeFileSync(marker, JSON.stringify(incoming, null, 2) + '\n')
  return dir
}
