"""Did converting lose or invent text? The same check as scripts/coverage.mjs.

ratio = characters of every block's `text` + `action` (not `scene`, not `gap`) over
characters of the raw pages, both without whitespace, quote marks or <!-- --> markers.
A paragraph is missing when neither its first nor its last few characters appear in
the blocks. Both versions run the cases in scripts/coverage-cases.json.
"""

from __future__ import annotations

import math
import re
from collections.abc import Iterable
from typing import Any

LOW, HIGH = 0.97, 1.03
PROBE = 10  # characters from each end of a paragraph that must appear in the blocks
MIN_PARAGRAPH = 6  # shorter paragraphs are not checked on their own
_COMMENT = re.compile(r"<!--.*?-->", re.S)
# explicit lists so Python and node strip and split the same characters
_STRIP = re.compile(
    r"[\t\n\v\f\r \u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff\"'“”‘’„‟«»]"
)
_LINES = re.compile(r"\r?\n")
_COUNTED = ("narration", "dialogue", "thought")


def norm(text: str) -> str:
    return _STRIP.sub("", _COMMENT.sub("", text))


def block_text(blocks: Iterable[dict[str, Any]]) -> str:
    parts = []
    for block in blocks:
        if block.get("type") in _COUNTED:
            parts.append(str(block.get("text") or ""))
            parts.append(str(block.get("action") or ""))
    return norm("".join(parts))


def coverage(blocks: list[dict[str, Any]], raw_texts: list[str]) -> dict[str, Any]:
    """{ratio (None when the raw is empty), missing (paragraph openings), ok}."""

    have = block_text(blocks)
    paragraphs = [norm(line) for text in raw_texts for line in _LINES.split(_COMMENT.sub("", text))]
    want = "".join(paragraphs)
    # half-up rounding, as Math.round in the node version
    ratio = math.floor(len(have) / len(want) * 1000 + 0.5) / 1000 if want else None
    missing = []
    for paragraph in paragraphs:
        if len(paragraph) < MIN_PARAGRAPH:
            continue
        head, tail = paragraph[:PROBE], paragraph[-PROBE:]
        if head not in have and tail not in have:
            missing.append(paragraph[:40])
    ok = (ratio is None and not have) or (ratio is not None and LOW <= ratio <= HIGH)
    return {"ratio": ratio, "missing": missing, "ok": ok and not missing}
