// dsh-feed-node：本机取数节点
// 用你自己已登录的浏览器 + 家庭宽带 IP，给 DSH agent 提供 小红书/抖音 的搜索与页面读取。
// 只监听 127.0.0.1，云端通过反向 SSH 隧道访问（不暴露公网）。
//
// 环境变量：
//   FEED_PORT / XHS_PORT  监听端口（默认 8787）
//   PROFILE_DIR           浏览器用户目录（默认 ./profile，登录态存这里）
//   SHOTS_DIR             截图目录（默认 ./shots）
//   BROWSER_PATH/EDGE_PATH  Edge/Chrome 可执行文件
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const PORT = Number(process.env.FEED_PORT || process.env.XHS_PORT || 8787)
const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const PROFILE = process.env.PROFILE_DIR || path.join(ROOT, 'profile')
const SHOTS = process.env.SHOTS_DIR || path.join(ROOT, 'shots')
const EDGE = process.env.BROWSER_PATH || process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

fs.mkdirSync(SHOTS, { recursive: true })

let context = null
let opening = null

async function ensureBrowser() {
  if (context) return context
  if (opening) return opening
  opening = (async () => {
    const ctx = await chromium.launchPersistentContext(PROFILE, {
      executablePath: EDGE,
      headless: false,
      viewport: { width: 1400, height: 1000 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      args: [
        '--window-position=-32000,-32000',
        '--window-size=1400,1000',
        '--disable-blink-features=AutomationControlled',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=CalculateNativeWinOcclusion',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    })
    context = ctx
    // 反自动化检测：抹掉 navigator.webdriver 等特征（抖音对这个很敏感）
    await ctx.addInitScript(() => {
      try {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      } catch {}
      try {
        if (!window.chrome) window.chrome = { runtime: {} }
      } catch {}
      try {
        Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] })
      } catch {}
      try {
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
      } catch {}
    })
    opening = null
    return ctx
  })()
  return opening
}

function json(res, code, obj) {
  const body = JSON.stringify(obj, null, 2)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

function safeName(s) {
  return String(s).replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 40)
}

const SITES = {
  xhs: {
    domain: 'https://www.xiaohongshu.com',
    home: 'https://www.xiaohongshu.com/explore',
    search: (q) => 'https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(q) + '&source=web_explore_feed',
  },
  dy: {
    domain: 'https://www.douyin.com',
    home: 'https://www.douyin.com/',
    search: (q) => 'https://www.douyin.com/search/' + encodeURIComponent(q),
  },
}

function sessionNames(site) {
  return site === 'xhs' ? ['web_session'] : ['sessionid', 'sessionid_ss']
}

async function isLoggedIn(site) {
  const ctx = await ensureBrowser()
  if (site === 'xhs') {
    // 用小红书的 /user/me 接口判断（游客也会带 web_session，只看 cookie 会误判）
    const page = await ctx.newPage()
    try {
      const res = await page.evaluate(async () => {
        try {
          const r = await fetch('https://edith.xiaohongshu.com/api/sns/web/v2/user/me', { credentials: 'include' })
          return await r.json()
        } catch (e) {
          return { error: String(e) }
        }
      })
      if (res && res.success && res.data && res.data.guest === false) return true
      if (res && res.success && res.data && res.data.user_id) return true
    } catch {}
    finally { await page.close().catch(() => {}) }
  }
  const cfg = SITES[site]
  const cookies = await ctx.cookies(cfg.domain)
  const want = sessionNames(site)
  return cookies.some((c) => want.includes(c.name) && c.value && c.value.length > 8)
}

async function loginState() {
  const out = {}
  for (const site of ['xhs', 'dy']) {
    out[site] = await isLoggedIn(site).catch(() => false)
  }
  return out
}

/** 从页面里抽卡片：按「卡片容器」抓，一张卡一条，去重。 */
async function extractCards(page, site) {
  return page.evaluate((siteName) => {
    const out = []
    const seen = new Set()
    const pattern = siteName === 'xhs' ? /\/explore\/[0-9a-f]{16,}/i : /\/video\/\d{6,}/i
    const push = (href, text) => {
      const t = (text || '').trim().replace(/\s+/g, ' ')
      if (t.length < 6 || seen.has(t)) return
      seen.add(t)
      const abs = !href ? '' : href.startsWith('http') ? href : 'https://www.' + (siteName === 'xhs' ? 'xiaohongshu.com' : 'douyin.com') + href
      out.push({ href: abs, text: t.slice(0, 200) })
    }
    // 路径 1：按链接抓（小红书稳定；抖音有时也能命中）
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || ''
      if (!pattern.test(href)) continue
      let card = a
      for (let i = 0; i < 6 && card.parentElement; i++) {
        const parent = card.parentElement
        const notes = [...parent.querySelectorAll('a[href]')].filter((x) => pattern.test(x.getAttribute('href') || ''))
        if (notes.length > 1) break
        card = parent
      }
      push(href, card.innerText)
      if (out.length >= 20) return out
    }
    // 路径 2（抖音）：按卡片文字特征抓（卡片不是 <a>，class 是哈希值靠不住）
    if (out.length === 0 && siteName === 'dy') {
      const seenText = new Set()
      for (const el of document.querySelectorAll('div')) {
        const t = (el.innerText || '').trim().replace(/\s+/g, ' ')
        if (t.length < 10 || t.length > 300) continue
        if (!/^(\d{1,2}:\d{2}|\d{2}:\d{2}:\d{2}|图文|共创)/.test(t)) continue
        if (!t.includes('@')) continue
        if (seenText.has(t)) continue
        // 只保留"最小的那个"（子元素重复时跳过包含它的更大块）
        seenText.add(t)
        if (out.some((x) => x.text.includes(t) || t.includes(x.text))) continue
        out.push({ href: '', text: t.slice(0, 200) })
        if (out.length >= 20) break
      }
    }
    return out
  }, site)
}

