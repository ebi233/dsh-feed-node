# persona/ · 让云端 agent 自己"长记性"

这是 [dsh-feed-node](../README.md) 仓库里的**附属工具集**：给跑在服务器上的 DSH agent 加一套
「聊天 → 复盘 → 记笔记 → 下次用上」的闭环。

配套的是一个独立的 DSH 插件（`dsh-qq-profile`）里的 `write_learning` 工具——这里只放
**复盘脚本**和**部署单元**，人设正文和笔记属于私人内容，不进仓库。

## 闭环长什么样

```
每天聊天
   ↓  会话日志（session.v4.jsonl.zstd）
03:00  daily-reflect.py
   ↓  调模型提炼两件事：老哥的新事实 / 我今天的教训
learnings.md（只追加，带日期）
   ↓
人设里那句「聊天前瞄一眼 learnings.md」
   ↓
下次聊天自然用上
```

另外，她聊天中发现值得记的事，可以当场调 `write_learning` 写一行，不用等凌晨。

## 文件

| 文件 | 作用 |
| --- | --- |
| `daily-reflect.py` | 读当天的会话日志 → 提炼 → 追加到 `learnings.md` |
| `learnings.example.md` | 笔记初始模板 |
| `daily-reflect.service` | systemd 一次性服务 |
| `daily-reflect.timer` | 每天 03:00 触发 |

## 部署

```bash
# 1) 脚本
sudo install -m 755 daily-reflect.py /srv/dsh-cloud/bin/daily-reflect.py
sudo install -m 644 learnings.example.md /srv/dsh-cloud/home/learnings.md

# 2) 定时器
sudo install -m 644 daily-reflect.service /etc/systemd/system/
sudo install -m 644 daily-reflect.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now daily-reflect.timer

# 3) 先干跑一次看看产出
sudo python3 /srv/dsh-cloud/bin/daily-reflect.py --dry-run --hours 48
```

## 需要改的地方

`daily-reflect.py` 顶部几个路径是写死的，按你的部署改：

```python
HOME    = pathlib.Path("/srv/dsh-cloud/home")
SESSION = HOME / "sessions/--home-dshcloud--/session-<你的会话id>/session.v4.jsonl.zstd"
CREDS   = HOME / ".credentials.yaml"   # 里面要有 DEEPSEEK_API_KEY
LEARN   = HOME / "learnings.md"
```

> 会话 id 在 `sessions/--home-dshcloud--/` 下面，取你想要复盘的那一条。

## 两个坑（都踩过）

1. **模型返回空内容**：DeepSeek 默认开思考模式，`max_tokens` 会被推理吃掉。
   脚本里显式加了 `"thinking": {"type": "disabled"}` 并调大 `max_tokens`。
2. **笔记越写越水**：prompt 里带了「已有笔记」并要求"不许重复、不许编造"。
   如果发现它开始写空话（"他喜欢聊天"这种），把 `temperature` 降到 0.1，或把
   prompt 里"3~5 条"改成"最多 3 条，宁缺毋滥"。

## 想更进一步

- **人设自改**：让复盘额外输出「建议改的人设条目」，**人工确认后**再改，别让它直接写人设
- **周报**：把 7 天的笔记再压成一段"她眼里这周的老哥"，注入人设开头
- **成本**：每轮记忆抽取约 ¥0.001，每日复盘约 ¥0.05~0.2，一年几十块

## 每周画像（weekly-digest）

光有每天的流水账会越来越长；每周日 04:00 把最近 7 天的笔记**压成一段**：

`
# 这周的老哥（2026-11-03 生成，覆盖 7 天笔记）

老哥这周心情不错，说今年过得开心…
他会自己下厨或点铁板香肠、意面、卧蛋这类吃的，还拍照馋泡泡。
这周我该注意：别总反问他，会被吐槽像人机；认错要干脆别嘴硬。
`

部署：

