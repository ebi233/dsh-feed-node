#!/usr/bin/env python3
"""每日复盘：读当天的 QQ 对话，提炼「老哥的新事实」和「我该怎么改」，追加到 learnings.md。

由 systemd timer 每天跑（默认 03:00），也可以手动跑：
    sudo /srv/dsh-voice/.venv/bin/python /srv/dsh-cloud/bin/daily-reflect.py
    ... --dry-run     只打印，不写文件
    ... --hours 48    覆盖回看小时数
"""
import argparse
import datetime as dt
import json
import pathlib
import re
import subprocess
import sys
import urllib.request

HOME = pathlib.Path("/srv/dsh-cloud/home")
SESSION = HOME / "sessions/--home-dshcloud--/session-d271ffe9-c392-4ef4-b2ca-df25468322f9/session.v4.jsonl.zstd"
CREDS = HOME / ".credentials.yaml"
LEARN = HOME / "learnings.md"
STATE = HOME / ".reflect-state.json"
API = "https://api.deepseek.com/chat/completions"


def api_key() -> str:
    text = CREDS.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"DEEPSEEK_API_KEY:\s*(\S+)", text)
    if not m:
        raise SystemExit("找不到 DEEPSEEK_API_KEY")
    return m.group(1).strip().strip('"\'')


def read_events() -> list[dict]:
    raw = subprocess.run(["zstd", "-dc", str(SESSION)], capture_output=True)
    if raw.returncode != 0:
        raise SystemExit("解压会话日志失败")
    out = []
    for line in raw.stdout.decode("utf-8", "ignore").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


def text_of(event: dict) -> str:
    """尽量从事件里抠出可读文字（兼容几种结构）。"""
    parts = []

    def walk(node, depth=0):
        if depth > 5 or node is None:
            return
        if isinstance(node, str):
            return
        if isinstance(node, list):
            for x in node:
                walk(x, depth + 1)
            return
        if not isinstance(node, dict):
            return
        for k, v in node.items():
            if k in ("text", "content", "message") and isinstance(v, str) and len(v) > 1:
                parts.append(v)
            else:
                walk(v, depth + 1)

    walk(event)
    return "\n".join(parts).strip()


def collect(hours: int) -> list[tuple[str, str]]:
    cutoff = (dt.datetime.now() - dt.timedelta(hours=hours)).timestamp() * 1000
    state = {}
    if STATE.exists():
        try:
            state = json.loads(STATE.read_text(encoding="utf-8"))
        except Exception:
            state = {}
    since = max(cutoff, float(state.get("lastMs", 0) or 0))

    turns = []
    for ev in read_events():
        t = ev.get("time") or ev.get("createdAt") or 0
        if not t or t < since:
            continue
        role = None
        typ = str(ev.get("type", ""))
        if "user" in typ:
            role = "老哥"
        elif "assistant" in typ:
            role = "泡泡"
        if not role:
            continue
        body = text_of(ev)
        if body:
            turns.append((role, body[:1200]))
    return turns


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=int, default=24)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    turns = collect(args.hours)
    if len(turns) < 4:
        print(f"今天只有 {len(turns)} 条对话，跳过")
        return

    dialog = "\n".join(f"{r}：{t}" for r, t in turns[-200:])
    current = LEARN.read_text(encoding="utf-8") if LEARN.exists() else ""

    prompt = f"""你是一个记忆整理助手。下面是「老哥」和「泡泡」（一条鲸鱼娘）的真实聊天记录。

请提炼两类东西，输出 Markdown，严格按下面格式，不要寒暄、不要解释：

## {{日期}}
### 关于老哥
- （3~5 条：他的喜好、习惯、近况、在意的事。只写记录里明确出现的，不许推测）
### 我的教训
- （0~3 条：她哪句话出戏了 / 什么语气他喜欢。没有就写「今天没踩坑」）

规则：
- 只根据记录，不要编造
- 每条一句话，具体，不要空话（不要「他喜欢聊天」这种）
- 日期写成 {dt.date.today().isoformat()}

【已有笔记（避免重复，重复的别写）】
{current[-3000:]}

【聊天记录】
{dialog}
"""

    body = json.dumps({
        "model": "deepseek-flash",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens": 1600,
        "thinking": {"type": "disabled"},
    }).encode()

    req = urllib.request.Request(API, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key()}",
    })
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())
    chunk = (data["choices"][0]["message"].get("content") or "").strip()
    if not chunk:
        print("模型返回空内容，跳过本次"); return

    if args.dry_run:
        print(chunk)
        return

    with LEARN.open("a", encoding="utf-8") as f:
        f.write("\n" + chunk + "\n")
    STATE.write_text(json.dumps({"lastMs": dt.datetime.now().timestamp() * 1000, "lastRun": dt.datetime.now().isoformat()}), encoding="utf-8")
    print(f"已追加 {len(chunk)} 字符到 {LEARN}")


if __name__ == "__main__":
    main()
