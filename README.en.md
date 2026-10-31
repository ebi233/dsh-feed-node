# dsh-feed-node · Xiaohongshu / Douyin feed node for DSH

English | [中文](README.md)

> Give a DeepSeek Harness agent the ability to browse **Xiaohongshu (RED / Little Red Book)** and **Douyin (Chinese TikTok)** — using **your own logged-in browser** and **your home IP**, then hand the results back to the agent.

---

## Why this exists

Wiring Xiaohongshu/Douyin into a cloud agent fails at the first step:

| Approach | Result |
| --- | --- |
| Cloud server → site directly | RED: `IP at risk (300012)`; Douyin: captcha interstitial |
| Call the internal JSON APIs | Both require signed params (`x-s`, `a_bogus`) that rotate |
| Headless browser in the cloud | Slider captcha + fingerprinting, almost always blocked |

**The root cause is the datacenter IP.** Both platforms treat cloud ranges as hostile, no matter how clean your code is.

So this project keeps the browsing where it belongs — **on your home machine** (clean IP, real login) — and only sends the **results** to the cloud agent over a reverse SSH tunnel.

```
┌──────────────────────┐        reverse SSH tunnel       ┌────────────────────┐
│  your PC (home IP)   │  ssh -R 18787:127.0.0.1:8787   │  cloud server       │
│                      │  ◄──────────────────────────   │                     │
│  dsh-feed-node :8787 │                                │  DSH (agent)        │
│  Edge + your session │  ──── HTTP (loopback) ──────►  │  dsh-feed-tools     │
└──────────────────────┘                                └────────────────────┘
```

---

## Works for both cloud and local agents

The project is split in two halves — **only the "how do I connect" part changes**:

| Where the agent runs | Tunnel needed? | `FEED_NODE_URL` in the plugin |
| --- | --- | --- |
| **Same machine** (DSH desktop) | ❌ no | `http://127.0.0.1:8787` |
| **Cloud server** | ✅ reverse SSH | `http://127.0.0.1:18787` |
| Another machine (LAN) | ❌ open the port | `http://<machine ip>:8787` |

```
fetch node (src/server.mjs)   ← only cares about "browser + logged-in session"
        ↑ HTTP
DSH plugin (plugin/)          ← only cares about "one URL"
```

- **Local is the simplest**: `npm start` + point the plugin at `8787`. No tunnel, no scheduled tasks.
- **Cloud adds one step**: a reverse tunnel (`scripts/install-tasks.ps1` does it in one command).
- One node can serve several agents at once (local on 8787, cloud via 18787, **sharing the same login**).

> ⚠️ The node must run on **your own PC** (it needs your home IP and your QR login).
> **Don't** deploy it to a cloud server — datacenter IPs are blocked by Xiaohongshu/Douyin, which is exactly why this project exists.

---

## Layout

```
dsh-feed-node/
├── src/server.mjs          # the fetch node (node:http + Playwright, no framework)
├── plugin/                 # DSH plugin that exposes it as agent tools
├── scripts/
│   ├── start-node.cmd
│   ├── install-tasks.ps1   # registers scheduled tasks + generates tunnel script
│   └── watchdog.ps1        # restarts the node/tunnel if they die
└── README.md / README.en.md
```

---

## What you must do by hand (only 3 things)

Almost everything is automated, but **three steps need a human**:

| # | When | What | Time |
| --- | --- | --- | --- |
| 1 | after the first install | log in to Xiaohongshu and Douyin (one QR scan each, valid for a long time) | 2 min |
| 2 | occasionally (hours to a day) | drag the Douyin **slider captcha** when it appears | 10 s |
| 3 | always | keep the **PC powered on** — the tools only work while it is | — |

### In detail

**① Log in (once per platform)**

```powershell
curl "http://127.0.0.1:8787/show?site=xhs"   # Xiaohongshu
curl "http://127.0.0.1:8787/show?site=dy"    # Douyin
```

A browser window appears in the top-left corner. Scan the QR with the mobile app. The session is stored in `profile/`.

Verify:

```powershell
curl http://127.0.0.1:8787/health
# {"ok":true,"login":{"xhs":true,"dy":true}}
```

