// dsh-long-memory —— 永久记忆
//
// 和「会淡忘的记忆」互补：这个 lane 里的东西**永远在系统提示里**，不检索、不衰减。
// 每条带日期，条目上限控制长度；超了会提示她（或你）去清理。
//
// 文件：$DSH_HOME/memory-long.md（默认 ~/.dsh/memory-long.md）
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { loadHostDeps } from './hostdeps.mjs'

const hostDeps = await loadHostDeps()
const defineTool = hostDeps.defineTool

export const name = 'long-memory'
export const inject = ['systemPrompt', 'tools', 'webServer']

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const FILE = process.env.LONG_MEMORY_FILE || join(DSH_HOME, 'memory-long.md')
const MAX_ITEMS = Number(process.env.LONG_MEMORY_MAX || 60)

function readAll() {
  try {
    if (!existsSync(FILE)) return []
    return readFileSync(FILE, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('- '))
  } catch {
    return []
  }
}

function render() {
  const items = readAll().slice(-MAX_ITEMS)
  if (items.length === 0) return ''
  return ['【长期记忆｜永久，别忘、也别反驳】', ...items].join('\n')
}

export function apply(ctx) {
  // 每轮组装提示词时现读文件（不动配置、不用重启）
  ctx.systemPrompt.section({
    name: 'long-memory',
    order: 860,
    text: () => render(),
  })

  const tool = (spec) => ctx.tools.register(defineTool({
    ...spec,
    output: {
      schema: { type: 'object', properties: {}, additionalProperties: true },
      render: (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
    },
    async execute(args) {
      try {
        const data = await spec.execute(args || {})
        return { ok: true, ...(data && typeof data === 'object' ? data : { result: data }) }
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error) }
      }
    },
  }))

  tool({
    name: 'remember_forever',
    description: '把一件事写进永久记忆（每轮都会出现在你的系统提示里，永不遗忘）。'
      + '只用来记「长期成立的」：身份、边界、约定、重要偏好、反复提到的忌讳。'
      + '一次性的小事不要写。',
    parameters: {
      text: { type: 'string', description: '一句话，例如「老哥讨厌被反问，问句少用」' },
    },
    async execute(args) {
      const text = String(args.text || '').trim()
      if (text === '') throw new Error('text 不能为空')
      if (text.length > 200) throw new Error('太长，一句话就行')
      const d = new Date()
      const p = (n) => String(n).padStart(2, '0')
      const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
      if (!existsSync(FILE)) writeFileSync(FILE, '# 永久记忆（每条都会进系统提示）\n\n', 'utf8')
      appendFileSync(FILE, `- ${text}（${stamp}）\n`, 'utf8')
      const count = readAll().length
      return { saved: true, count, hint: count > MAX_ITEMS ? '条目已超上限，旧的不再注入，建议清理' : undefined }
    },
  })

  tool({
    name: 'list_long_memory',
    description: '看看永久记忆里都有什么（带编号，方便删）。',
    parameters: {},
    async execute() {
      return { items: readAll().map((t, i) => ({ index: i + 1, text: t })) }
    },
  })

  tool({
    name: 'forget_long_memory',
    description: '删掉永久记忆里的一条（要编号，用 list_long_memory 查）。',
    parameters: {
      index: { type: 'number', description: '第几条（从 1 开始）' },
    },
    async execute(args) {
      const items = readAll()
      const i = Number(args.index) - 1
      if (!Number.isInteger(i) || i < 0 || i >= items.length) throw new Error('编号不对')
      const keep = items.filter((_, k) => k !== i)
      writeFileSync(FILE, '# 永久记忆（每条都会进系统提示）\n\n' + keep.map((t) => t + '\n').join(''), 'utf8')
      return { removed: items[i], left: keep.length }
    },
  })

  // 诊断：确认插件活了、文件在哪、现在注入什么
  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-long-memory/state',
      handler: async (req, res) => {
        const body = JSON.stringify({
          ok: true,
          file: FILE,
          count: readAll().length,
          maxItems: MAX_ITEMS,
          injected: render().slice(0, 500),
        }, null, 2)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(body)
      },
    }))
  } catch (error) {
    console.warn('[long-memory] 诊断路由注册失败：' + String((error && error.message) || error))
  }
}
