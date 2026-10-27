// dsh-feed-tools —— 把本机 dsh-feed-node 的能力挂成 agent 工具
//
// 需要先在本机跑起 dsh-feed-node（默认 http://127.0.0.1:8787）。
// 如果 agent 跑在云端，用反向 SSH 隧道把 8787 映射到云端，再把 FEED_NODE_URL 指过去。
import { loadHostDeps } from './hostdeps.mjs'

const hostDeps = await loadHostDeps()
const defineTool = hostDeps.defineTool

export const name = 'feed-tools'
export const inject = ['tools']

const BASE = String(process.env.FEED_NODE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '')

async function get(pathAndQuery) {
  const res = await fetch(`${BASE}${pathAndQuery}`, { signal: AbortSignal.timeout(200000) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.ok === false) throw new Error(body.error || `feed node HTTP ${res.status}`)
  return body
}

export function apply(ctx) {
  const textOutput = {
    schema: { type: 'object', properties: {}, additionalProperties: true },
    render: (_args, value) => [{
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }],
  }

  const tool = (spec) => ctx.tools.register(defineTool({
    ...spec,
    output: textOutput,
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
    name: 'feed_health',
    description: '检查本机取数节点是否在线、小红书/抖音是否已登录。用小红书/抖音工具之前先看一眼。',
    parameters: {},
    async execute() {
      return get('/health')
    },
  })

  tool({
    name: 'xhs_search',
    description: '在小红书搜笔记（走用户电脑上的取数节点）。返回标题/作者/日期/点赞。',
    parameters: {
      keyword: { type: 'string', description: '搜索关键词（短词更好：猫粮、通勤穿搭、露营装备）' },
    },
    async execute(args) {
      const kw = String(args.keyword || '').trim()
      if (!kw) throw new Error('keyword is required')
      const r = await get(`/search?site=xhs&q=${encodeURIComponent(kw)}`)
      return { keyword: kw, count: r.count, items: r.items, screenshot: r.screenshot, needCaptcha: r.needCaptcha }
    },
  })

  tool({
    name: 'xhs_page',
    description: '打开一个小红书/抖音链接，读它的标题和正文（最多 8000 字）。',
    parameters: {
      url: { type: 'string', description: '笔记 / 视频链接' },
    },
    async execute(args) {
      const url = String(args.url || '').trim()
      if (!/^https?:\/\//.test(url)) throw new Error('invalid url')
      const r = await get(`/fetch?url=${encodeURIComponent(url)}`)
      return { url: r.url, title: r.title, text: r.text, screenshot: r.screenshot }
    },
  })

  tool({
    name: 'dy_search',
    description: '在抖音搜视频（走用户电脑上的取数节点）。返回时长/点赞/标题/作者/日期。',
    parameters: {
      keyword: { type: 'string', description: '搜索关键词' },
    },
    async execute(args) {
      const kw = String(args.keyword || '').trim()
      if (!kw) throw new Error('keyword is required')
      const r = await get(`/search?site=dy&q=${encodeURIComponent(kw)}`)
      return { keyword: kw, count: r.count, items: r.items, screenshot: r.screenshot, needCaptcha: r.needCaptcha }
    },
  })

  tool({
    name: 'dy_hot',
    description: '抖音热榜（当前最热的视频/话题，带标题和热度）。比搜索更稳。',
    parameters: {},
    async execute() {
      const r = await get('/hot')
      return { count: r.count, items: r.items, screenshot: r.screenshot }
    },
  })
}
