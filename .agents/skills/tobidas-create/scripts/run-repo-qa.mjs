#!/usr/bin/env node
// Invoke the repository's existing verification scripts for the type of work.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const value = (name, fallback = '') => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const findRepo = (start) => {
  let current = path.resolve(start)
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))
      && fs.existsSync(path.join(current, 'scripts', 'screenshot.mjs'))
      && fs.existsSync(path.join(current, 'scripts', 'shoot-holds.mjs'))) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}
const run = (command, commandArgs, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, commandArgs, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, TOBIDAS_CREATE_REPO_ROOT: cwd },
  })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${commandArgs.join(' ')} exited with code ${code}`)))
})

const repo = value('repo', findRepo(process.cwd()))
if (!repo) throw new Error('Could not find the tobidas repository. Specify it with --repo.')
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundledScreenshot = path.join(skillRoot, 'scripts', 'verification', 'screenshot.mjs')
const bundledHolds = path.join(skillRoot, 'scripts', 'verification', 'shoot-holds.mjs')
const project = value('project')
if (!project) throw new Error('--project <work-folder-or-public-sample-id> is required')
const out = value('out', path.join('shots', 'tobidas-create'))
const phases = value('phases', '0,0.5,1')
let absoluteProject = path.resolve(repo, project)
if (!fs.existsSync(absoluteProject) && fs.existsSync(path.join(repo, 'projects', project))) {
  absoluteProject = path.join(repo, 'projects', project)
}
const publicRoot = path.join(repo, 'projects')
const isPublicProject = absoluteProject.startsWith(`${publicRoot}${path.sep}`)
const stowLayoutScript = path.join(repo, 'scripts', 'verify-stow-layout.mjs')
const runStowLayoutCheck = async () => {
  if (!fs.existsSync(stowLayoutScript)) return
  await run(process.execPath, [stowLayoutScript, absoluteProject], repo)
}

if (isPublicProject) {
  const id = path.relative(publicRoot, absoluteProject).replaceAll(path.sep, '/')
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'samples:generate'], repo)
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'samples:check'], repo)
  await run(process.execPath, ['scripts/verify-builder-ai-mode.mjs'], repo)
  await runStowLayoutCheck()
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'qa:holds', '--', id, '--out', out, '--phases', phases, '--turns'], repo)
} else {
  if (!fs.existsSync(path.join(absoluteProject, 'project.json'))) throw new Error(`project.json not found: ${absoluteProject}`)
  await runStowLayoutCheck()
  await run(process.execPath, [bundledHolds, absoluteProject, '--out', out, '--phases', phases, '--turns'], repo)
  await run(process.execPath, [bundledScreenshot, '--project', absoluteProject, '--scroll', '0.5', '--out', path.join(out, 'mid.png')], repo)
  console.log('Checked hold times and page transitions for the standalone work with the bundled screenshot.mjs and shoot-holds.mjs scripts.')
}