/** 登录：开一个页保持打开，截图后立刻返回；后台轮询登录态。 */
const loginSessions = new Map()

async function doLogin(site) {
  const cfg = SITES[site]
  if (!cfg) throw new Error('site 只能是 xhs / dy')
  if (loginSessions.has(site)) {
    const prev = loginSessions.get(site)
    try { await prev.page.close() } catch {}
    loginSessions.delete(site)
  }
  const ctx = await ensureBrowser()
  const page = await ctx.newPage()
  await page.goto(cfg.home, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(6000)
  const file = path.join(SHOTS, 'login-' + site + '-' + Date.now() + '.png')
  await page.screenshot({ path: file, fullPage: false })
  const session = { page, file, loggedIn: false, startedAt: Date.now(), closed: false }
  loginSessions.set(site, session)

  // 后台轮询：登录成功或超过 5 分钟就收尾
  ;(async () => {
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      if (session.closed) return
      try {
        const ok = await isLoggedIn(site)
        if (ok) {
          session.loggedIn = true
          break
        }
      } catch {}
    }
    session.closed = true
    try { await page.close() } catch {}
    session.done = true
  })()

  return { site, screenshot: file, waiting: true, hint: '扫码后轮询 /login-status 查结果' }
}

function loginStatus(site) {
  const s = loginSessions.get(site)
  if (!s) return { site, active: false, loggedIn: false }
  return {
    site,
    active: !s.closed,
    loggedIn: s.loggedIn,
    waitedSeconds: Math.round((Date.now() - s.startedAt) / 1000),
    screenshot: s.file,
  }
}

async function doHot() {
  const ctx = await ensureBrowser()
  const page = await ctx.newPage()
  try {
    await page.goto('https://www.douyin.com/hot', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(12000)
    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 1800).catch(() => {})
      await page.waitForTimeout(1500)
    }
    const items = await page.evaluate(() => {
      const out = []
      const seen = new Set()
      for (const a of document.querySelectorAll('a[href*="/video/"]')) {
        const href = a.getAttribute('href') || ''
        let card = a
        for (let i = 0; i < 5 && card.parentElement; i++) {
          const parent = card.parentElement
          if (parent.querySelectorAll('a[href*="/video/"]').length > 1) break
          card = parent
        }
        const text = (card.innerText || '').trim().replace(/\s+/g, ' ')
        if (text.length < 4) continue
        const key = href + '|' + text
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ href: href.startsWith('http') ? href : 'https://www.douyin.com' + href, text: text.slice(0, 200) })
        if (out.length >= 30) break
      }
      return out
    })
    const file = path.join(SHOTS, 'douyin-hot-' + Date.now() + '.png')
    await page.screenshot({ path: file, fullPage: false })
    return { count: items.length, items, screenshot: file, url: page.url() }
  } finally {
    await page.close().catch(() => {})
  }
}

