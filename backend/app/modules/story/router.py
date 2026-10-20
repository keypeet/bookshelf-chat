"""Character scan and summary jobs, proposals, summary approval, and the story page."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, Field

from ...core.services import Services, services
from ..convert.router import TextModelIn
from ..jobs.calls import ModelChoice
from ..jobs.router import JobOut, job_out
from ..library.repository import check_slug

router = APIRouter(tags=["story"])

VolumeN = Annotated[int, Path(ge=1, le=999)]
ProposalId = Annotated[str, Path(max_length=40)]


class ScanJobIn(BaseModel):
    book: str
    volume: int = Field(ge=1, le=999)
    chapter: int = Field(ge=1, le=999)
    model: TextModelIn


class SummaryJobIn(BaseModel):
    """`chapter` null = the volume summary (after every chapter summary is approved)."""

    book: str
    volume: int = Field(ge=1, le=999)
    chapter: int | None = Field(default=None, ge=1, le=999)
    model: TextModelIn


class Proposal(BaseModel):
    id: str
    kind: str
    key: str
    value: dict[str, Any]
    evidence: str
    state: str
    volume: int
    chapter: int | None
    source: str


class ApproveIn(BaseModel):
    chapter: int | None = Field(default=None, ge=1, le=999)
    summary: str | None = Field(default=None, max_length=10_000)  # edited text, else the AI's
    short: str | None = Field(default=None, max_length=2_000)


class ImportedIn(BaseModel):
    imported: bool


class ChapterSummary(BaseModel):
    n: int
    title: str | None
    approved: dict[str, Any] | None
    pending: dict[str, Any] | None


class VolumeStory(BaseModel):
    n: int
    title: str | None
    closed: bool
    imported: bool
    chapters: list[ChapterSummary]
    volume: dict[str, Any] | None
    volumePending: dict[str, Any] | None


class StoryOut(BaseModel):
    book: str
    title: str
    styleNotes: str | None
    characters: dict[str, dict[str, Any]]
    proposals: list[Proposal]
    notes: list[dict[str, Any]]
    volumes: list[VolumeStory]


@router.post("/api/scan/jobs", response_model=JobOut)
async def create_scan(body: ScanJobIn, s: Services = Depends(services)) -> JobOut:
    check_slug(body.book)
    choice = ModelChoice(**body.model.model_dump())
    return job_out(s, s.story.create_scan_job(body.book, body.volume, body.chapter, choice))


@router.post("/api/summarize/jobs", response_model=JobOut)
async def create_summary(body: SummaryJobIn, s: Services = Depends(services)) -> JobOut:
    check_slug(body.book)
    choice = ModelChoice(**body.model.model_dump())
    return job_out(s, s.story.create_summary_job(body.book, body.volume, body.chapter, choice))


@router.get("/api/books/{book}/proposals", response_model=list[Proposal])
def list_proposals(book: str, s: Services = Depends(services)) -> list[dict[str, Any]]:
    return s.story.proposals(book)


@router.post("/api/books/{book}/proposals/{proposal_id}/accept", response_model=dict[str, Any])
def accept_proposal(
    book: str, proposal_id: ProposalId, s: Services = Depends(services)
) -> dict[str, Any]:
    s.repo.require_book(book)
    return s.story.decide(book, proposal_id, accept=True)


@router.post("/api/books/{book}/proposals/{proposal_id}/reject", response_model=dict[str, Any])
def reject_proposal(
    book: str, proposal_id: ProposalId, s: Services = Depends(services)
) -> dict[str, Any]:
    s.repo.require_book(book)
    return s.story.decide(book, proposal_id, accept=False)


@router.post("/api/books/{book}/volumes/{volume}/summaries/approve", response_model=dict[str, Any])
def approve_summary(
    book: str, volume: VolumeN, body: ApproveIn, s: Services = Depends(services)
) -> dict[str, Any]:
    s.repo.require_book(book)
    return s.story.approve_summary(book, volume, body.chapter, body.summary, body.short)


@router.put("/api/books/{book}/volumes/{volume}/imported", response_model=dict[str, Any])
def set_imported(
    book: str, volume: VolumeN, body: ImportedIn, s: Services = Depends(services)
) -> dict[str, Any]:
    """A volume published before summaries existed skips the summary gates."""

    s.repo.require_book(book)
    return s.story.set_imported(book, volume, body.imported)


@router.get("/api/books/{book}/story", response_model=StoryOut)
def get_story(book: str, s: Services = Depends(services)) -> dict[str, Any]:
    return s.story.story(book)
