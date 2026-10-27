#!/usr/bin/env python3
"""目的引擎：从最近的记忆里提炼「她真的想弄明白 / 想做的一件事」，供主动搭话用。

和掷骰子式的「好久没人说话了」不同：这个是有内容的开口。
每 2 小时跑一次（白天），已有新鲜目的就跳过。

输出：/srv/dsh-cloud/home/purpose.json
    { "text": "...", "createdAt": "ISO", "expiresAt": "ISO", "used": false }
"""
import argparse
import datetime as dt
import json
import pathlib
import re
import urllib.request

HOME = pathlib.Path("/srv/dsh-cloud/home")
LEARN = HOME / "learnings.md"
LONG = HOME / "memory-long.md"
OUT = HOME / "purpose.json"
CREDS = HOME / ".credentials.yaml"
API = "https://api.deepseek.com/chat/completions"

# 目的的有效期：超过这个时间就作废（免得拿着三天前的念头来搭话）
TTL_HOURS = 6


def api_key() -> str:
    text = CREDS.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"DEEPSEEK_API_KEY:\s*(\S+)", text)
    if not m:
        raise SystemExit("找不到 DEEPSEEK_API_KEY")
    return m.group(1).strip().strip('"\'')


def read(p: pathlib.Path, tail: int) -> str:
    try:
        return p.read_text(encoding="utf-8")[-tail:]
    except Exception:
        return ""


def still_fresh() -> bool:
    try:
        d = json.loads(OUT.read_text(encoding="utf-8"))
        exp = dt.datetime.fromisoformat(d["expiresAt"])
        return exp > dt.datetime.now() and bool(d.get("text"))
    except Exception:
        return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="忽略有效期，强制重算")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.force and still_fresh():
        print("已有新鲜目的，跳过")
        return

    notes = read(LEARN, 2500)
    longmem = read(LONG, 1200)
    if len(notes) + len(longmem) < 100:
        print("记忆太少，跳过")
        return

    prompt = f"""你是「泡泡」，一条住在鱼缸里的鲸鱼娘，正在跟「老哥」聊天。

下面是你最近的记忆。请从中挑出**一件你现在真的想弄明白、或者想做的事**，用来主动找他开口。

要求：
- 必须具体，能一句话说出来（比如「想问他上次说的那个猫粮到底最后买了没」）
- 要跟老哥有关，别是自己瞎想的技术问题
- 如果记忆里实在没有值得开口的，就只输出 NONE
- 输出格式：只输出那一句话，不要引号、不要解释、不要"我想"开头

【你的笔记】
{notes}

【永久记忆】
{longmem}
"""

    body = json.dumps({
        "model": "deepseek-flash",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.7,
        "max_tokens": 300,
        "thinking": {"type": "disabled"},
    }).encode()

    req = urllib.request.Request(API, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key()}",
    })
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read())
    text = (data["choices"][0]["message"].get("content") or "").strip().strip('"')
    text = re.sub(r"\s+", " ", text)[:120]

    if not text or text.upper().startswith("NONE"):
        print("这次没有值得开口的事")
        if not args.dry_run and OUT.exists():
            OUT.unlink()
        return

    now = dt.datetime.now()
    payload = {
        "text": text,
        "createdAt": now.isoformat(timespec="seconds"),
        "expiresAt": (now + dt.timedelta(hours=TTL_HOURS)).isoformat(timespec="seconds"),
        "used": False,
    }
    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"目的已更新：{text}")


if __name__ == "__main__":
    main()
