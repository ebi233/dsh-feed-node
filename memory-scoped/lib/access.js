import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { loadHostDeps } from './hostdeps.mjs'
import { groupIdentity } from './group-privacy.mjs'

const { scopeParentOf } = await loadHostDeps()

export const home = process.env.DSH_HOME || join(homedir(), '.dsh')
export function readJSON(file) {
  return JSON.parse(readFileSync(join(home, file), 'utf8'))
}
export function atomicJSON(file, data) {
  const path = join(home, file)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const tmp = `${path}.${randomUUID()}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, path)
}
function directIdentity(agent) {
  const sid = String(agent?.session?.header?.id || agent?.id || '')
  const unknown = { role: 'unknown', session: sid, name: '你', known: false }
  if (!/^session-[a-zA-Z0-9-]+$/.test(sid)) return unknown
  try {
    const conf = readJSON('qq-bridge-config.json')
    const group = groupIdentity(sid, conf)
    if (group) return { ...unknown, ...group }
    const owner = String(conf.主人号码 || '')
    if (!owner) return unknown
    const bindings = Array.isArray(conf.绑定) ? conf.绑定 : []
    const own = bindings.filter(b => b.类型 === '私聊' && String(b.号码) === owner)
    const ownerSessions = new Set(own.map(b => b.会话))
    if (String(conf.私聊QQ) === owner) ownerSessions.add(conf.私聊会话 || conf.目标会话)
    const guests = readJSON('guests.json')
    const peers = Object.entries(guests).filter(([, g]) => g?.session === sid)
    const routes = bindings.filter(b => b.会话 === sid)
    // Any conflicting route fails closed, including an owner room assigned to a guest.
    if (ownerSessions.has(sid)) {
      if (peers.length || routes.some(b => b.类型 !== '私聊' || String(b.号码) !== owner)) return { ...unknown, conflict: true }
      return { role: 'owner', session: sid, qq: owner, name: '主账号', known: true }
    }
    if (peers.length !== 1) return { ...unknown, conflict: peers.length > 1 || routes.length > 0 }
    const [qq, guest] = peers[0]
    if (!/^\d+$/.test(qq) || qq === owner || routes.some(b => b.类型 !== '私聊' || String(b.号码) !== qq)) return { ...unknown, conflict: true }
    return { role: 'guest', session: sid, qq, name: String(guest.name || '').slice(0, 20), known: Boolean(guest.name || guest.nameDeclined) }
  } catch { return unknown }
}
export function identity(agent) {
  const own = directIdentity(agent)
  if (own.role !== 'unknown' || own.conflict) return own
  // Only trusted framework lineage grants owner authority; never a tool argument,
  // nickname, chat text, or model-supplied parent/session identifier.
  const seen = new Set()
  let parent = agent && scopeParentOf?.(agent)
  while (parent && !seen.has(parent)) {
    seen.add(parent)
    const who = directIdentity(parent)
    if (who.conflict || who.role === 'guest' || who.role === 'group') return own
    if (who.role === 'owner') return { ...who, session: own.session, inherited: true }
    parent = scopeParentOf?.(parent)
  }
  return own
}
export const groupTools = new Set(['qq_read_document', 'conversation_recall', 'conversation_fact', 'conversation_topic', 'qq_reply_gate', 'qq_set_own_group_card', 'describe_image', 'public_bili_read'])
export const guestTools = new Set(['qq_read_document', 'conversation_recall', 'conversation_fact', 'correct_long_memory', 'conversation_topic', 'guest_set_name', 'remember_forever', 'list_long_memory', 'forget_long_memory'])
export function deniedTool(exec) {
  const who = identity(exec?.agent)
  if (who.role === 'owner') return undefined
  if (who.role === 'group' && groupTools.has(exec?.name)) return undefined
  if (who.role === 'guest' && guestTools.has(exec.name)) return undefined
  return '当前会话只能聊天和管理自己的访客记忆，不能访问主账号资料、其他会话或管理工具'
}
export function setGuestName(agent, args) {
  const who = identity(agent)
  if (who.role !== 'guest') throw new Error('只允许已绑定的访客修改自己的称呼')
  const declined = args.declined === true
  const name = String(args.name || '').replace(/[\r\n\u0000-\u001f]/g, '').trim().slice(0, 20)
  if (!declined && !name) throw new Error('名字不能为空')
  const guests = readJSON('guests.json')
  if (guests[who.qq]?.session !== who.session) throw new Error('访客绑定已变化')
  guests[who.qq].name = declined ? '' : name
  guests[who.qq].nameDeclined = declined
  atomicJSON('guests.json', guests)
  return { saved: true, name: declined ? '你' : name }
}
