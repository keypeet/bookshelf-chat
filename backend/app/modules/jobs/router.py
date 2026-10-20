"""Background jobs of every kind (ocr, scan, convert, summarize): list, watch, cancel, resume."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ...core.services import Services, services
from ..library.repository import LibraryError

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


class JobItem(BaseModel):
    state: str
    detail: str


class JobOut(BaseModel):
    id: str
    kind: str
    book: str
    volume: int
    state: str
    params: dict[str, Any]
    createdAt: str
    updatedAt: str
    items: dict[str, JobItem]
    running: bool


def job_out(s: Services, record: dict[str, Any]) -> JobOut:
    return JobOut(**record, running=s.runner.is_running(record["id"]))


@router.get("", response_model=list[JobOut])
def list_jobs(
    book: str | None = None, kind: str | None = None, s: Services = Depends(services)
) -> list[JobOut]:
    return [job_out(s, r) for r in s.runner.list(book) if kind is None or r.get("kind") == kind]


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: str, s: Services = Depends(services)) -> JobOut:
    return job_out(s, s.runner.get(job_id))


@router.post("/{job_id}/cancel", response_model=JobOut)
async def cancel_job(job_id: str, s: Services = Depends(services)) -> JobOut:
    return job_out(s, await s.runner.cancel(job_id))


@router.post("/{job_id}/resume", response_model=JobOut)
async def resume_job(job_id: str, s: Services = Depends(services)) -> JobOut:
    """Run again only what has no good result yet."""

    if s.runner.is_running(job_id):
        raise LibraryError("The job is already running.")
    return job_out(s, s.start_job(job_id))
