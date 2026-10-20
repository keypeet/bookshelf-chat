"""Convert jobs (one book chapter, a few pages per call), draft review, publish."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, Field

from ...core.services import Services, services
from ..jobs.calls import ModelChoice
from ..jobs.router import JobOut, job_out
from ..library.repository import check_slug
from .service import MAX_PAGES_PER_CALL, PAGES_PER_CALL

router = APIRouter(tags=["convert"])

VolumeN = Annotated[int, Path(ge=1, le=999)]
DraftId = Annotated[str, Path(pattern=r"^v\d{1,3}-c\d{1,5}$")]


class TextModelIn(BaseModel):
    provider: str = Field(max_length=32)
    model: str = Field(max_length=64)
    effort: str = Field(max_length=16)


class ConvertJobIn(BaseModel):
    book: str
    volume: int = Field(ge=1, le=999)
    chapter: int = Field(ge=1, le=999)
    model: TextModelIn
    pagesPerCall: int = Field(default=PAGES_PER_CALL, ge=1, le=MAX_PAGES_PER_CALL)
    parallel: int = Field(default=2, ge=1, le=4)
    acceptRisk: bool = False  # go on although the chapter before has no summary yet
    dryRun: bool = False


class ConvertPlanOut(BaseModel):
    pages: list[int]
    covers: list[int]
    batches: list[list[int]]
    calls: int
    firstEpisode: int | None
    blockers: list[str]
    warnings: list[str]


class ConvertJobCreated(BaseModel):
    plan: ConvertPlanOut
    job: JobOut | None


class BlockIn(BaseModel):
    type: Literal["narration", "scene", "gap", "dialogue", "thought"]
    text: str | None = Field(default=None, max_length=20_000)
    note: str | None = Field(default=None, max_length=2_000)
    speaker: str | None = Field(default=None, max_length=64)
    speakerNum: int | None = Field(default=None, ge=1, le=999)
    action: str | None = Field(default=None, max_length=2_000)
    needsReview: bool | None = None


class DraftPatch(BaseModel):
    blocks: list[BlockIn] = Field(max_length=2_000)
    title: str | None = Field(default=None, max_length=200)


class DraftRow(BaseModel):
    id: str
    chapter: int
    bookChapter: int | None
    title: str
    images: list[int]
    blocks: int
    flags: int
    outside: int


class RawPage(BaseModel):
    image: int
    text: str


class CoverageOut(BaseModel):
    ratio: float | None
    missing: list[str]
    ok: bool


class Speaker(BaseModel):
    key: str
    name: str
    generic: bool


class DraftDetail(BaseModel):
    draft: dict[str, Any]
    raw: list[RawPage]
    coverage: CoverageOut
    problems: list[str]
    speakers: list[Speaker]
    siblings: list[str]


class PublishOut(BaseModel):
    id: str
    published: bool


@router.post("/api/convert/jobs", response_model=ConvertJobCreated)
async def create_job(body: ConvertJobIn, s: Services = Depends(services)) -> ConvertJobCreated:
    """With `dryRun`, only plan: the calls, and what blocks (hard) or warns (soft) before it."""

    check_slug(body.book)
    choice = ModelChoice(**body.model.model_dump())
    plan = s.convert.plan(body.book, body.volume, body.chapter, choice, body.pagesPerCall)
    if body.dryRun:
        return ConvertJobCreated(plan=ConvertPlanOut(**plan), job=None)
    record = s.convert.create_job(
        body.book,
        body.volume,
        body.chapter,
        choice,
        body.pagesPerCall,
        body.parallel,
        body.acceptRisk,
    )
    return ConvertJobCreated(plan=ConvertPlanOut(**plan), job=job_out(s, record))


@router.get("/api/books/{book}/volumes/{volume}/drafts", response_model=list[DraftRow])
def list_drafts(book: str, volume: VolumeN, s: Services = Depends(services)) -> list[dict]:
    return s.convert.drafts(book, volume)


@router.get("/api/books/{book}/drafts/{draft_id}", response_model=DraftDetail)
def get_draft(book: str, draft_id: DraftId, s: Services = Depends(services)) -> dict[str, Any]:
    return s.convert.detail(book, draft_id)


@router.patch("/api/books/{book}/drafts/{draft_id}", response_model=DraftDetail)
def save_draft(
    book: str, draft_id: DraftId, body: DraftPatch, s: Services = Depends(services)
) -> dict[str, Any]:
    blocks = [b.model_dump(exclude_none=True) for b in body.blocks]
    return s.convert.save(book, draft_id, blocks, body.title)


@router.post("/api/books/{book}/drafts/{draft_id}/publish", response_model=PublishOut)
def publish_draft(book: str, draft_id: DraftId, s: Services = Depends(services)) -> dict:
    """Refused while a flag, a speaker outside the roster or a coverage failure remains."""

    return s.convert.publish(book, draft_id)
