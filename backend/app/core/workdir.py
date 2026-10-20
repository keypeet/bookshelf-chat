"""Paths under `workdir/` (never in git): source PDFs, page images, OCR candidates, jobs.

workdir/<book>/v<N>/source.pdf
workdir/<book>/v<N>/pages/NNN.webp
workdir/<book>/v<N>/ocr/NNN/<provider>__<model>.json
workdir/<book>/v<N>/jobs/<id>.json
"""

from __future__ import annotations

import re
from pathlib import Path

from ..modules.library.repository import check_slug

PAGE_NAME = re.compile(r"^(\d{3,4})\.(webp|png|jpg|jpeg)$", re.I)
CANDIDATE_PART = re.compile(r"^[a-z0-9][a-z0-9.\-]{0,63}$")
VOLUME_DIR = re.compile(r"^v(\d{1,3})$")


class Workdir:
    def __init__(self, root: Path) -> None:
        self.root = root

    def volume(self, book: str, volume: int) -> Path:
        if not 1 <= volume <= 999:
            raise ValueError("Volume numbers run from 1 to 999.")
        return self.root / check_slug(book) / f"v{volume}"

    def source_pdf(self, book: str, volume: int) -> Path:
        return self.volume(book, volume) / "source.pdf"

    def pages_dir(self, book: str, volume: int) -> Path:
        return self.volume(book, volume) / "pages"

    def page_images(self, book: str, volume: int) -> dict[int, Path]:
        folder = self.pages_dir(book, volume)
        if not folder.is_dir():
            return {}
        return {int(m.group(1)): p for p in folder.iterdir() if (m := PAGE_NAME.fullmatch(p.name))}

    def page_image(self, book: str, volume: int, image: int) -> Path | None:
        return self.page_images(book, volume).get(image)

    def ocr_dir(self, book: str, volume: int, image: int) -> Path:
        return self.volume(book, volume) / "ocr" / f"{image:03d}"

    def ocr_candidate(self, book: str, volume: int, image: int, provider: str, model: str) -> Path:
        if not (CANDIDATE_PART.fullmatch(provider) and CANDIDATE_PART.fullmatch(model)):
            raise ValueError("Bad provider or model id.")
        if not 1 <= image <= 9999:
            raise ValueError("Page numbers run from 1 to 9999.")
        return self.ocr_dir(book, volume, image) / f"{provider}__{model}.json"

    def convert_dir(self, book: str, volume: int, chapter: int) -> Path:
        """One chapter's convert calls: batch-NN.json each, with the prompt that was sent."""

        return self.volume(book, volume) / "convert" / f"c{chapter:03d}"

    def scan_file(self, book: str, volume: int, chapter: int) -> Path:
        return self.volume(book, volume) / "scan" / f"c{chapter:03d}.json"

    def summary_file(self, book: str, volume: int, chapter: int | None) -> Path:
        """A summary waiting for a person; `chapter=None` is the volume summary."""

        name = "volume.json" if chapter is None else f"c{chapter:03d}.json"
        return self.volume(book, volume) / "summaries" / name

    def jobs_dir(self, book: str, volume: int) -> Path:
        return self.volume(book, volume) / "jobs"

    def volumes_on_disk(self, book: str) -> set[int]:
        folder = self.root / check_slug(book)
        if not folder.is_dir():
            return set()
        found = {
            int(m.group(1))
            for p in folder.iterdir()
            if p.is_dir() and (m := VOLUME_DIR.fullmatch(p.name))
        }
        return {n for n in found if 1 <= n <= 999}

    def all_job_files(self) -> list[Path]:
        if not self.root.is_dir():
            return []
        return sorted(self.root.glob("*/v*/jobs/*.json"))
