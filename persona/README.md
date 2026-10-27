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
