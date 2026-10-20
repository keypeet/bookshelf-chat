"""Books, volumes, chapter boundaries, sources, pages and pipeline status."""

from __future__ import annotations

import asyncio
import io
import re
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Path, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, field_validator

from ...core.services import Services, services
from ..library.repository import LibraryError, NotFound, atomic_write_bytes, check_slug
from ..library.status import book_status

router = APIRouter(prefix="/api/books", tags=["books"])

VolumeN = Annotated[int, Path(ge=1, le=999)]
ImageN = Annotated[int, Path(ge=1, le=9999)]

COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
UPLOAD_CHUNK = 1024 * 1024
COVER_MAX_SIDE = 1200


class ChapterBoundary(BaseModel):
    n: int = Field(ge=1, le=999)
    title: str | None = Field(default=None, max_length=200)
    startImage: int = Field(ge=1, le=9999)


class Volume(BaseModel):
    n: int = Field(ge=1, le=999)
    title: str | None = None
    cover: str | None = None
    chapters: list[ChapterBoundary] = []
    closed: bool | None = None
    endImage: int | None = None


class BookCard(BaseModel):
    slug: str
    title: str
    author: str | None = None
    language: str | None = None
    cover: str | None = None
    coverColor: str | None = None
    styleNotes: str | None = None
    aliases: list[str] | None = None
    volumes: list[Volume] | None = None


class BookCreate(BaseModel):
    slug: str
    title: str = Field(min_length=1, max_length=200)
    author: str | None = Field(default=None, max_length=200)
    language: str | None = Field(default="th", max_length=16)
    coverColor: str | None = None
    styleNotes: str | None = Field(default=None, max_length=4000)
    aliases: list[str] | None = None

    @field_validator("slug")
    @classmethod
    def _slug(cls, value: str) -> str:
        return check_slug(value)

    @field_validator("coverColor")
    @classmethod
    def _color(cls, value: str | None) -> str | None:
        if value is not None and not COLOR.fullmatch(value):
            raise ValueError("Use a color like #2f6f5e.")
        return value


class BookPatch(BaseModel):
    """Only the fields sent are changed; send null to remove an optional field."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    author: str | None = Field(default=None, max_length=200)
    language: str | None = Field(default=None, max_length=16)
    coverColor: str | None = None
    styleNotes: str | None = Field(default=None, max_length=4000)
    aliases: list[str] | None = None
    removeCover: bool = False

    @field_validator("coverColor")
    @classmethod
    def _color(cls, value: str | None) -> str | None:
        if value is not None and not COLOR.fullmatch(value):
            raise ValueError("Use a color like #2f6f5e.")
        return value


class ChaptersIn(BaseModel):
    """Chapter boundaries of one volume.

    `endImage` closes the volume at that page ("จบเล่มที่หน้า N").
    """

    title: str | None = Field(default=None, max_length=200)
    chapters: list[ChapterBoundary]
    endImage: int | None = Field(default=None, ge=1, le=9999)


class CoverFromPageIn(BaseModel):
    volume: int = Field(ge=1, le=999)
    image: int = Field(ge=1, le=9999)


class SourceOut(BaseModel):
    pages: int


class ChapterStatus(BaseModel):
    n: int
    title: str | None
    startImage: int
    endImage: int | None
    rawComplete: bool
    scanned: bool
    drafted: bool
    published: bool
    summarized: bool


class VolumeStatus(BaseModel):
    n: int
    title: str | None
    closed: bool
    hasSource: bool
    pages: int
    ocrPages: int
    chatPages: int
    publishedPages: int
    publishedChapters: int
    drafts: int
    imported: bool
    summarized: bool
    chapters: list[ChapterStatus]


class BookStatus(BaseModel):
    book: str
    volumes: list[VolumeStatus]


class CandidateOut(BaseModel):
    provider: str
    model: str
    status: str
    accept: str | None
    reasons: list[str]


class PageOut(BaseModel):
    image: int
    hasImage: bool
    raw: bool
    marker: list[int]
    candidates: list[CandidateOut]


class PagesOut(BaseModel):
    lastPage: int
    hasSource: bool
    pages: list[PageOut]


class OcrResultOut(BaseModel):
    text: str
    bookPage: int | None
    uncertain: list[str]
    isCover: bool


class CandidateDetail(CandidateOut):
    effort: str | None
    errorKind: str | None
    durationMs: int | None
    result: OcrResultOut | None


class RawOut(BaseModel):
    bookPage: str | None
    text: str


class PageDetail(BaseModel):
    """One page for the compare screen: image, existing raw, and every model's result."""

    image: int
    lastPage: int
    hasImage: bool
    raw: RawOut | None
    candidates: list[CandidateDetail]


class QueueEntry(BaseModel):
    image: int
    provider: str
    model: str
    reasons: list[str]
    rawExists: bool
    cover: bool


