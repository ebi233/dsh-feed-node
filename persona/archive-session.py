#!/usr/bin/env python3
"""全量存档：把会话日志里每一句人话按天切片存下来（append-only，永不删除）。

和「会淡忘的记忆」互补：
    - fish-memory：抽事实、按话题检索、会淡忘
    - 全量存档：原话全留，只在她主动 recall 时才被翻出来

只存「真正说出口的话」：assistant 的 reasoning / tool-call 一律丢弃。

由 systemd timer 每 30 分钟跑一次（增量，不重复）。

输出：/srv/dsh-cloud/home/archive/YYYY-MM-DD.jsonl
    {"t":"22:31:05","role":"老哥","text":"..."}
"""
import datetime as dt
import hashlib
import json
import pathlib
import subprocess
import sys

HOME = pathlib.Path("/srv/dsh-cloud/home")
SESSION = HOME / "sessions/--home-dshcloud--/session-d271ffe9-c392-4ef4-b2ca-df25468322f9/session.v4.jsonl.zstd"
ARCHIVE = HOME / "archive"
STATE = HOME / ".archive-state.json"

# 这些来源的消息不要（不是两个人的对话）
SKIP_SOURCE = {"qq-notice", "system", "developer"}


def read_events() -> list[dict]:
    raw = subprocess.run(["zstd", "-dc", str(SESSION)], capture_output=True)
    if raw.returncode != 0:
        print("解压会话日志失败", file=sys.stderr)
        return []
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


def spoken_text(ev: dict) -> str:
    """只取真正说出口的 text 块。"""
    d = ev.get("data") or {}
    msg = d.get("message") or {}
    content = msg.get("content")
    if content is None:
        content = d.get("content")      # user/message 的形状
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                t = (block.get("text") or "").strip()
                if t:
                    parts.append(t)
        return "\n".join(parts)
    return ""


def role_of(ev: dict) -> str | None:
    d = ev.get("data") or {}
    src = d.get("source") or {}
    if isinstance(src, dict) and src.get("kind") in SKIP_SOURCE:
        return None
    msg = d.get("message") or {}
    who = msg.get("role") or d.get("role")
    if who == "assistant":
        return "泡泡"
    if who == "user":
        return "老哥"
    return None


def main() -> None:
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    last_ms = 0.0
    seen = set()
    if STATE.exists():
        try:
            st = json.loads(STATE.read_text(encoding="utf-8"))
            last_ms = float(st.get("lastMs", 0))
            seen = set(st.get("seen", [])[-8000:])
        except Exception:
            pass

    added = 0
    latest = last_ms
    for ev in read_events():
        t = ev.get("time") or ev.get("createdAt") or 0
        if not t or t <= last_ms:
            continue
        role = role_of(ev)
        if not role:
            continue
        body = spoken_text(ev)
        if not body:
            continue
        when = dt.datetime.fromtimestamp(t / 1000)
        h = hashlib.sha1((str(int(t)) + role + body).encode()).hexdigest()[:16]
        latest = max(latest, float(t))
        if h in seen:
            continue
        seen.add(h)
        rec = {"t": when.strftime("%H:%M:%S"), "role": role, "text": body[:4000]}
        with (ARCHIVE / f"{when.date().isoformat()}.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        added += 1

    STATE.write_text(json.dumps({
        "lastMs": latest,
        "lastRun": dt.datetime.now().isoformat(timespec="seconds"),
        "seen": sorted(seen)[-8000:],
    }, ensure_ascii=False), encoding="utf-8")

    files = sorted(ARCHIVE.glob("*.jsonl"))
    total = sum(len(f.read_text(encoding="utf-8").splitlines()) for f in files)
    print(f"新增 {added} 条，归档累计 {total} 条，{len(files)} 天")


if __name__ == "__main__":
    main()
