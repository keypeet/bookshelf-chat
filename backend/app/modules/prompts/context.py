"""{{roster}} and {{context}} for convert / scan / summarize, as prompts/_context.md describes.

The context pack stays the same size however long the book is: approved summaries
only, never raw text of earlier chapters. Every pack reports the summary ids it
used (`v2-book3` a chapter, `v1` a volume) so a result can record them.
"""

from __future__ import annotations

import json
from typing import Any

from ..library.repository import LibraryRepository

GONE = frozenset({"dead", "left"})  # characters who no longer speak
CHAPTER_BUDGET = 1500
VOLUME_BUDGET = 4000
FAR_VOLUME_BUDGET = 800
ONE_LINE = 150  # characters per earlier chapter in the short list
FALLBACK_BUDGET = 4000  # storyline notes used before any summary exists


def roster_block(characters: dict[str, Any]) -> str:
    """{{roster}}: one compact JSON line per character still in the story, generics and unknown."""

    lines = []
    for key, c in characters.items():
        if c.get("status") in GONE and not c.get("generic"):
            continue
        entry = {"key": key, "name": c.get("name"), "short": c.get("short")}
        for field in ("aliases", "role", "generic", "status"):
            if c.get(field):
                entry[field] = c[field]
        lines.append(json.dumps(entry, ensure_ascii=False))
    if "unknown" not in characters:
        lines.append(json.dumps({"key": "unknown", "name": "ไม่ระบุ"}, ensure_ascii=False))
    return "\n".join(lines)


def _storyline(repo: LibraryRepository, book: str, volume: int) -> str:
    folder = repo.require_book(book) / "storyline"
    if not folder.is_dir():
        return ""
    files = [folder / "index.md", *sorted(folder.glob(f"v{volume}-*.md")), folder / f"v{volume}.md"]
    parts = []
    for path in files:
        if path.is_file():
            text = path.read_text(encoding="utf-8").strip()
            if len(text) > FALLBACK_BUDGET:
                text = text[:FALLBACK_BUDGET] + "\n…(ตัดเพื่อคุมขนาด — ยังไม่มีสรุปบท)"
            parts.append(f"### {path.name}\n{text}")
    return "\n\n".join(parts)


def context_pack(
    repo: LibraryRepository, book: str, volume: int, chapter: int | None
) -> tuple[str, list[str]]:
    """{{context}} for chapter `chapter` of `volume` (None = the volume summary itself)."""

    parts: list[str] = []
    ids: list[str] = []
    current = (repo.summaries(book, volume) or {}).get("chapters", {})
    earlier = sorted((int(n) for n in current if chapter is None or int(n) < chapter), reverse=True)
    near, rest = earlier[:2], earlier[2:]
    for n in near:
        parts.append(f"### สรุปบทที่ {n} (เล่ม {volume})\n{current[str(n)]['summary']}")
        ids.append(f"v{volume}-book{n}")
    lines, used = [], 0
    for n in sorted(rest):
        line = f"บทที่ {n}: {current[str(n)]['summary'].splitlines()[0][:ONE_LINE]}"
        if used + len(line) > CHAPTER_BUDGET:
            break
        lines.append(line)
        used += len(line)
        ids.append(f"v{volume}-book{n}")
    if lines:
        parts.append("### บทก่อนหน้าในเล่มนี้ (ย่อ)\n" + "\n".join(lines))
    for v in range(volume - 1, 0, -1):
        summary = (repo.summaries(book, v) or {}).get("volume")
        if not summary:
            continue
        text = summary["summary"] if v == volume - 1 else summary.get("short", "")
        if text:
            parts.append(f"### สรุปเล่ม {v}\n{text}")
            ids.append(f"v{v}")
    if not parts:
        fallback = _storyline(repo, book, volume)
        parts.append(fallback or "ยังไม่มีบริบท — เป็นช่วงแรกของเรื่อง")
    return "\n\n".join(parts), ids
