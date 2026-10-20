"""OCR jobs: plan (call count) and start. Watching, cancel and resume are /api/jobs."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ...core.services import Services, services
from ..jobs.router import JobOut, job_out
from ..library.repository import LibraryError, check_slug
from .service import ModelChoice

router = APIRouter(prefix="/api/ocr", tags=["ocr"])


class ModelChoiceIn(BaseModel):
    provider: str = Field(max_length=32)
    model: str = Field(max_length=64)
    effort: str = Field(max_length=16)


class OcrJobIn(BaseModel):
    """ "ส่งไป N หน้า ทีละ M หน้า": `count` pages from `from_`, `parallel` calls at a time."""

    book: str
    volume: int = Field(ge=1, le=999)
    from_: int = Field(alias="from", ge=1, le=9999)
    count: int = Field(ge=1, le=2000)
    parallel: int = Field(default=2, ge=1, le=8)
    models: list[ModelChoiceIn] = Field(min_length=1, max_length=4)
    dryRun: bool = False

    model_config = {"populate_by_name": True}


class OcrPlanOut(BaseModel):
    pages: list[int]
    alreadyDone: list[int]
    calls: int
    lastPage: int


class OcrJobCreated(BaseModel):
    plan: OcrPlanOut
    job: JobOut | None


@router.post("/jobs", response_model=OcrJobCreated)
async def create_job(body: OcrJobIn, s: Services = Depends(services)) -> OcrJobCreated:
    """With `dryRun`, only plan: which pages would be called and how many calls that is.

    Several models: each page is called once per model and every page goes to the queue.
    """

    check_slug(body.book)
    choices = [ModelChoice(**m.model_dump()) for m in body.models]
    plan = s.ocr.plan(body.book, body.volume, body.from_, body.count, choices)
    if body.dryRun:
        return OcrJobCreated(plan=OcrPlanOut(**plan), job=None)
    if not plan["pages"]:
        raise LibraryError("No pages in that range.")
    record = s.ocr.create_job(
        body.book, body.volume, body.from_, body.count, body.parallel, choices
    )
    return OcrJobCreated(plan=OcrPlanOut(**plan), job=job_out(s, record))
