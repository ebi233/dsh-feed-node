# dsh-feed-node · 小红书 / 抖音取数节点

[English](README.en.md) | 中文

> 让 DeepSeek Harness 里的 AI 伙伴能"刷小红书、刷抖音"——用**你自己已登录的浏览器**和**家庭宽带 IP** 去抓，抓到的结果再交给 agent。

---

## 为什么需要这个

把小红书 / 抖音接到云端 agent 上，通常第一步就撞墙：

| 做法 | 结果 |
| --- | --- |
| 云服务器直接请求 | 小红书 `IP at risk (300012)`；抖音 `验证码中间页` |
| 抓网页接口 | 两边都有签名参数（`x-s` / `a_bogus`），随时失效 |
| 无头浏览器硬刷 | 滑块验证码 + 指纹识别，几乎必拦 |

**根本原因是机房 IP。** 平台对云厂商网段有风控，跟你写得多好没关系。

所以这个项目的思路是：**把"打开网页"这件事留在你的家用电脑上**（干净 IP + 真人登录态），只把**结果**通过一条反向隧道送回云端 agent。

```
┌──────────────────────┐        反向 SSH 隧道         ┌────────────────────┐
│  你的电脑 (家庭 IP)    │   ssh -R 18787:127.0.0.1:8787  │  云服务器            │
│                      │  ◄─────────────────────────  │                    │
│  dsh-feed-node :8787 │                              │  DSH (agent)       │
│  Edge + 你的登录态     │  ──── HTTP (本机回环) ────►   │  dsh-feed-tools    │
└──────────────────────┘                              └────────────────────┘
```

---

## 云端 / 本地都通用

这个项目拆成两半，**只有"怎么连"不同**：

| Agent 在哪 | 需要隧道吗 | 插件里的 `FEED_NODE_URL` |
| --- | --- | --- |
| **本机**（DSH 桌面版） | ❌ 不需要 | `http://127.0.0.1:8787` |
| **云服务器** | ✅ 反向 SSH | `http://127.0.0.1:18787` |
| 另一台机器（同局域网） | ❌ 直接开端口 | `http://<这台机器 IP>:8787` |

```
取数节点 (src/server.mjs)   ← 只关心「浏览器 + 登录态」，不知道 agent 在哪
        ↑ HTTP
DSH 插件 (plugin/)          ← 只关心「一个 URL」，不知道节点在哪
```

- **本机用最省事**：`npm start` + 插件指向 `8787`，**不需要隧道、不需要计划任务**
- **云端用多一步**：加一条反向隧道（`scripts/install-tasks.ps1` 一条命令搞定）
- 一套节点可以同时服务多个 agent（本机走 8787、云端走 18787，**共用同一份登录态**）

> ⚠️ 节点必须跑在**你自己的电脑**上（要你的家庭 IP + 你扫码的登录态）。
> **不要**把它装到云服务器上——机房 IP 会被小红书/抖音直接风控拦截，这正是本项目存在的原因。

---

## 目录结构

```
dsh-feed-node/
├── src/server.mjs          # 取数服务（Express 都不要，纯 node:http + Playwright）
├── plugin/                 # DSH 插件：把服务包成 agent 工具
│   ├── index.js
│   ├── hostdeps.mjs
│   └── cordis.patch.yml
├── scripts/
│   ├── start-node.cmd      # 启动服务（开机自启用）
│   ├── install-tasks.ps1   # 一键注册计划任务 + 生成隧道脚本
│   └── watchdog.ps1        # 看门狗：掉了自动拉起
└── README.md / README.en.md
```

---

## 需要你手动做的部分（只有 3 件事）

这套东西大部分是自动的，但**有三件事必须真人来做**：

| # | 什么时候 | 要做什么 | 大概耗时 |
| --- | --- | --- | --- |
| 1 | **第一次装完** | 给小红书、抖音各扫一次码登录（各一次，之后长期有效） | 2 分钟 |
| 2 | **偶尔**（几小时~一天一次） | 抖音弹出**滑块验证码**时，拖一下 | 10 秒 |
| 3 | **长期** | 让**电脑保持开机**（她能用的时候你电脑必须是开着的） | — |

### 具体怎么做

**① 登录（每个平台一次）**

