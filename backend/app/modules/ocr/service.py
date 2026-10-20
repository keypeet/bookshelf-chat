"""OCR jobs: one call per page per model, candidates on disk, automatic accept for one model.

A candidate lives at workdir/<book>/v<N>/ocr/NNN/<provider>__<model>.json and is
the truth for "this page is done". With a single model, a good candidate is
written to raw/vN/img-NNN.txt; a page that looks wrong, or already has a raw
file (volume 1 was checked by hand), goes to the review queue instead. With
several models every page goes to the queue, where a person picks one result
(and may edit it) on the compare page.
"""

from __future__ import annotations

import asyncio
import re
import statistics
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ...core.workdir import Workdir
from ...infrastructure.llm import LlmGateway, StructuredCall
from ..jobs.calls import ModelChoice
from ..jobs.runner import ItemOutcome, JobRunner, Work
from ..library.repository import (
    Conflict,
    LibraryError,
    LibraryRepository,
    atomic_write_json,
    read_json,
)
from ..prompts.templates import Prompt, ocr_prompt
from ..sources.service import SourceService

OCR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "text": {"type": "string"},
        "bookPage": {"type": ["integer", "null"]},
        "uncertain": {"type": "array", "items": {"type": "string"}},
        "isCover": {"type": "boolean"},
    },
    "required": ["text", "bookPage", "uncertain", "isCover"],
}
CALL_TIMEOUT_S = 300.0
MAX_PARALLEL = 8
MAX_UNCERTAIN_MARKS = 5
NEIGHBOR_WINDOW = 3
SHORT_RATIO = 0.4
LONG_RATIO = 1.8
MAX_MODELS = 4
COVER_REASON = "AI บอกว่าเป็นปก/ภาพประกอบ ไม่มีเนื้อเรื่อง — เปิดภาพดูก่อนยืนยัน"
COMPARE_REASON = "OCR หลายโมเดล — เลือกผลที่หน้าเทียบ"
RAW_EXISTS_REASON = "มี raw ของหน้านี้อยู่แล้ว — ไม่เขียนทับ"
OTHERS_OPEN_REASON = "มีผลจากโมเดลอื่นรอเลือกอยู่ — เทียบที่หน้าเทียบ"
SETTLED_REASON = "หน้านี้เลือกผลไปแล้ว"
SETTLED = frozenset({"accepted", "cover", "kept"})  # a candidate in one of these settles its page
_WHITESPACE = re.compile(r"\s+")
_MARKER = re.compile(r"<!--.*?-->")


def text_length(text: str) -> int:
    return len(_WHITESPACE.sub("", _MARKER.sub("", text)))


def review_reasons(payload: dict[str, Any], neighbors: list[int]) -> list[str]:
    """Why a single-model result should not be accepted without a person looking."""

    if payload.get("isCover"):
        return []
    reasons = []
    length = text_length(str(payload.get("text", "")))
    if length == 0:
        reasons.append("หน้าว่าง แต่ไม่ได้บอกว่าเป็นปก/ภาพประกอบ")
    marks = str(payload.get("text", "")).count("[?")
    if marks > MAX_UNCERTAIN_MARKS:
        reasons.append(f"มี [?] {marks} จุด")
    if length and neighbors:
        median = statistics.median(neighbors)
        if median and length < SHORT_RATIO * median:
            reasons.append(f"สั้นผิดปกติ ({length} ตัวอักษร เทียบหน้าใกล้เคียง ~{int(median)})")
        elif median and length > LONG_RATIO * median:
            reasons.append(f"ยาวผิดปกติ ({length} ตัวอักษร เทียบหน้าใกล้เคียง ~{int(median)})")
    return reasons


