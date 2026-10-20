"""Assemble prompts from `prompts/*.md`, the one set of book-agnostic rules.

A template file opens with notes for people, then a `---` line; only the text
after that line is sent. Placeholders look like {{name}}. {{image}} is left
for the provider, which fills in the page paths it copied for the call.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PLACEHOLDER = re.compile(r"\{\{([a-zA-Z]+)\}\}")
PROVIDER_FILLED = frozenset({"image"})
TEMPLATES = frozenset({"ocr", "scan", "convert", "summarize"})


@dataclass(frozen=True, slots=True)
class Prompt:
    template: str
    text: str
    template_hash: str  # sha256 of the whole template file, stored with every result


def load_template(prompts_dir: Path, name: str) -> tuple[str, str]:
    """The sendable body and the hash of the file."""

    if name not in TEMPLATES:
        raise ValueError(f"Unknown prompt template {name!r}.")
    raw = (prompts_dir / f"{name}.md").read_text(encoding="utf-8")
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    head, sep, body = raw.partition("\n---\n")
    return (body if sep else head).strip() + "\n", digest


def render(prompts_dir: Path, name: str, values: dict[str, str]) -> Prompt:
    body, digest = load_template(prompts_dir, name)
    wanted = set(PLACEHOLDER.findall(body)) - PROVIDER_FILLED
    missing = wanted - values.keys()
    if missing:
        raise ValueError(f"Prompt {name!r} needs values for {sorted(missing)}.")

    def fill(match: re.Match[str]) -> str:
        key = match.group(1)
        return match.group(0) if key in PROVIDER_FILLED else values[key]

    return Prompt(template=name, text=PLACEHOLDER.sub(fill, body), template_hash=digest)


def names_block(characters: dict[str, Any]) -> str:
    """{{names}}: name and aliases of every named character, one per line."""

    lines = []
    for character in characters.values():
        if character.get("generic"):
            continue
        aliases = [a for a in character.get("aliases", []) if a]
        lines.append(
            f"{character['name']} ({', '.join(aliases)})" if aliases else character["name"]
        )
    return "\n".join(lines) or "ยังไม่มีทะเบียน"


def pages_block(texts: dict[int, str]) -> str:
    """{{pages}} / {{chapterText}}: `### image NNN` then the raw body, page by page."""

    return "\n\n".join(f"### image {image:03d}\n{text}" for image, text in texts.items())


def style_notes(book: dict[str, Any]) -> str:
    return book.get("styleNotes") or "ไม่มี"


def ocr_prompt(prompts_dir: Path, book: dict[str, Any], characters: dict[str, Any]) -> Prompt:
    return render(
        prompts_dir,
        "ocr",
        {
            "bookTitle": book.get("title", ""),
            "styleNotes": book.get("styleNotes") or "ไม่มี",
            "names": names_block(characters),
        },
    )
