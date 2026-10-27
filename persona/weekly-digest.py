#!/usr/bin/env python3
"""每周画像：把 learnings.md 里最近一周的笔记压成一段「她眼里的老哥」，写进 weekly-digest.md。

每周日 04:00 由 systemd timer 跑，也可以手动：
    sudo /srv/dsh-voice/.venv/bin/python /srv/dsh-cloud/bin/weekly-digest.py
    ... --dry-run
    ... --days 7
"""
import argparse
import datetime as dt
import json
import pathlib
import re
import urllib.request

HOME = pathlib.Path("/srv/dsh-cloud/home")
LEARN = HOME / "learnings.md"
OUT = HOME / "weekly-digest.md"
CREDS = HOME / ".credentials.yaml"
API = "https://api.deepseek.com/chat/completions"


def api_key() -> str:
    text = CREDS.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"DEEPSEEK_API_KEY:\s*(\S+)", text)
    if not m:
        raise SystemExit("找不到 DEEPSEEK_API_KEY")
    return m.group(1).strip().strip('"\'')


def recent_sections(days: int) -> str:
    """按 `## YYYY-MM-DD` 切段，只取最近 N 天。"""
    if not LEARN.exists():
        raise SystemExit("learnings.md 不存在")
    text = LEARN.read_text(encoding="utf-8")
    cutoff = dt.date.today() - dt.timedelta(days=days)
    keep, cur, date = [], [], None
    for line in text.splitlines():
        m = re.match(r"^##\s+(\d{4}-\d{2}-\d{2})\s*$", line.strip())
        if m:
            if date and date >= cutoff:
                keep.append("\n".join(cur))
            date = dt.date.fromisoformat(m.group(1))
            cur = [line]
        else:
            cur.append(line)
    if date and date >= cutoff:
        keep.append("\n".join(cur))
    return "\n\n".join(keep).strip()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    material = recent_sections(args.days)
    if len(material) < 80:
        print("最近一周笔记太少，跳过")
        return

    prompt = f"""下面是一位 AI 伙伴（鲸鱼娘「泡泡」）最近一周关于「老哥」的笔记。

请把它们压缩成一段给她自己看的「这周的老哥画像」，要求：
- 5~8 行，每行一句话
- 只保留反复出现、最重要的；一次性的小事不要
- 不许编造，笔记里没有的不要写
- 最后单独一行，以「这周我该注意：」开头，写 1~2 条她该改的地方
- 直接输出内容，不要标题、不要解释、不要代码块

【笔记】
{material[:8000]}
"""

    body = json.dumps({
        "model": "deepseek-flash",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "max_tokens": 1200,
        "thinking": {"type": "disabled"},
    }).encode()

    req = urllib.request.Request(API, data=body, headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key()}",
    })
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())
    digest = (data["choices"][0]["message"].get("content") or "").strip()
    if not digest:
        print("模型返回空内容，跳过")
        return

    if args.dry_run:
        print(digest)
        return

    header = f"# 这周的老哥（{dt.date.today().isoformat()} 生成，覆盖 {args.days} 天笔记）\n\n"
    OUT.write_text(header + digest + "\n", encoding="utf-8")
    print(f"已写入 {OUT}（{len(digest)} 字符）")


if __name__ == "__main__":
    main()