**② Solve the captcha**

Douyin shows a slider captcha every so often. When a search returns 0 items or `needCaptcha: true`:

```powershell
# show the search page on screen, then solve the slider once
curl "http://127.0.0.1:8787/show-url?url=https%3A%2F%2Fwww.douyin.com%2Fsearch%2Fmeal%20prep"
```

It lasts for a while, not for a single request.

**③ Keep the PC on**

- PC off → tools return a clear error (by design)
- PC sleeping → tunnel drops, but the **watchdog reconnects within 5 minutes**
- Tip: set the power plan to "never sleep", or accept the short reconnect window

### Fully automatic

| Action | Handled by |
| --- | --- |
| start node + tunnel at boot | scheduled tasks (at logon) |
| restart node/tunnel when dead | watchdog (every 5 min) |
| open pages, scroll, extract | the node (Playwright) |
| turn results into tool output | the DSH plugin |

---

## Requirements

- **Windows 10/11** (macOS/Linux work too — adjust the scripts)
- **Node.js ≥ 20**
- **Edge or Chrome** (the browser you normally log in with)
- A server you can SSH into, if the agent runs in the cloud (skip the tunnel if the agent is local)

---

## 1. Install the node

```powershell
git clone https://github.com/ebi233/dsh-feed-node.git
cd dsh-feed-node
npm install
```

> `playwright-core` does **not** download a browser — it drives your installed Edge. No `npx playwright install` needed.

Run it:

```powershell
npm start
# [dsh-feed-node] listening on http://127.0.0.1:8787
```

Self-check:

```powershell
curl http://127.0.0.1:8787/health
# {"ok":true,"login":{"xhs":false,"dy":false}, ...}
```

---

## 2. Log in (once per platform)

### Option A — bring the window on screen (recommended)

```powershell
curl "http://127.0.0.1:8787/show?site=xhs"   # Xiaohongshu
curl "http://127.0.0.1:8787/show?site=dy"    # Douyin
```

A browser window appears in the top-left corner. Scan the QR with the mobile app. The page stays open while polling, and the session is persisted in `profile/`.

### Option B — screenshot the QR

```powershell
curl "http://127.0.0.1:8787/login?site=xhs"
# -> {"screenshot":"...\\shots\\login-xhs-1730...png"}
curl "http://127.0.0.1:8787/login-status?site=xhs"
```

> ⚠️ Xiaohongshu rotates its QR code roughly every **60 seconds**, so screenshots often go stale. Prefer Option A.

### Verify

```powershell
curl http://127.0.0.1:8787/health
# {"ok":true,"login":{"xhs":true,"dy":true}}
```

---

## 3. Reach it from the cloud (reverse tunnel)

```powershell
ssh -i C:\path\to\id_ed25519 -N -R 18787:127.0.0.1:8787 admin@YOUR_SERVER_IP
```

**Register autostart + watchdog** (Administrator PowerShell):

```powershell
.\scripts\install-tasks.ps1 -Server admin@YOUR_SERVER_IP -KeyPath C:\path\to\id_ed25519
```

Three scheduled tasks are created:

| Task | Purpose |
| --- | --- |
| `DSH-Feed-Node` | starts the node at logon |
| `DSH-Feed-Tunnel` | opens the reverse tunnel, reconnects every 10s |
| `DSH-Feed-Watchdog` | every 5 minutes, restarts node/tunnel if missing |

On the server:

```bash
curl http://127.0.0.1:18787/health
```

---

## 4. Install the DSH plugin

The plugin lives in `plugin/`:

```bash
dsh plugin --profile cloud add link:/path/to/dsh-feed-node/plugin
```

Point it at the tunnel port when the agent is remote:

```bash
FEED_NODE_URL=http://127.0.0.1:18787
```

Restart DSH. New tools:

| Tool | Purpose |
| --- | --- |
| `feed_health` | node status + login state |
| `xhs_search` | search Xiaohongshu notes |
| `xhs_page` | read a note/video page |
| `dy_search` | search Douyin videos |
| `dy_hot` | Douyin hot list (most reliable path) |

