# DSH 按需记忆：scoped memory

让当前上下文负责连续聊天，旧记录只在需要时读取。这个模块基于已有 DSH 会话记录与事实工具，增加关键词相关度、时间衰减和有限的相邻上下文关联，不需要新增向量数据库或 embedding 服务。

## 功能

- `conversation_recall`：按需检索本会话；`short` 默认近 7 天，`important` 重要事实，`records` 原始记录，`all` 综合结果。
- 中文双字词和英文词的 BM25 风格排序；普通记录随时间降权，重要事实不按时间降权，仍尊重有效期和更正。
- 最多带一条同会话相邻消息，并标为 `adjacent_context`，不把它当作额外事实证据。
- 近期记录半衰期 7 天、普通历史记录 30 天，检索权重下限 0.35。不会因查询而强化记忆，也不会删除原始日志。
- 每次最多 6 条、正文合计最多 4000 字符；默认返回 4 条。
- `conversation_fact`、`conversation_topic`：以近期真人原话为证据保存事实、临时话题和收藏；推测不能直接升级成永久事实。
- `remember_forever` / `list_long_memory` / `correct_long_memory` / `forget_long_memory`：兼容已有事实与旧长期记忆。显式删除工具仍会按调用删除指定条目；“不删除记录”指检索和时间衰减本身不删除。
- `friend_conversation_recall`：仅主账号直接私聊可按指定好友查询，访客、群聊和派生任务无法调用。

检索本身不调用模型；工具返回内容被放进下一次模型输入时，仍会占用上下文 tokens。

## 两种用法

### 只复用排序函数

排序模块是独立的纯 JavaScript，只有 Node.js 标准能力，不需要 DSH：

```js
import {rankMemory} from './lib/memory-rank.mjs';

const result = rankMemory([
  {id:'one', text:'今天想试试手冲咖啡', at:Date.now(), layer:'short', source:'native_record'},
  {id:'two', text:'明确偏好：咖啡不加糖', at:Date.now()-86400000, layer:'important', source:'evidence_note'},
], '咖啡', {limit:4});
console.log(result.items);
```

### 接入 DSH 插件

需要已有 DSH、原生 v4 会话存储以及可信 QQ 桥接绑定。压缩日志读取需要系统安装 `zstd`。Node.js 20 以上可运行纯排序测试；完整插件的 Node.js 要求以所安装的 DSH 为准。

1. 备份现有插件配置。停止同时使用旧的 `memory-long` 插件，避免工具重名和旧记忆继续每轮注入。
2. 将本目录放到运行 DSH 的机器，例如 `/opt/dsh-scoped-memory`。
3. 使用已有 DSH 插件管理流程添加本地包，例如 `dsh plugin --profile <你的配置名> add link:/opt/dsh-scoped-memory`。
4. 确认 `DSH_HOME` 指向现有工作目录；宿主依赖无法自动发现时设置 `DSH_HOST_MODULES` 为宿主 `@deepseek-ai` 模块目录。
5. 检查下方绑定前提，再重启对应 DSH 服务。安装不会创建 QQ 好友、群会话或替你改人设。

此插件不是通用“一键无配置”记忆服务。缺少可信绑定时，记忆权限会拒绝访问。

## 绑定与隔离前提

插件读取 `$DSH_HOME` 下已有桥接元数据，**不要拿示意字段覆盖实际配置**：

| 文件 | 用途 |
| --- | --- |
| `qq-bridge-config.json` | `主人号码`、`绑定`（`类型`、`号码`、`会话`）和兼容的主账号私聊字段 |
| `guests.json` | 以好友账号为键，记录 `session`、可信建档时间 `first`，可选 `name` |
| `groups.json` | 可选的自动群绑定；不存在时使用明确的桥接绑定 |
| `group-session-seals.json` | 群会话与群账号的隔离登记、封存时间 `sealedAt` |

群会话必须专用，不能复用私人会话。`group-privacy.mjs` 提供 `sealGroupBindings(ctx, config)`：只有隐私守卫已加载、目标会话已打开且历史为空时才允许登记。不要为有私聊历史的会话手写封存标记。

公开包的访客/群聊默认规则是通用身份规则，没有携带任何个人角色设定。接入自己的公开角色规则时，需继续保留工具权限、最终提示隔离和会话归属检查，不能把私聊人设或记忆直接拿来给群聊使用。

## 数据、来源与限制

- 记录保存在 DSH 原生 `sessions/<workspace>/<session>/session.v4.jsonl[.zstd]`，插件只读当前获准会话。
- 事实与话题使用已有 `conversation-notes/`；旧长期记忆来自当前身份对应的记忆文件，不会自动迁移到其他会话。
- 读取器排除推理、系统提示、工具返回和失败/未完成回合的助手答复。助手答复是生成记录，不是 QQ 送达凭据。
- QQ 备用 HTTP 通道可能记为普通输入。访客按建档时间、群按封存时间排除早期初始化资料；主账号排除第一轮普通输入。`origin=local_or_bridge` 表示无法确定来自本地界面还是 QQ 备用通道，不能只凭该标记断言来源。
- 无法读取、格式错误或超过 16 MiB 上限时会报错或明确标示降级，不能将其解释成“没有发生过”。
- 本版是关键词与有限相邻关联，不是完整语义知识图谱；无共同关键词的同义表达可能漏检。
- 该包不会修改宿主压缩阈值、保留长度、摘要模型或人设边界。相关参数由你的 DSH 配置管理。
- 调试状态位于本机 `/dsh-scoped-memory/state`；无需把管理接口暴露公网。

## 测试

无需联网或模型：

```bash
npm --prefix memory-scoped test
```

在有 DSH 宿主模块和 `zstd` 的 Linux 环境，运行完整隔离与原生工具注册测试：

```bash
DSH_HOST_MODULES=/path/to/@deepseek-ai npm --prefix memory-scoped run test:integration
```

测试仅在系统临时目录创建合成的账号与聊天记录，不发送 QQ 消息，不调用模型。覆盖排序、衰减、输出预算、初始化过滤、备用输入来源、过期更正、身份隔离、绑定变更、取消、路径校验及压缩日志。

## 发布内容

本目录只包含代码、合成测试和文档。不包含真实人设、账号配置、密钥、cookie、聊天记录、记忆文件或线上诊断快照。服务端部署脚本与实际路径配置不随公开包提供。

MIT，沿用仓库根目录的 LICENSE。
