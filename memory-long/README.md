# memory-long/ · 永久记忆插件（DSH）

一个极小的 DSH 插件：把「永远不该忘」的事钉进 agent 的系统提示，**每一轮都在**，不检索、不衰减。

配合 [`persona/`](../persona/README.md) 那套（每日复盘 + 每周画像 + 会淡忘的鱼的记忆）用：

```
memory-long.md      ← 每轮全量注入，永不遗忘      （本插件）
鱼的记忆             ← 按话题检索，会淡忘          （dsh-fish-memory）
learnings.md        ← 每天复盘出来的流水账        （persona/）
weekly-digest.md    ← 一周压一次的画像            （persona/）
```

## 为什么需要它

会淡忘的记忆适合流水事件；但**身份、边界、约定、忌讳**这类东西不能靠"检索命中"：

> 老哥讨厌被反问 —— 这句话如果只在"恰好搜到反义词"时才注入，那她下次照样反问。

所以这类事实要**无条件常驻**在系统提示里。

## 注入长什么样

系统提示里会多出这一段：

```
【长期记忆｜永久，别忘、也别反驳】
- 老哥养猫（2026-10-27）
- 老哥讨厌被反问，问句少用（2026-10-27）
```

## 工具

| 工具 | 用途 |
| --- | --- |
| `remember_forever(text)` | 记一条（一句话，≤200 字） |
| `list_long_memory()` | 列表，带编号 |
| `forget_long_memory(index)` | 删掉第 N 条 |

## 安装

```bash
# 1) 拷到服务器（或任意路径）
sudo mkdir -p /srv/dsh-qq-ext && cd /srv/dsh-qq-ext
# ... 把本目录放进去，比如 /srv/dsh-qq-ext/dsh-long-memory

# 2) 装进 profile
sudo -u <dsh用户> env DSH_HOME=<你的DSH_HOME> dsh plugin --profile <profile> add link:/srv/dsh-qq-ext/dsh-long-memory

# 3) 初始化文件（可选）
printf "# 永久记忆（每条都会进系统提示）\n\n- 老哥养猫（2026-10-27）\n" | sudo tee $DSH_HOME/memory-long.md
sudo chown <dsh用户>:<dsh用户> $DSH_HOME/memory-long.md

# 4) 重启
sudo systemctl restart dsh-cloud
```

自检：

```bash
curl -s http://127.0.0.1:29908/dsh-long-memory/state
# {"ok":true,"file":".../memory-long.md","count":2,"maxItems":60,"injected":"【长期记忆｜永久…"}
```

## 配置（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LONG_MEMORY_FILE` | `$DSH_HOME/memory-long.md` | 存哪 |
| `LONG_MEMORY_MAX` | `60` | 最多注入几条（超了只注入最后的） |

## 实现要点

- 用 `ctx.systemPrompt.section({ name, order, text: () => render() })`，`text` 是**函数** → 每轮组装提示词时现读文件
- 所以**改文件立刻生效，不用重启服务**
- 上限 60 条是刻意的：永久记忆一旦膨胀，就等于把上下文又塞满了

## 注意

- 只放「长期成立」的事。一次性小事请走会淡忘的记忆
- 条目超过上限后，**旧的会静默停止注入**（仍然留在文件里）。定期 `list_long_memory` 清理
- 这块内容会每轮占用上下文，60 条 × 约 20 字 ≈ 1200 字，别贪多