class OcrService:
    def __init__(
        self,
        repo: LibraryRepository,
        workdir: Workdir,
        sources: SourceService,
        gateway: LlmGateway,
        runner: JobRunner,
        prompts_dir: Any,
    ) -> None:
        self.repo = repo
        self.workdir = workdir
        self.sources = sources
        self.gateway = gateway
        self.runner = runner
        self.prompts_dir = prompts_dir
        # Deciding a page (job result landing, accept, keep-raw) reads the page's other
        # candidates and then writes; one lock keeps two decisions from crossing.
        self._decide = threading.Lock()

    # --- candidates (the truth)

    def candidate(
        self, book: str, volume: int, image: int, choice: ModelChoice
    ) -> dict[str, Any] | None:
        return read_json(
            self.workdir.ocr_candidate(book, volume, image, choice.provider, choice.model)
        )

    def candidates(self, book: str, volume: int, image: int) -> list[dict[str, Any]]:
        folder = self.workdir.ocr_dir(book, volume, image)
        if not folder.is_dir():
            return []
        return [c for p in sorted(folder.glob("*__*.json")) if (c := read_json(p))]

    def is_done(self, book: str, volume: int, image: int, choice: ModelChoice) -> bool:
        found = self.candidate(book, volume, image, choice)
        return bool(found and found.get("status") == "ok")

    def settled(self, book: str, volume: int, image: int) -> bool:
        """A person (or the single-model auto accept) already chose this page's result."""

        return any(
            (c.get("accept") or {}).get("state") in SETTLED
            for c in self.candidates(book, volume, image)
        )

    def missing(
        self, book: str, volume: int, image: int, choices: list[ModelChoice]
    ) -> list[ModelChoice]:
        """Models still to call for this page: none once the page is settled."""

        if self.settled(book, volume, image):
            return []
        return [c for c in choices if not self.is_done(book, volume, image, c)]

    # --- planning

    def plan(
        self, book: str, volume: int, start: int, count: int, choices: list[ModelChoice]
    ) -> dict[str, Any]:
        """Which pages a job would call, so the UI can show the call count before confirming.

        A call is one page for one model, so N pages with M models is up to N x M calls.
        """

        self.repo.require_book(book)
        if not 1 <= len(choices) <= MAX_MODELS:
            raise LibraryError(f"Pick between 1 and {MAX_MODELS} models.")
        if len({(c.provider, c.model) for c in choices}) != len(choices):
            raise LibraryError("Each model can be picked only once.")
        for choice in choices:
            self.gateway.check(choice.provider, choice.model, choice.effort, "ocr")
        if count < 1 or start < 1:
            raise LibraryError("Start at page 1 or later and ask for at least one page.")
        total = self.sources.page_count(book, volume)
        images = self.workdir.page_images(book, volume)
        last = max([total or 0, *images.keys()], default=0)
        if last == 0:
            raise LibraryError("This volume has no source PDF or page images yet.")
        pages = [n for n in range(start, min(start + count, last + 1))]
        missing = {n: len(self.missing(book, volume, n, choices)) for n in pages}
        return {
            "pages": pages,
            "alreadyDone": [n for n in pages if missing[n] == 0],
            "calls": sum(missing.values()),
            "lastPage": last,
        }

    # --- jobs

    def create_job(
        self,
        book: str,
        volume: int,
        start: int,
        count: int,
        parallel: int,
        choices: list[ModelChoice],
    ) -> dict[str, Any]:
        plan = self.plan(book, volume, start, count, choices)
        self.runner.require_idle(book, volume)
        record = self.runner.create(
            kind="ocr",
            book=book,
            volume=volume,
            items=plan["pages"],
            params={
                "from": start,
                "count": count,
                "parallel": max(1, min(parallel, MAX_PARALLEL)),
                "models": [c.as_dict() for c in choices],
                "calls": plan["calls"],
            },
        )
        return self.start(record["id"])

    def start(self, job_id: str) -> dict[str, Any]:
        record = self.runner.get(job_id)
        choices = [ModelChoice(**m) for m in record["params"]["models"]]
        book, volume = record["book"], record["volume"]
        self.runner.require_idle(book, volume)  # resume too: one running job per volume
        return self.runner.start(
            job_id,
            Work(
                is_done=lambda n: not self.missing(book, volume, n, choices),
                run=lambda n: self.run_page(book, volume, n, choices),
            ),
            record["params"]["parallel"],
        )

    async def run_page(
        self, book: str, volume: int, image: int, choices: list[ModelChoice]
    ) -> ItemOutcome:
        """Call each model that has no good result for this page yet, at the same time."""

        page = await asyncio.to_thread(self.sources.ensure_page, book, volume, image)
        if page is None:
            return ItemOutcome("failed", "ไม่มีภาพหน้านี้")
        prompt = ocr_prompt(self.prompts_dir, self.repo.book(book), self.repo.characters(book))
        auto = len(choices) == 1
        todo = self.missing(book, volume, image, choices)
        if not todo:
            return ItemOutcome("done", "already done")
        records = await asyncio.gather(
            *(self._call_model(book, volume, image, c, page, prompt, auto) for c in todo)
        )
        failed = [r for r in records if r["status"] != "ok"]
        if failed:
            detail = ", ".join(f"{r['provider']}: {r['errorKind'] or 'failed'}" for r in failed)
            return ItemOutcome("failed", detail)
        states = {r["accept"]["state"] for r in records}
        if "review" in states or len(states) != 1:
            return ItemOutcome("done", "review")
        return ItemOutcome("done", states.pop())

    async def _call_model(
        self,
        book: str,
        volume: int,
        image: int,
        choice: ModelChoice,
        page: Path,
        prompt: Prompt,
        auto: bool,
    ) -> dict[str, Any]:
        result = await self.gateway.call(
            choice.provider,
            StructuredCall(
                prompt=prompt.text,
                schema=OCR_SCHEMA,
                model=choice.model,
                effort=choice.effort,  # type: ignore[arg-type]
                timeout_s=CALL_TIMEOUT_S,
                task="ocr",
                images=(page,),
            ),
        )
        payload = result.payload
        ok = (
            not result.failed and isinstance(payload, dict) and isinstance(payload.get("text"), str)
        )
        record: dict[str, Any] = {
            "image": image,
            "provider": choice.provider,
            "model": choice.model,
            "effort": choice.effort,
            "status": "ok" if ok else "failed",
            "errorKind": result.error_kind or (None if ok else "bad_payload"),
            "detail": result.error_detail[:2000],
            "durationMs": result.duration_ms,
            "costUsd": result.cost_usd,
            "templateHash": prompt.template_hash,
            "prompt": prompt.text,
            "createdAt": datetime.now(UTC).isoformat(timespec="seconds"),
        }
        if ok:
            record["result"] = {
                "text": payload["text"],
                "bookPage": payload.get("bookPage")
                if isinstance(payload.get("bookPage"), int)
                else None,
                "uncertain": [str(u) for u in payload.get("uncertain") or []],
                "isCover": bool(payload.get("isCover")),
            }
        path = self.workdir.ocr_candidate(book, volume, image, choice.provider, choice.model)

        def save() -> None:  # file writes (fsync, lock, retries) run off the event loop
            with self._decide:
                if ok:
                    record["accept"] = self._decide_new(
                        book, volume, image, record["result"], page.name, choice, auto
                    )
                atomic_write_json(path, record)

        await asyncio.to_thread(save)
        return record

    def _decide_new(
        self,
        book: str,
        volume: int,
        image: int,
        result: dict[str, Any],
        page_name: str,
        choice: ModelChoice,
        auto: bool,
    ) -> dict[str, Any]:
        """Where a fresh good result goes. Runs under the decide lock."""

        others = [
            c
            for c in self.candidates(book, volume, image)
            if (c.get("provider"), c.get("model")) != (choice.provider, choice.model)
        ]
        states = {(c.get("accept") or {}).get("state") for c in others}
        if states & SETTLED:
            # a person chose while this model was still running: keep it out of the queue
            return {"state": "rejected", "reasons": [SETTLED_REASON]}
        if auto and "review" not in states:
            return self._auto_accept(book, volume, image, result, page_name)
        neighbors = self._neighbor_lengths(book, volume, image)
        reasons = [COMPARE_REASON if not auto else OTHERS_OPEN_REASON]
        reasons += review_reasons(result, neighbors)
        if result["isCover"]:
            reasons.append(COVER_REASON)
        if self.repo.raw_path(book, volume, image).exists():
            reasons.append(RAW_EXISTS_REASON)
        return {"state": "review", "reasons": reasons}

    def _auto_accept(
        self, book: str, volume: int, image: int, result: dict[str, Any], page_name: str
    ) -> dict[str, Any]:
        if self.repo.raw_path(book, volume, image).exists():
            return {"state": "review", "reasons": [RAW_EXISTS_REASON]}
        if result["isCover"]:
            # Only the first image is taken as a cover unseen; anywhere else a page the model
            # calls "no story text" is shown to a person, so a misread text page is not lost.
            if image == 1:
                return {"state": "cover", "reasons": []}
            return {"state": "review", "reasons": [COVER_REASON]}
        reasons = review_reasons(result, self._neighbor_lengths(book, volume, image))
        if reasons:
            return {"state": "review", "reasons": reasons}
        try:
            self.repo.write_raw(
                book,
                volume,
                image,
                result["bookPage"],
                f"workdir/{book}/v{volume}/pages/{page_name}",
                result["text"],
            )
        except Conflict as exc:
            return {"state": "review", "reasons": [str(exc)]}
        return {"state": "accepted", "reasons": []}

    def _neighbor_lengths(self, book: str, volume: int, image: int) -> list[int]:
        lengths = []
        for n in range(image - NEIGHBOR_WINDOW, image + NEIGHBOR_WINDOW + 1):
            if n == image or n < 1:
                continue
            raw = self.repo.raw(book, volume, n)
            if raw is not None and (length := text_length(raw[1])):
                lengths.append(length)
        return lengths

    # --- review queue and manual accept

    def queue(self, book: str, volume: int) -> list[dict[str, Any]]:
        entries = []
        folder = self.workdir.volume(book, volume) / "ocr"
        if not folder.is_dir():
            return entries
        for page_dir in sorted(p for p in folder.iterdir() if p.is_dir() and p.name.isdigit()):
            image = int(page_dir.name)
            for candidate in self.candidates(book, volume, image):
                accept = candidate.get("accept") or {}
                if candidate.get("status") == "ok" and accept.get("state") == "review":
                    entries.append(
                        {
                            "image": image,
                            "provider": candidate["provider"],
                            "model": candidate["model"],
                            "reasons": accept.get("reasons", []),
                            "rawExists": self.repo.raw_path(book, volume, image).exists(),
                            "cover": bool((candidate.get("result") or {}).get("isCover")),
                        }
                    )
        return entries

    def accept(
        self, book: str, volume: int, image: int, provider: str, model: str, text: str | None
    ) -> dict[str, Any]:
        """Write a chosen candidate (optionally edited) as the page's raw text. Never overwrites."""

        with self._decide:
            return self._accept(book, volume, image, provider, model, text)

    def _accept(
        self, book: str, volume: int, image: int, provider: str, model: str, text: str | None
    ) -> dict[str, Any]:
        if self.settled(book, volume, image):
            raise Conflict("This page already has a chosen result.")
        path = self.workdir.ocr_candidate(book, volume, image, provider, model)
        candidate = read_json(path)
        if not candidate or candidate.get("status") != "ok":
            raise LibraryError("No usable candidate from that model for this page.")
        result = candidate["result"]
        if result.get("isCover") and text is None:
            # Confirming a cover/illustration page: nothing goes to raw/.
            candidate["accept"] = {"state": "cover", "reasons": ["ยืนยันโดยผู้ใช้"]}
            atomic_write_json(path, candidate)
            self._close_others(book, volume, image, path, f"ยืนยันเป็นปกจากผลของ {provider}")
            return candidate["accept"]
        if text is not None and not text.strip():
            raise LibraryError("The edited text is empty; confirm the page as a cover instead.")
        page = self.workdir.page_image(book, volume, image)
        source = f"workdir/{book}/v{volume}/pages/{page.name}" if page else "?"
        body = result["text"] if text is None else text
        self.repo.write_raw(book, volume, image, result.get("bookPage"), source, body)
        edited = text is not None and text != result["text"]
        candidate["accept"] = {
            "state": "accepted",
            "reasons": ["เลือกโดยผู้ใช้ (แก้ข้อความ)" if edited else "เลือกโดยผู้ใช้"],
        }
        atomic_write_json(path, candidate)
        self._close_others(book, volume, image, path, f"เลือกผลจาก {provider} แทน")
        return candidate["accept"]

    def keep_raw(
        self, book: str, volume: int, image: int, provider: str, model: str
    ) -> dict[str, Any]:
        """Keep the existing raw page and take every model's result off the review queue."""

        with self._decide:
            if self.settled(book, volume, image):
                raise Conflict("This page already has a chosen result.")
            return self._keep_raw(book, volume, image, provider, model)

    def _keep_raw(
        self, book: str, volume: int, image: int, provider: str, model: str
    ) -> dict[str, Any]:
        path = self.workdir.ocr_candidate(book, volume, image, provider, model)
        candidate = read_json(path)
        if not candidate or candidate.get("status") != "ok":
            raise LibraryError("No usable candidate from that model for this page.")
        if not self.repo.raw_path(book, volume, image).exists():
            raise LibraryError("This page has no raw text to keep; accept a result instead.")
        candidate["accept"] = {"state": "kept", "reasons": ["คง raw เดิมไว้"]}
        atomic_write_json(path, candidate)
        self._close_others(book, volume, image, path, "คง raw เดิมไว้")
        return candidate["accept"]

    def _close_others(self, book: str, volume: int, image: int, chosen: Path, reason: str) -> None:
        """Once a page is settled, the other models' results for it leave the queue."""

        for path in sorted(self.workdir.ocr_dir(book, volume, image).glob("*__*.json")):
            if path == chosen:
                continue
            other = read_json(path)
            if other and (other.get("accept") or {}).get("state") == "review":
                other["accept"] = {"state": "rejected", "reasons": [reason]}
                atomic_write_json(path, other)
