"""The only code that reads or writes `library/`.

The Next.js reader reads the same files; this module is the writer. Writes are
atomic (temp file + os.replace) and serialized per book, and a chapter file is
always written before `index.json` points at it.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
CHAPTER_ID = re.compile(r"^v\d{1,3}-c\d{1,5}$")
RAW_NAME = re.compile(r"^img-(\d{3,4})\.txt$")
HEADER = re.compile(r"<!--\s*([a-z-]+):\s*(.*?)\s*-->")
MARKER = re.compile(r"<!--\s*chapter:\s*(\d+)\s*-->")
REPLACE_RETRIES = 3


class LibraryError(Exception):
    """A request the library cannot honor, with a message fit to show a user."""


class NotFound(LibraryError):
    pass


class Conflict(LibraryError):
    pass


def check_slug(slug: str) -> str:
    if not SLUG.fullmatch(slug):
        raise LibraryError("A book slug uses a-z, 0-9 and '-', starting with a letter or digit.")
    return slug


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """Write to a temp file beside the target, then swap it in.

    os.replace can fail with PermissionError on Windows while another process
    (an editor, the dev server) holds the file open, so it is retried.
    """

    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        for attempt in range(REPLACE_RETRIES):
            try:
                os.replace(temp, path)
                return
            except PermissionError:
                if attempt == REPLACE_RETRIES - 1:
                    raise
                time.sleep(0.1 * (attempt + 1))
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def atomic_write_json(path: Path, value: Any) -> None:
    text = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    atomic_write_bytes(path, text.encode("utf-8"))


def read_json(path: Path, default: Any = None) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def parse_raw(text: str) -> tuple[dict[str, str], str]:
    """The header comments (image, book-page, source) and the page body."""

    headers: dict[str, str] = {}
    lines = text.splitlines()
    body_start = 0
    for i, line in enumerate(lines):
        match = HEADER.fullmatch(line.strip())
        if match and match.group(1) in ("image", "book-page", "source"):
            headers[match.group(1)] = match.group(2)
            body_start = i + 1
            continue
        if line.strip():
            break
    return headers, "\n".join(lines[body_start:]).strip()


def render_raw(image: int, book_page: int | None, source: str, text: str) -> str:
    """A raw page file: the code-made header, a blank line, then the OCR text."""

    page = "?" if book_page is None else str(book_page)
    return (
        f"<!-- image: {image:03d} -->\n<!-- book-page: {page} -->\n<!-- source: {source} -->\n\n"
        f"{text.strip()}\n"
    )


class LibraryRepository:
    def __init__(self, root: Path) -> None:
        self.root = root
        self._locks: dict[str, threading.RLock] = {}
        self._locks_guard = threading.Lock()

    # --- locking

    def lock(self, slug: str) -> threading.RLock:
        with self._locks_guard:
            return self._locks.setdefault(slug, threading.RLock())

    def _edit(self, slug: str, fn: Callable[[], Any]) -> Any:
        with self.lock(slug):
            return fn()

    # --- paths

    def book_dir(self, slug: str) -> Path:
        return self.root / check_slug(slug)

    def require_book(self, slug: str) -> Path:
        path = self.book_dir(slug)
        if not (path / "book.json").is_file():
            raise NotFound(f"No book {slug!r}.")
        return path

    # --- reads

    def list_slugs(self) -> list[str]:
        if not self.root.is_dir():
            return []
        return sorted(
            entry.name
            for entry in self.root.iterdir()
            if SLUG.fullmatch(entry.name) and (entry / "book.json").is_file()
        )

    def book(self, slug: str) -> dict[str, Any]:
        return read_json(self.require_book(slug) / "book.json")

    def index(self, slug: str) -> dict[str, Any]:
        return read_json(
            self.require_book(slug) / "index.json", {"title": "", "author": "", "chapters": []}
        )

    def characters(self, slug: str) -> dict[str, Any]:
        return read_json(self.require_book(slug) / "characters.json", {})

    def chapter(self, slug: str, chapter_id: str) -> dict[str, Any] | None:
        if not CHAPTER_ID.fullmatch(chapter_id):
            raise LibraryError(f"Bad chapter id {chapter_id!r}.")
        return read_json(self.require_book(slug) / "chapters" / f"{chapter_id}.json")

    def drafts(self, slug: str) -> list[dict[str, Any]]:
        folder = self.require_book(slug) / "drafts"
        if not folder.is_dir():
            return []
        return [read_json(path) for path in sorted(folder.glob("v*-c*.json"))]

    def summaries(self, slug: str, volume: int) -> dict[str, Any] | None:
        return read_json(self.require_book(slug) / "summaries" / f"v{volume}.json")

    def raw_dir(self, slug: str, volume: int) -> Path:
        return self.require_book(slug) / "raw" / f"v{volume}"

    def raw_images(self, slug: str, volume: int) -> list[int]:
        folder = self.raw_dir(slug, volume)
        if not folder.is_dir():
            return []
        return sorted(
            int(m.group(1)) for p in folder.iterdir() if (m := RAW_NAME.fullmatch(p.name))
        )

    def raw_path(self, slug: str, volume: int, image: int) -> Path:
        return self.raw_dir(slug, volume) / f"img-{image:03d}.txt"

    def raw(self, slug: str, volume: int, image: int) -> tuple[dict[str, str], str] | None:
        path = self.raw_path(slug, volume, image)
        if not path.is_file():
            return None
        return parse_raw(path.read_text(encoding="utf-8"))

    def raw_markers(self, slug: str, volume: int) -> dict[int, list[int]]:
        """Image number → chapter markers OCR proposed on that page."""

        found: dict[int, list[int]] = {}
        for image in self.raw_images(slug, volume):
            text = self.raw_path(slug, volume, image).read_text(encoding="utf-8")
            if markers := [int(n) for n in MARKER.findall(text)]:
                found[image] = markers
        return found

    # --- writes

    def create_book(self, slug: str, card: dict[str, Any]) -> dict[str, Any]:
        def run() -> dict[str, Any]:
            path = self.book_dir(slug)
            if (path / "book.json").exists():
                raise Conflict(f"Book {slug!r} already exists.")
            atomic_write_json(path / "book.json", card)
            return card

        return self._edit(slug, run)

    def update_book(self, slug: str, patch: dict[str, Any]) -> dict[str, Any]:
        """Merge top-level fields; a None value removes the field."""

        def run() -> dict[str, Any]:
            card = self.book(slug)
            for key, value in patch.items():
                if value is None:
                    card.pop(key, None)
                else:
                    card[key] = value
            atomic_write_json(self.book_dir(slug) / "book.json", card)
            return card

        return self._edit(slug, run)

    def set_volume(self, slug: str, volume: dict[str, Any]) -> dict[str, Any]:
        """Insert or replace one entry of book.json `volumes`, kept sorted by n."""

        def run() -> dict[str, Any]:
            card = self.book(slug)
            volumes = [v for v in card.get("volumes", []) if v.get("n") != volume["n"]]
            volumes.append(volume)
            card["volumes"] = sorted(volumes, key=lambda v: v["n"])
            atomic_write_json(self.book_dir(slug) / "book.json", card)
            return card

        return self._edit(slug, run)

    def save_asset(self, slug: str, name: str, data: bytes) -> None:
        if not re.fullmatch(r"[a-z0-9-]+\.(webp|jpg|jpeg|png)", name):
            raise LibraryError(f"Bad asset name {name!r}.")
        self._edit(
            slug, lambda: atomic_write_bytes(self.require_book(slug) / "assets" / name, data)
        )

    def write_raw(
        self, slug: str, volume: int, image: int, book_page: int | None, source: str, text: str
    ) -> Path:
        """Accept an OCR result as the page's raw text. Never overwrites an existing page."""

        def run() -> Path:
            path = self.raw_path(slug, volume, image)
            if path.exists():
                raise Conflict(f"raw/v{volume}/img-{image:03d}.txt already exists.")
            atomic_write_bytes(path, render_raw(image, book_page, source, text).encode("utf-8"))
            return path

        return self._edit(slug, run)

    def write_draft(self, slug: str, chapter: dict[str, Any]) -> None:
        if not CHAPTER_ID.fullmatch(str(chapter.get("id"))):
            raise LibraryError("A draft needs an id like v1-c12.")
        self._edit(
            slug,
            lambda: atomic_write_json(
                self.require_book(slug) / "drafts" / f"{chapter['id']}.json", chapter
            ),
        )

    def delete_draft(self, slug: str, chapter_id: str) -> None:
        if not CHAPTER_ID.fullmatch(chapter_id):
            raise LibraryError(f"Bad chapter id {chapter_id!r}.")
        self._edit(
            slug,
            lambda: (self.require_book(slug) / "drafts" / f"{chapter_id}.json").unlink(
                missing_ok=True
            ),
        )

    def draft(self, slug: str, chapter_id: str) -> dict[str, Any] | None:
        if not CHAPTER_ID.fullmatch(chapter_id):
            raise LibraryError(f"Bad chapter id {chapter_id!r}.")
        return read_json(self.require_book(slug) / "drafts" / f"{chapter_id}.json")

    def update_characters(self, slug: str, fn: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
        """Read characters.json, let `fn` change it in place, write it back, under the book lock."""

        def run() -> dict[str, Any]:
            characters = self.characters(slug)
            fn(characters)
            atomic_write_json(self.require_book(slug) / "characters.json", characters)
            return characters

        return self._edit(slug, run)

    def publish_chapter(self, slug: str, chapter: dict[str, Any]) -> None:
        """Write the chapter file, then add or replace its entry in index.json, in that order."""

        def run() -> None:
            book = self.require_book(slug)
            if not CHAPTER_ID.fullmatch(str(chapter.get("id"))):
                raise LibraryError("A chapter needs an id like v1-c12.")
            atomic_write_json(book / "chapters" / f"{chapter['id']}.json", chapter)
            index = self.index(slug)
            entry = {k: v for k, v in chapter.items() if k not in ("blocks", "sourcePages")}
            entries = [e for e in index["chapters"] if e["id"] != chapter["id"]]
            entries.append(entry)
            index["chapters"] = sorted(entries, key=lambda e: (e["volume"], e["chapter"]))
            atomic_write_json(book / "index.json", index)

        self._edit(slug, run)

    def write_summaries(self, slug: str, volume: int, value: dict[str, Any]) -> None:
        self._edit(
            slug,
            lambda: atomic_write_json(
                self.require_book(slug) / "summaries" / f"v{volume}.json", value
            ),
        )