---

## HTTP API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | status + login state |
| GET | `/login?site=xhs\|dy` | open login page, return screenshot, keep page open |
| GET | `/login-status?site=` | poll login result |
| GET | `/show?site=` | move the window on screen (login / captcha) |
| GET | `/show-url?url=` | same, for an arbitrary URL |
| GET | `/search?site=xhs\|dy&q=` | search, structured items |
| GET | `/hot` | Douyin hot list |
| GET | `/fetch?url=` | read a page's text |
| GET | `/shot?url=` | screenshot |
| GET | `/restart` | restart the browser context |

Sample `/search` response:

```json
{
  "ok": true,
  "site": "dy",
  "keyword": "meal prep",
  "count": 20,
  "items": [
    {
      "duration": "00:18",
      "likes": "358k",
      "title": "... #hashtags",
      "author": "somebody",
      "date": "May 11",
      "url": ""
    }
  ],
  "needCaptcha": false
}
```

---

## Caveats (read this)

### 1. Platform risk controls

- Both platforms prohibit automated scraping; this project lives in a grey zone and **your account can be rate-limited or banned**, especially with high frequency
- Keep it **low frequency**, **no concurrency**, and ideally **not your main account**
- Captchas are normal, not a bug

### 2. Douyin specifics (learned the hard way)

| Symptom | Cause | Fix |
| --- | --- | --- |
| Search page spins forever | direct URL doesn't render | enter from `/hot`, type into the page's search box |
| Clicking search does nothing | it opens in a **new tab** | the code switches to the new tab |
| Zero cards extracted | cards are `<div>`s with hashed classes, not `<a>` | extract by text pattern (`duration + @author`) |
| Slider captcha | risk control | `GET /show-url?url=<search url>` and solve it once |

### 3. Xiaohongshu

- QR expires in ~60s → use `/show`, not screenshots
- Search requires a valid `web_session`; re-scan when it expires

### 4. The browser is real

The node drives an actual Edge window (offscreen by default). **Don't click inside it while a request is running.**

### 5. Security

- The server binds **127.0.0.1 only**; the tunnel also binds to the server's loopback
- `profile/` holds your login cookies — **never commit it** (already in `.gitignore`)
- Never expose `/show-url` or `/fetch` publicly: they can open any page as you

### 6. Reliability

- Requires your PC to be **on**; when it's off the plugin returns a clear error
- Windows sleep breaks the tunnel; the watchdog reconnects within 5 minutes
- Long-running browsers leak memory; `/restart` resets the context

---

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `ECONNREFUSED 127.0.0.1:8787` | node not running: `npm start`, see `node.err.log` |
| cloud `curl 127.0.0.1:18787` fails | tunnel down: `schtasks /Run /TN DSH-Feed-Tunnel` |
| `login: {xhs:false}` although you logged in | cookies landed in another browser profile; log in via the window the node opened |
| 0 results, `needCaptcha: true` | `/show-url` and solve the slider |
| browser won't start | set `BROWSER_PATH` |
| slow | 15–30s per request is normal (real page rendering) |

---

## Design notes

- **Not headless** — both platforms detect headless; default is "headed but offscreen"
- **No API reverse-engineering** — signatures rotate; real page interaction lasts longer
- **No database** — login state lives in the browser profile
- **Reverse tunnel, not a public service** — no public IP or domain required

## License

MIT. See [LICENSE](LICENSE).

## Disclaimer

For learning browser automation and agent tooling. Respect the Terms of Service of Xiaohongshu and Douyin and your local laws. You are responsible for any account bans or data loss caused by using this project.

## On-demand memory upgrade

See [memory-scoped/README.md](memory-scoped/README.md) for the new scoped recall module: BM25-style Chinese/English keyword ranking, time decay for ordinary records, stable important facts, and one adjacent context message. Retrieval itself makes no model calls.

The existing `memory-long/` plugin injects memories on every turn. `memory-scoped/` is an alternative, not a companion to run alongside it. It requires trusted account/session bindings and does not configure host compaction or migrate private data. The public package contains generic identity rules only, with no personal persona, account configuration, or real conversation records.