class AcceptIn(BaseModel):
    provider: str = Field(pattern=r"^[a-z][a-z0-9-]{1,31}$")
    model: str = Field(pattern=r"^[a-z0-9.\-]{1,64}$")
    text: str | None = Field(default=None, max_length=50_000)


class AcceptOut(BaseModel):
    state: str
    reasons: list[str]


def _card(slug: str, card: dict[str, Any]) -> BookCard:
    return BookCard(slug=slug, **card)


@router.get("", response_model=list[BookCard])
def list_books(s: Services = Depends(services)) -> list[BookCard]:
    return [_card(slug, s.repo.book(slug)) for slug in s.repo.list_slugs()]


@router.post("", response_model=BookCard, status_code=201)
def create_book(body: BookCreate, s: Services = Depends(services)) -> BookCard:
    card = body.model_dump(exclude={"slug"}, exclude_none=True)
    return _card(body.slug, s.repo.create_book(body.slug, card))


@router.get("/{book}", response_model=BookCard)
def get_book(book: str, s: Services = Depends(services)) -> BookCard:
    return _card(book, s.repo.book(book))


@router.patch("/{book}", response_model=BookCard)
def update_book(book: str, body: BookPatch, s: Services = Depends(services)) -> BookCard:
    patch = body.model_dump(exclude_unset=True, exclude={"removeCover"})
    if body.removeCover:
        patch["cover"] = None
    return _card(book, s.repo.update_book(book, patch))


@router.post("/{book}/cover", response_model=BookCard)
async def upload_cover(
    book: str, file: UploadFile = File(...), s: Services = Depends(services)
) -> BookCard:
    """Save an uploaded image as assets/cover.webp (resized, re-encoded) and set book.json cover."""

    s.repo.require_book(book)
    data = await file.read(s.settings.max_cover_bytes + 1)
    if len(data) > s.settings.max_cover_bytes:
        raise LibraryError("The cover image is too large.")
    return _card(book, await asyncio.to_thread(_save_cover, s, book, data))


@router.post("/{book}/cover/from-page", response_model=BookCard)
async def cover_from_page(
    book: str, body: CoverFromPageIn, s: Services = Depends(services)
) -> BookCard:
    """Use one page of a volume's PDF (rendered if needed) as the book cover."""

    s.repo.require_book(book)
    page = await asyncio.to_thread(s.sources.ensure_page, book, body.volume, body.image)
    if page is None:
        raise NotFound("That page has no image and the volume has no PDF.")
    data = await asyncio.to_thread(page.read_bytes)
    return _card(book, await asyncio.to_thread(_save_cover, s, book, data))


def _save_cover(s: Services, book: str, data: bytes) -> dict[str, Any]:
    """Resize and re-encode an image as assets/cover.webp, then point book.json at it."""

    def encode() -> bytes:
        try:
            image = Image.open(io.BytesIO(data))
            image.load()
        except (UnidentifiedImageError, OSError) as exc:
            raise LibraryError("The file is not an image.") from exc
        image = image.convert("RGB")
        image.thumbnail((COVER_MAX_SIDE, COVER_MAX_SIDE))
        out = io.BytesIO()
        image.save(out, "WEBP", quality=85)
        return out.getvalue()

    encoded = encode()
    s.repo.save_asset(book, "cover.webp", encoded)
    # the reader serves covers from public/books/<slug>/ (ignored, normally filled by
    # scripts/sync-library-assets.mjs at startup), so refresh that copy too
    atomic_write_bytes(s.settings.root / "public" / "books" / book / "cover.webp", encoded)
    return s.repo.update_book(book, {"cover": "cover.webp"})


@router.put("/{book}/volumes/{volume}/chapters", response_model=BookCard)
def set_chapters(
    book: str, volume: VolumeN, body: ChaptersIn, s: Services = Depends(services)
) -> BookCard:
    starts = [c.startImage for c in body.chapters]
    numbers = [c.n for c in body.chapters]
    if len(set(starts)) != len(starts) or len(set(numbers)) != len(numbers):
        raise LibraryError("Each chapter needs its own number and start page.")
    if body.endImage is not None and starts and body.endImage < max(starts):
        raise LibraryError("The volume cannot end before its last chapter starts.")
    current = next((v for v in s.repo.book(book).get("volumes", []) if v.get("n") == volume), {})
    entry: dict[str, Any] = {
        "n": volume,
        **(
            {"title": body.title or current.get("title")}
            if body.title or current.get("title")
            else {}
        ),
        **({"cover": current["cover"]} if current.get("cover") else {}),
        "chapters": [
            c.model_dump(exclude_none=True)
            for c in sorted(body.chapters, key=lambda c: c.startImage)
        ],
    }
    if body.endImage is not None:
        entry["closed"] = True
        entry["endImage"] = body.endImage
    return _card(book, s.repo.set_volume(book, entry))