`ash
sudo install -m 755 weekly-digest.py /srv/dsh-cloud/bin/weekly-digest.py
sudo install -m 644 weekly-digest.service weekly-digest.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now weekly-digest.timer
sudo python3 /srv/dsh-cloud/bin/weekly-digest.py --days 30 --dry-run   # 先看效果
`

写进人设的那句（让两者都生效）：

`
家目录里有 learnings.md（每天）和 weekly-digest.md（每周），聊天前瞄一眼，
优先看 weekly-digest.md，那是浓缩过的。
`

> 顺序建议：**先跑三天 daily，再开 weekly**。笔记太少时压缩出来的东西会很空。

## 目的引擎（purpose-engine）

主动搭话最容易变成"好久没人理我了"这种空话。目的引擎把它换成**有内容的开口**：

`
每 2 小时（10:00-23:00）
   ↓  读 learnings.md + memory-long.md
调模型：从记忆里挑「一件真的想弄明白 / 想做的事」
   ↓
purpose.json（带 6 小时有效期）
   ↓
主动搭话时先读它，把这件具体的事说出来
`

实测产出示例：

> 他上次说的铁板香肠到底自己做了没，还是又点的外卖

部署：

`ash
sudo install -m 755 purpose-engine.py /srv/dsh-cloud/bin/
sudo install -m 644 purpose-engine.service purpose-engine.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now purpose-engine.timer
sudo python3 /srv/dsh-cloud/bin/purpose-engine.py --force   # 先看它会想出什么
`

然后**把主动搭话的触发文案换成"先读 purpose.json"**（这里用的是 speak-up 插件）：

`json
"触发文案": "（主动回合）先读 /srv/dsh-cloud/home/purpose.json：如果里面有 text 且没过期，就自然地把这件事说出来…"
`

设计要点：

- **有有效期**（默认 6 小时）：拿着三天前的念头来搭话，比不说话更假
- **没有就删**：模型输出 NONE 时删掉旧文件，宁可这次不开口
- **不解释**：prompt 里明确要求别写"我看到一个文件"，要像刚想起来

## 全量存档（archive-session）

前面那些都是「提炼过的记忆」；这一层是**原话全留**：

`
每 30 分钟
   ↓ 读会话日志，只取真正说出口的 text 块（丢掉 reasoning / tool-call）
archive/2026-10-28.jsonl
   {"t":"22:31:05","role":"老哥","text":"..."}
   ↓
她需要时用 recall_archive(query, days) 搜
`

三条设计原则：

1. **只存不注入**：全量原话不进上下文，否则 token 直接爆
2. **只存人话**：ssistant 的 reasoning 和 tool-call 全部丢弃（第一版没丢，存进去一堆英文推理，已修）
3. **永不删除**：按天切片，append-only

配合 memory-long 插件的两个工具：

| 工具 | 作用 |
| --- | --- |
| ecall_archive(query, days, limit) | 在历史原话里搜关键词 |
| rchive_stats() | 看存了多少天、多少条 |

部署：

`ash
sudo install -m 755 archive-session.py /srv/dsh-cloud/bin/
sudo install -m 644 archive-session.service archive-session.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now archive-session.timer
sudo python3 /srv/dsh-cloud/bin/archive-session.py      # 首次把历史全跑一遍
`

## 五层记忆总览

| 层 | 内容 | 会不会忘 | 怎么进上下文 |
| --- | --- | --- | --- |
| 全量存档 rchive/ | 每句原话 | ❌ 永不 | 她主动 ecall_archive 才搜 |
| 永久记忆 memory-long.md | 身份/边界/约定 | ❌ 永不 | **每轮全量注入** |
| 长期事实（fish-memory） | 抽出来的事实 | ✅ 用进废退 | 按话题检索注入 |
| 每日笔记 learnings.md | 复盘出的流水账 | ❌ | 她主动看 |
| 每周画像 weekly-digest.md | 一周浓缩 | ❌ | 她主动看 |