```powershell
curl "http://127.0.0.1:8787/show?site=xhs"   # 小红书
curl "http://127.0.0.1:8787/show?site=dy"    # 抖音
```

执行后屏幕上会弹出一个浏览器窗口（在左上角），**用手机 App 扫码**即可。窗口是程序开的那个，扫码成功后登录态就存进 `profile/` 了。

验证：

```powershell
curl http://127.0.0.1:8787/health
# {"ok":true,"login":{"xhs":true,"dy":true}}
```

**② 过验证码**

抖音搜索隔一段时间会弹滑块。发现搜索返回 0 条、或 `needCaptcha: true` 时：

```powershell
# 把搜索页直接显示到屏幕上，你拖一下滑块
curl "http://127.0.0.1:8787/show-url?url=https%3A%2F%2Fwww.douyin.com%2Fsearch%2F%E5%87%8F%E8%84%82%E9%A4%90"
```

拖完等结果出来，再重新搜就行了。**这个验证不需要每天做**，通常能顶一段时间。

**③ 保持开机**

- 电脑关机 → 云端工具直接报错（这是设计如此，不是 bug）
- 电脑睡眠 → 隧道会断，但**看门狗每 5 分钟**会自动重连
- 建议：把电源计划设成"从不睡眠"，或者接受偶尔断开后自动恢复

### 完全自动的部分（不用你管）

| 动作 | 谁做的 |
| --- | --- |
| 开机后启动取数服务和隧道 | 计划任务（登录时触发） |
| 服务/隧道挂了自动重启 | 看门狗（每 5 分钟） |
| 打开页面、滚动、提取内容 | 取数服务（Playwright） |
| 把结果整理成工具返回值 | DSH 插件 |

---

## 环境要求

- **Windows 10/11**（macOS/Linux 也能跑，脚本需自己换一下）
- **Node.js ≥ 20**
- **Edge 或 Chrome**（用你平时登录小红书/抖音的那个浏览器内核即可）
- 一个能 SSH 登录的服务器（用来跑 DSH agent；**如果 agent 就在本机，可以跳过隧道这一步**）

---

## 第一步：装服务

```powershell
git clone https://github.com/ebi233/dsh-feed-node.git
cd dsh-feed-node
npm install
```

> `playwright-core` 不带浏览器，直接用你系统里的 Edge，**不需要** `npx playwright install`。

启动：

```powershell
npm start
# [dsh-feed-node] listening on http://127.0.0.1:8787
```

自检：

```powershell
curl http://127.0.0.1:8787/health
# {"ok":true,"login":{"xhs":false,"dy":false}, ...}
```

---

## 第二步：登录（每个平台一次，能管很久）

### 方式 A：把窗口拉到屏幕上扫（推荐）

```powershell
# 小红书
curl "http://127.0.0.1:8787/show?site=xhs"
# 抖音
curl "http://127.0.0.1:8787/show?site=dy"
```

窗口会出现在屏幕左上角，**用手机 App 扫码登录**。扫码期间页面一直开着，登录态会写进 `profile/` 目录，以后不用再扫。

### 方式 B：截图看二维码

```powershell
curl "http://127.0.0.1:8787/login?site=xhs"
# 返回 {"screenshot":"...\\shots\\login-xhs-1730...png"}
# 再轮询：
curl "http://127.0.0.1:8787/login-status?site=xhs"
```

> ⚠️ 小红书二维码 **约 60 秒**就换一次。用截图扫很容易扫到过期码——**优先用方式 A**，让程序把窗口显示出来。

### 验证

```powershell
curl http://127.0.0.1:8787/health
# {"ok":true,"login":{"xhs":true,"dy":true}}
```

---

## 第三步：从云端访问（反向隧道）

云端 agent 直接访问不到你家电脑，用 SSH 反向隧道把本机 8787 映射到服务器的 127.0.0.1:18787：

```powershell
ssh -i C:\path\to\id_ed25519 -N -R 18787:127.0.0.1:8787 admin@YOUR_SERVER_IP
```

**一键装成开机自启**（管理员 PowerShell）：

```powershell
.\scripts\install-tasks.ps1 -Server admin@YOUR_SERVER_IP -KeyPath C:\path\to\id_ed25519
```

它会做三件事：

