"""Pipeline status computed from files only; nothing is stored separately.

Per volume: page images, OCR'd pages, pages already chat (draft or published),
published pages, and whether a source PDF exists. Per chapter (from book.json
`volumes[].chapters`): raw complete, scanned, drafted, published, summarized.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ...core.workdir import VOLUME_DIR, Workdir
from .repository import LibraryRepository, NotFound, read_json


def _image_by_book_page(repo: LibraryRepository, book: str, volume: int) -> dict[int, int]:
    """Printed page number → image number, read from the raw headers."""

    found: dict[int, int] = {}
    for image in repo.raw_images(book, volume):
        parsed = repo.raw(book, volume, image)
        page = parsed[0].get("book-page", "") if parsed else ""
        if page.isdigit():
            found.setdefault(int(page), image)
    return found


def _chapter_ranges(volume: dict[str, Any]) -> list[tuple[dict[str, Any], int, int | None]]:
    """Each chapter with its first image and last image (None while the volume is open)."""

    chapters = sorted(volume.get("chapters", []), key=lambda c: c["startImage"])
    ranges = []
    for i, chapter in enumerate(chapters):
        if i + 1 < len(chapters):
            end: int | None = chapters[i + 1]["startImage"] - 1
        else:
            end = volume.get("endImage") if volume.get("closed") else None
        ranges.append((chapter, chapter["startImage"], end))
    return ranges


def cover_images(workdir: Workdir, book: str, volume: int) -> set[int]:
    """Pages a person (or the first-page rule) confirmed as cover/illustration: no raw needed."""

    folder = workdir.volume(book, volume) / "ocr"
    if not folder.is_dir():
        return set()
    found = set()
    for page_dir in folder.iterdir():
        if page_dir.is_dir() and page_dir.name.isdigit():
            for path in page_dir.glob("*__*.json"):
                if ((read_json(path) or {}).get("accept") or {}).get("state") == "cover":
                    found.add(int(page_dir.name))
                    break
    return found


@dataclass
class ChapterPages:
    """One book chapter's pages: raw text per page, cover pages, and pages still missing."""

    n: int
    title: str | None
    start: int
    end: int | None  # None while the chapter is the last one of an open volume
    texts: dict[int, str] = field(default_factory=dict)  # image -> raw body, in page order
    book_pages: dict[int, str] = field(default_factory=dict)  # image -> printed page ("?" unknown)
    covers: list[int] = field(default_factory=list)
    missing: list[int] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        return self.end is not None and not self.missing and bool(self.texts)


def volume_meta(card: dict[str, Any], volume: int) -> dict[str, Any]:
    return next((v for v in card.get("volumes", []) if v.get("n") == volume), {"n": volume})


def chapter_pages(
    repo: LibraryRepository, workdir: Workdir, book: str, volume: int, n: int
) -> ChapterPages:
    meta = volume_meta(repo.book(book), volume)
    found = next((r for r in _chapter_ranges(meta) if r[0]["n"] == n), None)
    if found is None:
        raise NotFound(f"Volume {volume} has no chapter {n} in its chapter boundaries.")
    chapter, start, end = found
    pages = ChapterPages(n=n, title=chapter.get("title"), start=start, end=end)
    if end is None:
        return pages
    covers = cover_images(workdir, book, volume)
    for image in range(start, end + 1):
        raw = repo.raw(book, volume, image)
        if raw is not None:
            pages.texts[image] = raw[1]
            pages.book_pages[image] = raw[0].get("book-page", "?")
        elif image in covers:
            pages.covers.append(image)
        else:
            pages.missing.append(image)
    return pages


def volume_status(
    repo: LibraryRepository,
    workdir: Workdir,
    book: str,
    volume: int,
    card: dict[str, Any],
    pdf_pages: int | None = None,
    scanned: Callable[[int], bool] = lambda n: False,
) -> dict[str, Any]:
    entries = [e for e in repo.index(book)["chapters"] if e.get("volume") == volume]
    published_ids = {e["id"] for e in entries}
    drafts = [d for d in repo.drafts(book) if d.get("volume") == volume]
    to_image = _image_by_book_page(repo, book, volume)

    def images_of(chapters: list[dict[str, Any]]) -> set[int]:
        pages = {p for c in chapters for p in c.get("sourcePages", [])}
        return {to_image[p] for p in pages if p in to_image}

    published_chapters = [c for i in published_ids if (c := repo.chapter(book, i))]
    published_images = images_of(published_chapters)
    # drafts record their page images; published chapters only have printed page numbers
    draft_images = {i for d in drafts for i in (d.get("draft") or {}).get("images", [])}
    chat_images = published_images | images_of(drafts) | draft_images
    raw_images = set(repo.raw_images(book, volume))
    page_images = workdir.page_images(book, volume)
    done_images = raw_images | cover_images(workdir, book, volume)
    summary_file = repo.summaries(book, volume) or {}
    summaries = summary_file.get("chapters", {})
    meta = volume_meta(card, volume)

    chapters = []
    for chapter, start, end in _chapter_ranges(meta):
        n = chapter["n"]
        span = set(range(start, end + 1)) if end is not None else None
        chapters.append(
            {
                "n": n,
                "title": chapter.get("title"),
                "startImage": start,
                "endImage": end,
                "rawComplete": span is not None and span <= done_images,
                "scanned": scanned(n),
                "drafted": any(d.get("bookChapter") == n for d in drafts),
                "published": any(e.get("bookChapter") == n for e in entries),
                "summarized": str(n) in summaries,
            }
        )

    return {
        "n": volume,
        "title": meta.get("title") or next((e.get("volumeTitle") for e in entries), None),
        "closed": bool(meta.get("closed")),
        "hasSource": workdir.source_pdf(book, volume).is_file(),
        # Pages render lazily, so the total comes from the PDF when there is one.
        "pages": max([pdf_pages or 0, *page_images.keys(), *raw_images], default=0),
        "ocrPages": len(raw_images),
        "chatPages": len(chat_images),
        "publishedPages": len(published_images),
        "publishedChapters": len(entries),
        "drafts": len(drafts),
        "imported": bool(summary_file.get("imported")),
        "summarized": "volume" in summary_file,
        "chapters": chapters,
    }


def book_status(
    repo: LibraryRepository,
    workdir: Workdir,
    book: str,
    pdf_pages: Callable[[str, int], int | None] = lambda book, volume: None,
    scanned: Callable[[str, int, int], bool] = lambda book, volume, n: False,
) -> dict[str, Any]:
    card = repo.book(book)
    numbers = {v["n"] for v in card.get("volumes", [])}
    numbers |= {e["volume"] for e in repo.index(book)["chapters"]}
    numbers |= workdir.volumes_on_disk(book)
    raw_root = repo.require_book(book) / "raw"
    if raw_root.is_dir():
        numbers |= {int(p.name[1:]) for p in raw_root.iterdir() if VOLUME_DIR.fullmatch(p.name)}
    numbers = {n for n in numbers if 1 <= n <= 999}
    return {
        "book": book,
        "volumes": [
            volume_status(
                repo,
                workdir,
                book,
                n,
                card,
                pdf_pages(book, n),
                lambda chapter, n=n: scanned(book, n, chapter),
            )
            for n in sorted(numbers)
        ],
    }
