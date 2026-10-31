// 从宿主那棵树里取 @deepseek-ai/dsh-tools 的 defineTool（拿不到就用等价实现）。
// 起因：桌面/云端 profile 用 autoInstallPeers=false，裸 import 会让整条插件不激活。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SELF_MODULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@deepseek-ai')

export function candidateRoots() {
  const out = []
  const push = (p) => { if (p && !out.includes(p)) out.push(p) }
  push(process.env.DSH_HOST_MODULES)
  push('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  push('/usr/local/lib/node_modules/@deepseek-ai')
  push('/usr/lib/node_modules/@deepseek-ai')
  try {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    for (const p of readdirSync(join(dshHome, 'profiles'))) {
      push(join(dshHome, 'profiles', p, 'node_modules', '@deepseek-ai'))
    }
  } catch { /* ignore */ }
  push(SELF_MODULES)
  return out
}

function entryUrlFor(root, name) {
  try {
    const dir = join(root, name)
    const pkgFile = join(dir, 'package.json')
    if (!existsSync(pkgFile)) return null
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
    const dot = pkg.exports?.['.']
    const rel = typeof dot === 'string' ? dot : (dot?.import || dot?.default || pkg.module || pkg.main)
    if (!rel) return null
    const file = join(dir, String(rel).replace(/^\.\//, ''))
    return existsSync(file) ? pathToFileURL(file).href : null
  } catch { return null }
}

async function fromHostTree(name, log) {
  for (const root of candidateRoots()) {
    if (root === SELF_MODULES) continue
    const url = entryUrlFor(root, name)
    if (!url) continue
    try {
      const mod = await import(url)
      log(`${name}: host tree ok`)
      return mod
    } catch { /* try next */ }
  }
  return null
}

function localDefineTool(options) {
  return options
}

export async function loadHostDeps() {
  const notes = []
  const log = (m) => notes.push(m)
  let z = null
  let defineTool = null
  const dt = await fromHostTree('dsh-tools', log)
  if (dt) defineTool = dt.defineTool
  if (!defineTool) {
    try {
      const mod = await import('@deepseek-ai/dsh-tools')
      defineTool = mod.defineTool
      log('dsh-tools: own dependency')
    } catch {
      defineTool = localDefineTool
      log('dsh-tools: fallback')
    }
  }
  const scope = await fromHostTree('dsh-scope', log)
  return { z, defineTool, notes, scopeParentOf: scope?.scopeParentOf }
}