| 计划任务 | 作用 |
| --- | --- |
| `DSH-Feed-Node` | 登录 Windows 时启动取数服务 |
| `DSH-Feed-Tunnel` | 登录时建立反向隧道，断了 10 秒重连 |
| `DSH-Feed-Watchdog` | **每 5 分钟**检查服务和隧道，掉了自动拉起 |

在服务器上验证：

```bash
curl http://127.0.0.1:18787/health
```

---

## 第四步：装 DSH 插件

插件在 `plugin/` 目录，装到跑 agent 的那个 profile：

```bash
# 云端（或本机，看你 agent 在哪）
dsh plugin --profile cloud add link:/path/to/dsh-feed-node/plugin
```

> 用 `link:` 安装时，插件目录要在服务器上；也可以先 `npm pack` 发到 npm 再 `add dsh-feed-tools`。

插件默认连 `http://127.0.0.1:8787`，云端场景要指向隧道端口：

```bash
# 写进 profile 的环境变量/启动环境
FEED_NODE_URL=http://127.0.0.1:18787
```

装完重启 DSH。agent 会多出这些工具：

| 工具 | 作用 |
| --- | --- |
| `feed_health` | 检查节点在线 + 两个平台登录态 |
| `xhs_search` | 搜小红书笔记 |
| `xhs_page` | 打开某条笔记/视频读正文 |
| `dy_search` | 搜抖音视频 |
| `dy_hot` | 抖音热榜（最稳的一条路） |

---

## 接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 节点状态 + 登录态 |
| GET | `/login?site=xhs\|dy` | 打开登录页，返回截图，页面保持打开 |
| GET | `/login-status?site=` | 轮询登录结果 |
| GET | `/show?site=` | 把窗口拉到屏幕上（登录 / 过验证码） |
| GET | `/show-url?url=` | 同上，打开任意 URL |
| GET | `/search?site=xhs\|dy&q=` | 搜索，返回结构化 items |
| GET | `/hot` | 抖音热榜 |
| GET | `/fetch?url=` | 读任意页面正文 |
| GET | `/shot?url=` | 截图 |
| GET | `/restart` | 重启浏览器上下文（状态乱了时用） |

`/search` 返回示例：

```json
{
  "ok": true,
  "site": "dy",
  "keyword": "减脂餐",
  "count": 20,
  "items": [
    {
      "duration": "00:18",
      "likes": "35.8万",
      "title": "又掉秤又好吃又简单！生菜土豆拌鸡蛋！ #减脂餐 #低卡低脂餐",
      "author": "尹十五",
      "date": "5月11日",
      "url": ""
    }
  ],
  "screenshot": "D:\\...\\shots\\search-dy-减脂餐-xxx.png",
  "needCaptcha": false
}
```

---

## 注意事项（重要）

### 1. 平台风控

- **小红书 / 抖音都禁自动抓取**，这个项目是在灰色地带跑，账号有被限流/封禁的风险（尤其高频操作）
- 建议：**低频**（一天几次足够）、**别并发**、**别用主号**
- 出现验证码是正常的，不是 bug

### 2. 抖音的坑（踩过的）

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 搜索页一直转圈 | 直链不渲染 | 必须从 `/hot` 进，用页面里的搜索框 |
| 点搜索没反应 | 搜索开在**新标签页** | 代码里会切到新 tab |
| 抓不到卡片 | 卡片是 `<div>` 不是 `<a>`，class 是哈希值 | 按「时长 + @作者」的文字特征抓 |
| 出现滑块 | 风控 | `curl .../show-url?url=<搜索页>` 把窗口拉出来手动拖一次 |

### 3. 小红书

- 二维码 60 秒过期 → 用 `/show` 扫码，别用截图
- 搜索结果依赖登录态，`web_session` 失效就要重新扫

### 4. 鼠标键盘

程序会驱动一个真实的 Edge 窗口（默认在屏幕外）。**执行抓取时别去点那个窗口**，否则可能打断操作。

### 5. 安全

- 服务**只监听 127.0.0.1**，隧道也只绑云端回环，不暴露公网
- `profile/` 目录 = 你的登录 cookie，**绝对不要提交到 Git**（`.gitignore` 已排除）
- 别把 `/show-url`、`/fetch` 这类接口暴露到公网——它们能以你的身份打开任意页面

### 6. 稳定性