async function doSearch(site, keyword) {
  const cfg = SITES[site]
  if (!cfg) throw new Error('site 只能是 xhs / dy')
  if (!keyword) throw new Error('keyword 不能为空')
  const ctx = await ensureBrowser()
  let page = await ctx.newPage()
  const captured = []
  // 抖音：拦它自己的搜索接口响应（浏览器发的请求带合法签名，我们只读结果）
  page.on('response', async (resp) => {
    const u = resp.url()
    if (!/(search\/single|general\/search|search\/item)/i.test(u)) return
    try {
      const j = await resp.json()
      if (j) captured.push(j)
    } catch {}
  })
  try {
    const startUrl = site === 'dy' ? 'https://www.douyin.com/hot' : cfg.search(keyword)
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(9000)
    await page.keyboard.press('Escape').catch(() => {})
    // 抖音：逐字输入 → 等联想 → 优先点联想项，其次点搜索按钮，最后才回车
    if (site === 'dy') {
      const input = (await page.$('input[placeholder*="搜索"]')) || (await page.$('input[data-e2e*="search"]')) || (await page.$('input[type="text"]'))
      const tried = []
      if (input) {
        await input.click({ timeout: 8000 }).catch(() => {})
        await page.keyboard.type(keyword, { delay: 90 }).catch(() => {})
        await page.waitForTimeout(1500)
        // 1) 点联想词（第一个）
        const sugg = await page.$$('[class*="suggest"] li, [class*="Suggest"] li, [class*="search-item"], [role="option"]')
        if (sugg.length > 0) {
          await sugg[0].click({ timeout: 5000 }).catch(() => {})
          tried.push('suggestion')
        }
        await page.waitForTimeout(6000)
        if (!page.url().includes('/search')) {
          // 2) 点搜索按钮
          const btn = (await page.$('[data-e2e="searchbar-button"]')) || (await page.$('button[class*="search"]')) || (await page.$('[class*="search"] button'))
          if (btn) { await btn.click({ timeout: 5000 }).catch(() => {}); tried.push('button') }
          await page.waitForTimeout(8000)
        }
        if (!page.url().includes('/search')) {
          // 3) 回车兜底
          await input.press('Enter').catch(() => {})
          tried.push('enter')
          await page.waitForTimeout(8000)
        }
      }
      var dyTried = tried
      var dyUrl = page.url()
      // 搜索可能开在新标签页：切过去
      const ctxPages = ctx.pages()
      const searchPage = ctxPages.find((p) => p.url().includes('/search'))
      if (searchPage && searchPage !== page) {
        await searchPage.waitForTimeout(14000).catch(() => {})
        page = searchPage
        dyTried.push('new-tab')
        dyUrl = page.url()
      }
    }
    // 滚动触发加载（抖音列表在内部滚动容器里）
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 2000).catch(() => {})
      await page.keyboard.press('PageDown').catch(() => {})
      await page.waitForTimeout(1800)
    }
    const body0 = await page.evaluate(() => document.body.innerText || '')
    const needLogin = body0.includes('登录后查看搜索结果')
    let items = needLogin ? [] : await extractCards(page, site)
    // 从抓到的 JSON 里挖抖音视频
    if (site === 'dy') {
      const found = []
      const seen = new Set()
      const walk = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > 8) return
        if (Array.isArray(node)) { for (const x of node) walk(x, depth + 1); return }
        const id = node.aweme_id || node.awemeId
        const desc = node.desc || node.title
        if (id && desc && String(id).length >= 8) {
          if (!seen.has(id)) {
            seen.add(id)
            const author = node.author && (node.author.nickname || node.author.unique_id)
            const stats = node.statistics || {}
            const likes = stats.digg_count || stats.diggCount
            found.push({
              href: 'https://www.douyin.com/video/' + id,
              text: [String(desc), author ? '@' + author : '', likes ? likes + ' 赞' : ''].filter(Boolean).join(' · ').slice(0, 220),
            })
          }
        }
        for (const k of Object.keys(node)) walk(node[k], depth + 1)
      }
      for (const j of captured) walk(j, 0)
      if (found.length > 0) items = found.slice(0, 20)
    }
    const file = path.join(SHOTS, 'search-' + site + '-' + safeName(keyword) + '-' + Date.now() + '.png')
    await page.screenshot({ path: file, fullPage: false })
    return {
      site,
      keyword,
      url: page.url(),
      needLogin,
      count: items.length,
      items,
      caught: captured.length,
      tried: typeof dyTried !== 'undefined' ? dyTried : undefined,
      dyUrl: typeof dyUrl !== 'undefined' ? dyUrl : undefined,
      debug: captured.slice(0, 3).map((j) => ({ keys: Object.keys(j).slice(0, 12), sample: JSON.stringify(j).slice(0, 400) })),
      screenshot: file,
      bodyHead: body0.slice(0, 200).replace(/\s+/g, ' '),
    }
  } finally {
    await page.close().catch(() => {})
  }
}

