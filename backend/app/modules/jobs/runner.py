"""A small job runner where result files are the truth.

A job is a list of items (pages). An item is done when its result file says
so; the job record only reports progress. Resume plans again and skips done
items; cancel cancels the task, which kills each running CLI's process tree;
on startup, a job left `running` is marked `interrupted`.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from ...core.workdir import Workdir
from ..library.repository import Conflict, atomic_write_json, read_json

logger = logging.getLogger("bookshelf.jobs")

JobState = Literal["running", "done", "failed", "cancelled", "interrupted"]
ItemState = Literal["pending", "running", "done", "failed", "skipped"]
ACTIVE: frozenset[str] = frozenset({"running"})


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


@dataclass(frozen=True, slots=True)
class ItemOutcome:
    state: ItemState
    detail: str = ""


@dataclass
class Work:
    """What a job does per item: whether the item is already done, and how to do it."""

    is_done: Callable[[int], bool]
    run: Callable[[int], Awaitable[ItemOutcome]]


class JobNotFound(Exception):
    pass


class JobRunner:
    def __init__(self, workdir: Workdir) -> None:
        self.workdir = workdir
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._paths: dict[str, Path] = {}

    # --- records

    def _path(self, job_id: str) -> Path:
        if job_id not in self._paths:
            for path in self.workdir.all_job_files():
                self._paths.setdefault(path.stem, path)
        if job_id not in self._paths:
            raise JobNotFound(job_id)
        return self._paths[job_id]

    def get(self, job_id: str) -> dict[str, Any]:
        record = read_json(self._path(job_id))
        if record is None:
            raise JobNotFound(job_id)
        return record

    def _save(self, record: dict[str, Any]) -> None:
        record["updatedAt"] = now()
        atomic_write_json(self._path(record["id"]), record)

    def list(self, book: str | None = None) -> list[dict[str, Any]]:
        records = [read_json(p) for p in self.workdir.all_job_files()]
        found = [r for r in records if r and (book is None or r.get("book") == book)]
        return sorted(found, key=lambda r: r.get("createdAt", ""), reverse=True)

    def is_running(self, job_id: str) -> bool:
        task = self._tasks.get(job_id)
        return task is not None and not task.done()

    def require_idle(self, book: str, volume: int) -> None:
        """One running job per volume, whatever its kind (they share raw/, drafts/, characters)."""

        if any(r.get("volume") == volume and self.is_running(r["id"]) for r in self.list(book)):
            raise Conflict("A job is already running on this volume; wait or cancel it.")

    def recover(self) -> int:
        """Mark jobs a previous process left running as interrupted. Returns how many."""

        count = 0
        for path in self.workdir.all_job_files():
            record = read_json(path)
            self._paths[path.stem] = path
            if record and record.get("state") in ACTIVE:
                record["state"] = "interrupted"
                for item in record.get("items", {}).values():
                    if item.get("state") == "running":
                        item["state"] = "pending"
                self._save(record)
                count += 1
        return count

    # --- lifecycle

    def create(
        self, *, kind: str, book: str, volume: int, items: Sequence[int], params: dict[str, Any]
    ) -> dict[str, Any]:
        job_id = f"{kind}-{datetime.now(UTC):%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}"
        path = self.workdir.jobs_dir(book, volume) / f"{job_id}.json"
        self._paths[job_id] = path
        record = {
            "id": job_id,
            "kind": kind,
            "book": book,
            "volume": volume,
            "params": params,
            "state": "running",
            "createdAt": now(),
            "items": {str(i): {"state": "pending", "detail": ""} for i in items},
        }
        self._save(record)
        return record

    def start(self, job_id: str, work: Work, parallel: int) -> dict[str, Any]:
        """Run (or resume) a job in the background. Items whose result exists are skipped."""

        if self.is_running(job_id):
            raise RuntimeError("The job is already running.")
        record = self.get(job_id)
        record["state"] = "running"
        record.pop("error", None)
        for item in record["items"].values():
            if item["state"] in ("failed", "running"):
                item["state"] = "pending"
        self._save(record)
        self._tasks[job_id] = asyncio.create_task(self._run(job_id, work, max(1, parallel)))
        return record

    async def cancel(self, job_id: str) -> dict[str, Any]:
        task = self._tasks.get(job_id)
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        record = self.get(job_id)
        if record["state"] == "running":
            record["state"] = "cancelled"
            self._save(record)
        return record

    async def shutdown(self) -> None:
        for job_id in list(self._tasks):
            if self.is_running(job_id):
                await self.cancel(job_id)

    async def _run(self, job_id: str, work: Work, parallel: int) -> None:
        record = self.get(job_id)
        semaphore = asyncio.Semaphore(parallel)  # M, nested inside the process-wide gate
        items = [int(key) for key in record["items"]]

        def mark(item: int, state: ItemState, detail: str = "") -> None:
            record["items"][str(item)] = {"state": state, "detail": detail}
            self._save(record)

        async def one(item: int) -> None:
            if work.is_done(item):
                previous = record["items"][str(item)]
                # keep what the earlier run reported (accepted / review / cover)
                if previous["state"] != "done":
                    mark(item, "done", "already done")
                return
            async with semaphore:
                mark(item, "running")
                try:
                    outcome = await work.run(item)
                except asyncio.CancelledError:
                    mark(item, "pending", "cancelled")
                    raise
                except Exception as exc:  # one bad page must not stop the others
                    logger.exception("job %s item %s failed", job_id, item)
                    outcome = ItemOutcome("failed", f"{type(exc).__name__}: {exc}")
                mark(item, outcome.state, outcome.detail)

        try:
            await asyncio.gather(*(one(item) for item in items))
        except asyncio.CancelledError:
            record["state"] = "cancelled"
            self._save(record)
            raise
        states = {entry["state"] for entry in record["items"].values()}
        record["state"] = "failed" if "failed" in states else "done"
        self._save(record)