- 依赖你**电脑开机**；关机后云端会报错（插件会返回明确的 error）
- Windows 睡眠也会断，看门狗 5 分钟内会重连
- 长时间不重启浏览器，内存会涨；`/restart` 可重启上下文

---

## 排错

| 现象 | 检查 |
| --- | --- |
| `ECONNREFUSED 127.0.0.1:8787` | 服务没跑：`npm start`，或看 `node.err.log` |
| 云端 `curl 127.0.0.1:18787` 不通 | 隧道断了：`schtasks /Run /TN DSH-Feed-Tunnel` |
| `login: {xhs:false}` 但你说登录了 | cookie 没落到 profile：确认登录窗口是程序开的那一个 |
| 搜索 0 条、`needCaptcha: true` | 用 `/show-url` 拉出窗口，手动过验证码 |
| 浏览器起不来 | `BROWSER_PATH` 指向你的 Edge/Chrome 可执行文件 |
| 一切正常但很慢 | 单次 15~30 秒是正常值（要真渲染页面） |

打开诊断日志：

```powershell
# 服务日志
Get-Content node.log -Tail 50
# 隧道日志
Get-Content tunnel.log -Tail 50
```

---

## 设计取舍

- **不用无头浏览器**：`headless: true` 会被两边识别，所以默认是"有头但窗口在屏幕外"
- **不做接口逆向**：签名（`x-s`、`a_bogus`）随时变；走真实页面交互更耐用
- **不做数据库**：抓完即返回，登录态交给浏览器 profile
- **反向隧道而不是公网服务**：安全，且不需要公网 IP / 域名

---

## License

MIT。见 [LICENSE](LICENSE)。

## 免责声明

本项目仅用于学习浏览器自动化与 agent 工具接入。请遵守小红书、抖音的用户协议与当地法律法规；因使用本项目导致的账号封禁、数据损失等后果由使用者自行承担。

---

## 附：让她"长记性"（persona/）

这个仓库还带了一套小工具，让云端 agent 能从聊天里自己积累记忆：

- 每天 03:00 读当天的对话，提炼「老哥的新事实 / 我今天的教训」→ 追加到 learnings.md
- 人设里有一句「聊天前瞄一眼 notes」，她就用上了
- 聊天中值得记的事，她可以调 write_learning 当场写一行

详见 [persona/README.md](persona/README.md)。人设正文和真实笔记属于私人内容，**不进仓库**。

---

## 这个仓库里有什么

| 目录 | 是什么 |
| --- | --- |
| src/ + plugin/ + scripts/ | **取数节点**：给 agent 小红书/抖音搜索能力（见上面正文） |
| persona/ | **学习闭环**：每日复盘 + 每周画像，让 agent 从聊天里积累记忆 |
| memory-long/ | **永久记忆插件**：长期成立的事实每轮硬注入，永不遗忘 |

后两个和"取数"无关，是同一个 agent 伙伴项目里的配套工具——都跑在 DSH 上。

### 四个定时任务（都在服务器上，互相配合）

| 任务 | 时间 | 干什么 |
| --- | --- | --- |
| daily-reflect.timer | 每天 03:00 | 读当天对话 → 提炼事实与教训 → 追加 learnings.md |
| weekly-digest.timer | 每周日 04:00 | 把 7 天笔记压成一段「这周的老哥」 |
| purpose-engine.timer | 10:00–23:00 每 2 小时 | 从记忆里想出一件真想弄明白的事 → purpose.json（6h 过期） |
| dsh-keepalive（非 timer） | 常驻 | 让云端会话一直「活着」，否则 QQ 消息进不来 |

主动性那一条的链路：purpose.json ← purpose-engine ← 记忆；说话那一端由 speak-up 插件的「触发文案」去读它。

## 按需记忆升级（memory-scoped/）

新增 [按需记忆模块](memory-scoped/README.md)：当前上下文负责连续聊天，旧记录只在需要时检索。支持会话隔离、中文/英文关键词排序、普通记忆时间衰减、重要事实保护和少量相邻上下文；检索不调用额外模型。

`memory-long/` 是旧版“每轮注入”插件；`memory-scoped/` 是新的替代方案，**不要同时启用两者**。新模块需要可信的账号/会话绑定，并不会自动搬运私人记忆或修改宿主的压缩参数。公开代码使用通用身份规则，不包含任何使用者的人设正文、账号配置或真实聊天记录。