async function doFetch(url) {
  if (!/^https?:\/\//.test(url)) throw new Error('url 不合法')
  const ctx = await ensureBrowser()
  const page = await ctx.newPage()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(7000)
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 1500).catch(() => {})
      await page.waitForTimeout(1200)
    }
    const data = await page.evaluate(() => ({
      title: document.title,
      text: (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 8000),
    }))
    const file = path.join(SHOTS, 'page-' + Date.now() + '.png')
    await page.screenshot({ path: file, fullPage: false })
    return { url: page.url(), title: data.title, text: data.text, screenshot: file }
  } finally {
    await page.close().catch(() => {})
  }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1')
  try {
    if (u.pathname === '/health') {
      return json(res, 200, { ok: true, login: await loginState(), profile: PROFILE, shots: SHOTS })
    }
    if (u.pathname === '/hot') {
      return json(res, 200, { ok: true, ...(await doHot()) })
    }
    if (u.pathname === '/login') {
      return json(res, 200, { ok: true, ...(await doLogin(u.searchParams.get('site') || 'xhs')) })
    }
    if (u.pathname === '/show-url') {
      const url = u.searchParams.get('url')
      if (!url) return json(res, 400, { ok: false, error: '需要 url' })
      const ctx = await ensureBrowser()
      const page = await ctx.newPage()
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.bringToFront().catch(() => {})
      const cdp = await ctx.newCDPSession(page)
      const { windowId } = await cdp.send('Browser.getWindowForTarget')
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 80, top: 60, width: 1280, height: 900, windowState: 'normal' } })
      await page.waitForTimeout(4000)
      const file = path.join(SHOTS, 'showurl-' + Date.now() + '.png')
      await page.screenshot({ path: file, fullPage: false }).catch(() => {})
      return json(res, 200, { ok: true, url: page.url(), screenshot: file, hint: '窗口已显示，手动完成验证后告诉我' })
    }
    if (u.pathname === '/diag') {
      const url = u.searchParams.get('url') || 'https://www.douyin.com/'
      const ctx = await ensureBrowser()
      const page = await ctx.newPage()
      const failed = []
      const consoleMsgs = []
      page.on('requestfailed', (r) => failed.push({ url: r.url().slice(0, 160), err: r.failure()?.errorText }))
      page.on('console', (m) => { if (m.type() === 'error') consoleMsgs.push(m.text().slice(0, 200)) })
      page.on('response', (r) => { if (r.status() >= 400) failed.push({ url: r.url().slice(0, 160), err: 'HTTP ' + r.status() }) })
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await page.waitForTimeout(12000)
        const body = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ').slice(0, 200)
        return json(res, 200, { ok: true, url: page.url(), body, failedCount: failed.length, failed: failed.slice(0, 15), console: consoleMsgs.slice(0, 10) })
      } finally { await page.close().catch(() => {}) }
    }
    if (u.pathname === '/restart') {
      try { await context?.close() } catch {}
      context = null
      opening = null
      await ensureBrowser()
      return json(res, 200, { ok: true, restarted: true })
    }
    if (u.pathname === '/shot') {
      const url = u.searchParams.get('url') || 'https://www.douyin.com/'
      const ctx = await ensureBrowser()
      const page = await ctx.newPage()
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await page.waitForTimeout(9000)
        const file = path.join(SHOTS, 'shot-' + Date.now() + '.png')
        await page.screenshot({ path: file, fullPage: false })
        const body = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ').slice(0, 200)
        return json(res, 200, { ok: true, url: page.url(), screenshot: file, body })
      } finally { await page.close().catch(() => {}) }
    }
    if (u.pathname === '/dom') {
      const url = u.searchParams.get('url') || ''
      const ctx = await ensureBrowser()
      const page = await ctx.newPage()
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await page.waitForTimeout(8000)
        const info = await page.evaluate(() => {
          const anchors = [...document.querySelectorAll('a[href]')]
          const vid = anchors.filter((a) => /\/video\//.test(a.getAttribute('href') || ''))
          const lis = [...document.querySelectorAll('li')]
          const dataE2e = [...new Set([...document.querySelectorAll('[data-e2e]')].map((e) => e.getAttribute('data-e2e')))].slice(0, 30)
          // 找含 @ 作者名的块，往上取 3 层看 class
          const atEls = [...document.querySelectorAll('div,span,p')].filter((e) => /^@/.test((e.innerText || '').trim())).slice(0, 6)
          const atInfo = atEls.map((e) => {
            let box = e
            for (let i = 0; i < 3 && box.parentElement; i++) box = box.parentElement
            return { cls: String(box.className).slice(0, 80), text: (box.innerText || '').replace(/\s+/g, ' ').slice(0, 120), children: box.children.length }
          })
          return {
            anchorCount: anchors.length,
            videoAnchorCount: vid.length,
            videoSamples: vid.slice(0, 5).map((a) => a.getAttribute('href')),
            liCount: lis.length,
            liSamples: lis.slice(0, 5).map((l) => ({ cls: String(l.className).slice(0, 60), text: (l.innerText || '').replace(/\s+/g, ' ').slice(0, 80) })),
            dataE2e,
            atInfo,
            bodyHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
          }
        })
        return json(res, 200, { ok: true, ...info })
      } finally { await page.close().catch(() => {}) }
    }
    if (u.pathname === '/show') {
      const ctx = await ensureBrowser()
      const page = await ctx.newPage()
      try {
        await page.goto(SITES[u.searchParams.get('site') || 'xhs'].home, { waitUntil: 'domcontentloaded', timeout: 60000 })
        await page.bringToFront()
        const cdp = await ctx.newCDPSession(page)
        const { windowId } = await cdp.send('Browser.getWindowForTarget')
        await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: 80, top: 60, width: 1280, height: 860, windowState: 'normal' } })
        return json(res, 200, { ok: true, shown: true, url: page.url() })
      } finally {
        // 页面保持打开，供用户手动登录
      }
    }
    if (u.pathname === '/whoami') {
      const ctx = await ensureBrowser()
      const page = await ctx.newPage()
      try {
        const me = await page.evaluate(async () => {
          try {
            const r = await fetch('https://edith.xiaohongshu.com/api/sns/web/v2/user/me', { credentials: 'include' })
            return await r.json()
          } catch (e) { return { error: String(e) } }
        })
        return json(res, 200, { ok: true, me })
      } finally { await page.close().catch(() => {}) }
    }
    if (u.pathname === '/login-status') {
      return json(res, 200, { ok: true, ...loginStatus(u.searchParams.get('site') || 'xhs') })
    }
    if (u.pathname === '/search') {
      const site = u.searchParams.get('site') || 'xhs'
      return json(res, 200, { ok: true, ...(await doSearch(site, u.searchParams.get('q') || '')) })
    }
    if (u.pathname === '/fetch') {
      return json(res, 200, { ok: true, ...(await doFetch(u.searchParams.get('url') || '')) })
    }
    json(res, 404, { ok: false, error: 'not found' })
  } catch (error) {
    json(res, 500, { ok: false, error: String((error && error.message) || error) })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('[xhs-node] listening on http://127.0.0.1:' + PORT)
})