@router.get("/{book}/status", response_model=BookStatus)
def get_status(book: str, s: Services = Depends(services)) -> dict[str, Any]:
    return book_status(s.repo, s.workdir, book, s.sources.page_count, s.story.scanned)


@router.post("/{book}/volumes/{volume}/source", response_model=SourceOut, status_code=201)
async def upload_source(
    book: str, volume: VolumeN, file: UploadFile = File(...), s: Services = Depends(services)
) -> SourceOut:
    """Upload the volume's PDF. It is streamed to workdir/ with a size cap, then checked."""

    s.repo.require_book(book)
    upload = s.sources.upload_path(book, volume)
    written = 0
    try:
        with upload.open("wb") as handle:
            while chunk := await file.read(UPLOAD_CHUNK):
                written += len(chunk)
                if written > s.settings.max_pdf_bytes:
                    raise LibraryError("The PDF is too large.")
                handle.write(chunk)
    except BaseException:
        upload.unlink(missing_ok=True)
        raise
    pages = await asyncio.to_thread(s.sources.accept_upload, book, volume, upload)
    return SourceOut(pages=pages)


@router.get("/{book}/volumes/{volume}/pages", response_model=PagesOut)
def list_pages(book: str, volume: VolumeN, s: Services = Depends(services)) -> PagesOut:
    s.repo.require_book(book)
    images = s.workdir.page_images(book, volume)
    total = s.sources.page_count(book, volume) or 0
    raws = set(s.repo.raw_images(book, volume))
    markers = s.repo.raw_markers(book, volume)
    last = max([total, *images.keys(), *raws], default=0)
    pages = []
    for n in range(1, last + 1):
        candidates = [
            CandidateOut(
                provider=c["provider"],
                model=c["model"],
                status=c.get("status", "failed"),
                accept=(c.get("accept") or {}).get("state"),
                reasons=(c.get("accept") or {}).get("reasons", []),
            )
            for c in s.ocr.candidates(book, volume, n)
        ]
        pages.append(
            PageOut(
                image=n,
                hasImage=n in images,
                raw=n in raws,
                marker=markers.get(n, []),
                candidates=candidates,
            )
        )
    return PagesOut(lastPage=last, hasSource=total > 0, pages=pages)


@router.get("/{book}/volumes/{volume}/pages/{image}", response_model=PageDetail)
def page_detail(
    book: str, volume: VolumeN, image: ImageN, s: Services = Depends(services)
) -> PageDetail:
    s.repo.require_book(book)
    images = s.workdir.page_images(book, volume)
    raw = s.repo.raw(book, volume, image)
    last = max(
        [s.sources.page_count(book, volume) or 0, *images.keys(), *s.repo.raw_images(book, volume)],
        default=0,
    )
    candidates = []
    for c in s.ocr.candidates(book, volume, image):
        accept = c.get("accept") or {}
        result = c.get("result") if c.get("status") == "ok" else None
        candidates.append(
            CandidateDetail(
                provider=c["provider"],
                model=c["model"],
                effort=c.get("effort"),
                status=c.get("status", "failed"),
                accept=accept.get("state"),
                reasons=accept.get("reasons", []),
                errorKind=c.get("errorKind"),
                durationMs=c.get("durationMs"),
                result=OcrResultOut(**result) if result else None,
            )
        )
    return PageDetail(
        image=image,
        lastPage=last,
        hasImage=image in images,
        raw=RawOut(bookPage=raw[0].get("book-page"), text=raw[1]) if raw else None,
        candidates=candidates,
    )


@router.get("/{book}/volumes/{volume}/pages/{image}/image")
def page_image(
    book: str, volume: VolumeN, image: ImageN, s: Services = Depends(services)
) -> FileResponse:
    path = s.workdir.page_image(book, volume, image)
    if path is None:
        raise NotFound("No image for that page yet.")
    return FileResponse(path)


@router.get("/{book}/volumes/{volume}/ocr/queue", response_model=list[QueueEntry])
def ocr_queue(book: str, volume: VolumeN, s: Services = Depends(services)) -> list[dict[str, Any]]:
    s.repo.require_book(book)
    return s.ocr.queue(book, volume)


@router.post("/{book}/volumes/{volume}/pages/{image}/accept", response_model=AcceptOut)
def accept_page(
    book: str, volume: VolumeN, image: ImageN, body: AcceptIn, s: Services = Depends(services)
) -> dict[str, Any]:
    s.repo.require_book(book)
    return s.ocr.accept(book, volume, image, body.provider, body.model, body.text)


@router.post("/{book}/volumes/{volume}/pages/{image}/keep-raw", response_model=AcceptOut)
def keep_raw(
    book: str, volume: VolumeN, image: ImageN, body: AcceptIn, s: Services = Depends(services)
) -> dict[str, Any]:
    """Keep the page's existing raw text and clear this candidate from the queue."""

    s.repo.require_book(book)
    return s.ocr.keep_raw(book, volume, image, body.provider, body.model)
