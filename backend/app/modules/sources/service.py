"""Source PDFs and page images.

The backend chooses every path itself; no endpoint accepts one. Pages render
lazily, only for the range a job asks for, with pypdfium2.
"""

from __future__ import annotations

import io
import os
import threading
import uuid
from pathlib import Path

import pypdfium2 as pdfium

from ...core.workdir import Workdir
from ..library.repository import Conflict, LibraryError, atomic_write_bytes

PDF_MAGIC = b"%PDF-"
RENDER_SCALE = 2.0  # 144 dpi: enough for small Thai print, ~200 KB per page as webp
WEBP_QUALITY = 85

# pdfium is not thread-safe; renders run in worker threads, one at a time.
_PDFIUM_LOCK = threading.Lock()


class SourceService:
    def __init__(self, workdir: Workdir, *, max_bytes: int, max_pages: int) -> None:
        self.workdir = workdir
        self.max_bytes = max_bytes
        self.max_pages = max_pages

    def upload_path(self, book: str, volume: int) -> Path:
        """Where the router streams an upload before checking it (size capped while writing)."""

        target = self.workdir.source_pdf(book, volume)
        if target.exists():
            raise Conflict("This volume already has a source PDF.")
        target.parent.mkdir(parents=True, exist_ok=True)
        # one temp file per upload, so a double submit cannot interleave or delete another's bytes
        return target.with_name(f"source.{uuid.uuid4().hex}.upload")

    def accept_upload(self, book: str, volume: int, upload: Path) -> int:
        """Check a streamed upload and make it the volume's source. Returns its page count."""

        try:
            with upload.open("rb") as handle:
                if handle.read(len(PDF_MAGIC)) != PDF_MAGIC:
                    raise LibraryError("The file is not a PDF.")
            count = self._page_count(upload)
            if count > self.max_pages:
                raise LibraryError(f"The PDF has {count} pages; the limit is {self.max_pages}.")
            target = self.workdir.source_pdf(book, volume)
            try:
                os.link(upload, target)  # fails if another upload won the race
            except FileExistsError as exc:
                raise Conflict("This volume already has a source PDF.") from exc
            return count
        finally:
            upload.unlink(missing_ok=True)

    def page_count(self, book: str, volume: int) -> int | None:
        path = self.workdir.source_pdf(book, volume)
        if not path.is_file():
            return None
        return self._page_count(path)

    def ensure_page(self, book: str, volume: int, image: int) -> Path | None:
        """The page image, rendering it from the source PDF when missing."""

        existing = self.workdir.page_image(book, volume, image)
        if existing is not None:
            return existing
        pdf = self.workdir.source_pdf(book, volume)
        if not pdf.is_file():
            return None
        target = self.workdir.pages_dir(book, volume) / f"{image:03d}.webp"
        with _PDFIUM_LOCK:
            document = pdfium.PdfDocument(pdf)
            try:
                if not 1 <= image <= len(document):
                    return None
                bitmap = document[image - 1].render(scale=RENDER_SCALE)
                buffer = io.BytesIO()
                bitmap.to_pil().save(buffer, "WEBP", quality=WEBP_QUALITY)
            finally:
                document.close()
        atomic_write_bytes(target, buffer.getvalue())
        return target

    @staticmethod
    def _page_count(source: Path) -> int:
        with _PDFIUM_LOCK:
            try:
                document = pdfium.PdfDocument(source)
            except pdfium.PdfiumError as exc:
                raise LibraryError(f"The PDF could not be opened: {exc}") from exc
            try:
                return len(document)
            finally:
                document.close()
