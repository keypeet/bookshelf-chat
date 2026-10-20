"""Convert a book chapter to chat drafts, review them, publish.

A convert job is one chapter split into calls of a few pages (4 by default; the
whole chapter in one call came back empty in the phase 0 spike). Each call's
answer, with the prompt sent, is kept at workdir/<book>/v<N>/convert/cNNN/batch-NN.json;
once every call of the job is good, the pages are cut into episode drafts
(one page image = one episode) in library/<book>/drafts/. Publishing moves a
draft to chapters/ + index.json and is refused while a flag, a speaker outside
the roster or a coverage failure remains.
"""

from __future__ import annotations

import asyncio
import threading
from pathlib import Path
from typing import Any

from ...core.workdir import Workdir
from ...infrastructure.llm import LlmGateway
from ..jobs.calls import ModelChoice, call_task, nullable, stamp
from ..jobs.runner import ItemOutcome, JobRunner, Work
from ..library.repository import (
    Conflict,
    LibraryError,
    LibraryRepository,
    NotFound,
    atomic_write_json,
    read_json,
)
from ..library.status import ChapterPages, chapter_pages, volume_meta
from ..prompts.context import context_pack, roster_block
from ..prompts.templates import pages_block, render, style_notes
from .coverage import coverage

BLOCK_TYPES = ("narration", "scene", "gap", "dialogue", "thought")
SPOKEN = frozenset({"dialogue", "thought"})
BLOCK_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": list(BLOCK_TYPES)},
        # required: grok drops `text` when it is optional (phase 3 spike); gap leaves it ""
        "text": {"type": "string"},
        "note": nullable("string"),
        "speaker": nullable("string"),
        "speakerNum": nullable("integer"),
        "action": nullable("string"),
        "needsReview": nullable("boolean"),
    },
    "required": ["type", "text", "note", "speaker", "speakerNum", "action", "needsReview"],
}
CONVERT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "pages": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "image": {"type": "string"},
                    "blocks": {"type": "array", "items": BLOCK_SCHEMA},
                },
                "required": ["image", "blocks"],
            },
        }
    },
    "required": ["pages"],
}
CALL_TIMEOUT_S = 900.0
PAGES_PER_CALL = 4
MAX_PAGES_PER_CALL = 14
MAX_PARALLEL = 4
TAIL_CHARS = 600
FIRST_PAGE_TAIL = "ไม่มี — เป็นหน้าแรกของบท"


def normalize_block(raw: Any, characters: dict[str, Any]) -> dict[str, Any] | None:
    """One block in the chapter schema, without the nulls the call schema forces."""

    if not isinstance(raw, dict) or raw.get("type") not in BLOCK_TYPES:
        return None
    kind = raw["type"]
    text = str(raw.get("text") or "").strip()
    note = str(raw.get("note") or "").strip()
    if kind == "gap":
        return {"type": "gap", "note": note or text or "เนื้อหาขาดตรงนี้"}
    if kind in ("narration", "scene"):
        return {"type": kind, "text": text} if text else None
    if not text:
        return None
    speaker = str(raw.get("speaker") or "").strip() or "unknown"
    block: dict[str, Any] = {"type": kind, "speaker": speaker, "text": text}
    character = characters.get(speaker)
    number = raw.get("speakerNum")
    if isinstance(number, int) and not isinstance(number, bool) and number > 0:
        if character and character.get("generic"):
            block["speakerNum"] = number
    if action := str(raw.get("action") or "").strip():
        block["action"] = action
    flagged = raw.get("needsReview") is True
    if speaker == "unknown" or character is None:
        flagged = True
        if character is None and speaker != "unknown" and not note:
            note = f"ผู้พูด {speaker!r} ไม่มีในทะเบียน"
    if flagged:
        block["needsReview"] = True
    if note:
        block["note"] = note
    return block


def parse_pages(
    payload: dict[str, Any], images: list[int], characters: dict[str, Any]
) -> tuple[list[dict[str, Any]] | None, str]:
    """The answer's pages in the order sent, or why it is unusable (e.g. `{"pages": []}`)."""

    pages = payload.get("pages")
    if not isinstance(pages, list) or len(pages) != len(images):
        got = len(pages) if isinstance(pages, list) else 0
        return None, f"ได้ {got} หน้า จากที่ส่ง {len(images)} หน้า"
    out = []
    for sent, page in zip(images, pages, strict=True):
        label = str((page or {}).get("image", "")).strip()
        if not label.isdigit() or int(label) != sent:
            return None, f"หน้าที่คืนไม่ตรงลำดับ (ส่ง {sent:03d} ได้ {label or '?'})"
        blocks = [b for raw in page.get("blocks") or [] if (b := normalize_block(raw, characters))]
        out.append({"image": sent, "blocks": blocks})
    return out, ""


def problems(draft: dict[str, Any], characters: dict[str, Any], cover: dict[str, Any]) -> list[str]:
    """What stops a draft from being published."""

    found = []
    blocks = draft.get("blocks", [])
    flags = sum(1 for b in blocks if b.get("needsReview"))
    if flags:
        found.append(f"ยังมีธง needsReview {flags} จุด")
    outside = sorted(
        {
            b["speaker"]
            for b in blocks
            if b.get("type") in SPOKEN
            and (b.get("speaker") == "unknown" or b.get("speaker") not in characters)
        }
    )
    if outside:
        found.append(f"ผู้พูดนอกทะเบียนหรือ unknown: {', '.join(outside)}")
    if not cover["ok"]:
        if cover["ratio"] is not None and not 0.97 <= cover["ratio"] <= 1.03:
            found.append(f"coverage ของบท {cover['ratio']} (ต้องอยู่ใน 0.97–1.03)")
        if cover["missing"]:
            found.append(f"ย่อหน้าหาย {len(cover['missing'])} ย่อหน้า")
        if cover["ratio"] is None:
            found.append("มีบล็อกแต่ไม่มี raw ของบท")
    if not blocks:
        found.append("ตอนนี้ไม่มีบล็อก")
    return found


class ConvertService:
    def __init__(
        self,
        repo: LibraryRepository,
        workdir: Workdir,
        gateway: LlmGateway,
        runner: JobRunner,
        prompts_dir: Path,
        story: Any,  # StoryService: scanned() and previous_summarized() gates
    ) -> None:
        self.repo = repo
        self.workdir = workdir
        self.gateway = gateway
        self.runner = runner
        self.prompts_dir = prompts_dir
        self.story = story
        self._assemble_lock = threading.Lock()

    # --- planning and gates

    def _numbering(self, book: str, volume: int, chapter: int) -> tuple[int | None, str]:
        """The first episode number this chapter's drafts get, or why it cannot be converted.

        Episodes are numbered through the volume, so chapters convert in order; only the
        latest converted chapter can be converted again.
        """

        entries = [e for e in self.repo.index(book)["chapters"] if e.get("volume") == volume]
        drafts = [d for d in self.repo.drafts(book) if d.get("volume") == volume]
        if any(e.get("bookChapter") == chapter for e in entries):
            return None, "บทนี้ publish แล้ว — แปลงซ้ำไม่ได้"
        everything = entries + drafts
        if any((x.get("bookChapter") or 0) > chapter for x in everything):
            return None, "มีบทหลังจากนี้แปลงไว้แล้ว — แปลงตามลำดับบท (แปลงซ้ำได้เฉพาะบทล่าสุด)"
        done = {x.get("bookChapter") for x in everything}
        meta = volume_meta(self.repo.book(book), volume)
        waiting = sorted(c["n"] for c in meta.get("chapters", []) if c["n"] < chapter)
        waiting = [n for n in waiting if n not in done]
        if waiting:
            return None, f"บทก่อนหน้ายังไม่ได้แปลง: {', '.join(map(str, waiting))}"
        own = [d["chapter"] for d in drafts if d.get("bookChapter") == chapter]
        if own:
            return min(own), ""
        return max((x["chapter"] for x in everything), default=0) + 1, ""

    def plan(
        self, book: str, volume: int, chapter: int, choice: ModelChoice, pages_per_call: int
    ) -> dict[str, Any]:
        self.repo.require_book(book)
        self.gateway.check(choice.provider, choice.model, choice.effort, "convert")
        if not 1 <= pages_per_call <= MAX_PAGES_PER_CALL:
            raise LibraryError(f"Pages per call run from 1 to {MAX_PAGES_PER_CALL}.")
        pages = chapter_pages(self.repo, self.workdir, book, volume, chapter)
        blockers, warnings = [], []
        if pages.end is None:
            blockers.append("บทสุดท้ายของเล่มที่ยังไม่ปิด — ตั้ง 'จบเล่มที่หน้า N' ก่อน")
        elif pages.missing:
            blockers.append(f"ยังไม่มี raw ของหน้า {', '.join(map(str, pages.missing))}")
        elif not pages.texts:
            blockers.append("บทนี้ไม่มีหน้าที่มีข้อความ")
        if not self.story.scanned(book, volume, chapter):
            blockers.append("ยังไม่ได้สแกนตัวละครของบทนี้ หรือยังมีข้อเสนอที่ยังไม่ได้รับ/ไม่รับ")
        first, why = self._numbering(book, volume, chapter)
        if why:
            blockers.append(why)
        if not self.story.previous_summarized(book, volume, chapter):
            warnings.append("บทก่อนหน้ายังไม่ได้สรุป — ผู้พูดอาจอนุมานพลาดเพราะไม่มีบริบท")
        images = list(pages.texts)
        batches = [images[i : i + pages_per_call] for i in range(0, len(images), pages_per_call)]
        return {
            "pages": images,
            "covers": pages.covers,
            "batches": batches,
            "calls": len(batches),
            "firstEpisode": first,
            "blockers": blockers,
            "warnings": warnings,
        }

    # --- jobs

    def create_job(
        self,
        book: str,
        volume: int,
        chapter: int,
        choice: ModelChoice,
        pages_per_call: int,
        parallel: int,
        accept_risk: bool,
    ) -> dict[str, Any]:
        plan = self.plan(book, volume, chapter, choice, pages_per_call)
        if plan["blockers"]:
            raise Conflict(" · ".join(plan["blockers"]))
        if plan["warnings"] and not accept_risk:
            raise Conflict(" · ".join(plan["warnings"]) + " — ยืนยันแบบยอมรับความเสี่ยงเพื่อแปลงต่อ")
        self.runner.require_idle(book, volume)
        folder = self.workdir.convert_dir(book, volume, chapter)
        for old in folder.glob("batch-*.json") if folder.is_dir() else []:
            old.unlink()
        record = self.runner.create(
            kind="convert",
            book=book,
            volume=volume,
            items=range(1, plan["calls"] + 1),
            params={
                "chapter": chapter,
                "batches": plan["batches"],
                "model": choice.as_dict(),
                "pagesPerCall": pages_per_call,
                "parallel": max(1, min(parallel, MAX_PARALLEL)),
                "calls": plan["calls"],
                "acceptRisk": accept_risk,
            },
        )
        return self.start(record["id"])

    def start(self, job_id: str) -> dict[str, Any]:
        record = self.runner.get(job_id)
        book, volume, params = record["book"], record["volume"], record["params"]
        self.runner.require_idle(book, volume)
        chapter, batches = params["chapter"], params["batches"]
        choice = ModelChoice(**params["model"])
        # resume re-checks the gates: the chapter may have been re-converted or published since
        plan = self.plan(book, volume, chapter, choice, params["pagesPerCall"])
        if plan["blockers"]:
            raise Conflict(" · ".join(plan["blockers"]))
        # every call already landed (stopped before the drafts were written): write them now
        self._assemble(book, volume, chapter, batches, job_id, choice)
        return self.runner.start(
            job_id,
            Work(
                is_done=lambda i: self._batch_ok(book, volume, chapter, i, batches[i - 1], job_id),
                run=lambda i: self.run_batch(book, volume, chapter, i, batches, choice, job_id),
            ),
            params["parallel"],
        )

    def _batch_path(self, book: str, volume: int, chapter: int, i: int) -> Path:
        return self.workdir.convert_dir(book, volume, chapter) / f"batch-{i:02d}.json"

    def _batch_ok(
        self, book: str, volume: int, chapter: int, i: int, images: list[int], job_id: str
    ) -> bool:
        found = read_json(self._batch_path(book, volume, chapter, i))
        return bool(
            found
            and found.get("status") == "ok"
            and found.get("images") == images
            and found.get("job") == job_id
        )

    async def run_batch(
        self,
        book: str,
        volume: int,
        chapter: int,
        i: int,
        batches: list[list[int]],
        choice: ModelChoice,
        job_id: str,
    ) -> ItemOutcome:
        images = batches[i - 1]
        pages = chapter_pages(self.repo, self.workdir, book, volume, chapter)
        if any(n not in pages.texts for n in images):
            return ItemOutcome("failed", "raw ของบทเปลี่ยนไปหลังสั่งงาน — สั่งแปลงใหม่")
        order = list(pages.texts)
        before = order.index(images[0]) - 1
        tail = pages.texts[order[before]][-TAIL_CHARS:] if before >= 0 else FIRST_PAGE_TAIL
        card, characters = self.repo.book(book), self.repo.characters(book)
        context, ids = context_pack(self.repo, book, volume, chapter)
        prompt = render(
            self.prompts_dir,
            "convert",
            {
                "bookTitle": card.get("title", ""),
                "styleNotes": style_notes(card),
                "context": context,
                "roster": roster_block(characters),
                "previousTail": tail,
                "pages": pages_block({n: pages.texts[n] for n in images}),
            },
        )
        payload, record = await call_task(
            self.gateway, choice, prompt, CONVERT_SCHEMA, "convert", CALL_TIMEOUT_S, ids
        )
        record.update({"job": job_id, "batch": i, "images": images})
        if payload is not None:
            parsed, why = parse_pages(payload, images, characters)
            if parsed is None:
                record.update({"status": "failed", "errorKind": "bad_pages", "detail": why})
            else:
                record["pages"] = parsed

        def save() -> None:
            atomic_write_json(self._batch_path(book, volume, chapter, i), record)
            if record["status"] == "ok":
                self._assemble(book, volume, chapter, batches, job_id, choice)

        await asyncio.to_thread(save)
        if record["status"] != "ok":
            return ItemOutcome("failed", f"{record['errorKind']}: {record['detail'][:200]}")
        blocks = [b for p in record["pages"] for b in p["blocks"]]
        flags = sum(1 for b in blocks if b.get("needsReview"))
        return ItemOutcome("done", f"{len(blocks)} บล็อก · ธง {flags}")

    def _assemble(
        self,
        book: str,
        volume: int,
        chapter: int,
        batches: list[list[int]],
        job_id: str,
        choice: ModelChoice,
    ) -> None:
        """When every call of the job is good, cut the pages into episode drafts, once per job."""

        with self._assemble_lock:
            if not all(
                self._batch_ok(book, volume, chapter, i, images, job_id)
                for i, images in enumerate(batches, start=1)
            ):
                return
            if any((d.get("draft") or {}).get("job") == job_id for d in self.repo.drafts(book)):
                return  # already written (two calls finishing together, or a resume)
            by_image = {
                page["image"]: page["blocks"]
                for i in range(1, len(batches) + 1)
                for page in read_json(self._batch_path(book, volume, chapter, i))["pages"]
            }
            first, why = self._numbering(book, volume, chapter)
            if first is None:
                raise Conflict(why)
            pages = chapter_pages(self.repo, self.workdir, book, volume, chapter)
            self._write_drafts(book, volume, chapter, first, pages, by_image, job_id, choice)

    def _write_drafts(
        self,
        book: str,
        volume: int,
        chapter: int,
        first: int,
        pages: ChapterPages,
        by_image: dict[int, list[dict[str, Any]]],
        job_id: str,
        choice: ModelChoice,
    ) -> None:
        episodes: list[tuple[list[int], list[dict[str, Any]]]] = []
        leading: list[int] = []  # pages with no block before the first page that has one
        for image in pages.texts:
            blocks = by_image.get(image, [])
            if blocks:
                episodes.append(([*leading, image], list(blocks)))
                leading = []
            elif episodes:  # a page whose text all went into the block before it joins that episode
                episodes[-1][0].append(image)
            else:
                leading.append(image)
        if leading:  # no page produced a block: one empty draft, so the person sees it
            episodes.append((leading, []))
        title = self._volume_title(book, volume)
        with self.repo.lock(book):
            for old in self.repo.drafts(book):
                if old.get("volume") == volume and old.get("bookChapter") == chapter:
                    self.repo.delete_draft(book, old["id"])
            for k, (images, blocks) in enumerate(episodes):
                n = first + k
                printed = [pages.book_pages.get(i, "?") for i in images]
                self.repo.write_draft(
                    book,
                    {
                        "id": f"v{volume}-c{n}",
                        "volume": volume,
                        "volumeTitle": title,
                        "chapter": n,
                        "bookChapter": chapter,
                        "title": f"บทที่ {chapter} · ช่วงที่ {k + 1}",
                        "sourcePages": [int(p) for p in printed if p.isdigit()],
                        "blocks": blocks,
                        # Studio only; dropped when the draft is published
                        "draft": {
                            "images": images,
                            "job": job_id,
                            **choice.as_dict(),
                            "convertedAt": stamp(),
                        },
                    },
                )

    def _volume_title(self, book: str, volume: int) -> str:
        meta = volume_meta(self.repo.book(book), volume)
        if meta.get("title"):
            return meta["title"]
        entries = [e for e in self.repo.index(book)["chapters"] if e.get("volume") == volume]
        return next((e["volumeTitle"] for e in entries if e.get("volumeTitle")), f"เล่ม {volume}")

    # --- review and publish

    def chapter_coverage(self, book: str, volume: int, chapter: int) -> dict[str, Any]:
        """Coverage over the whole book chapter (drafts and published episodes), since a
        block that runs across pages belongs to the page it starts on."""

        pages = chapter_pages(self.repo, self.workdir, book, volume, chapter)
        episodes = [
            d
            for d in self.repo.drafts(book)
            if d.get("volume") == volume and d.get("bookChapter") == chapter
        ]
        for entry in self.repo.index(book)["chapters"]:
            if entry.get("volume") == volume and entry.get("bookChapter") == chapter:
                if published := self.repo.chapter(book, entry["id"]):
                    episodes.append(published)
        blocks = [b for e in sorted(episodes, key=lambda e: e["chapter"]) for b in e["blocks"]]
        return coverage(blocks, list(pages.texts.values()))

    def drafts(self, book: str, volume: int) -> list[dict[str, Any]]:
        characters = self.repo.characters(book)
        rows = []
        for d in self.repo.drafts(book):
            if d.get("volume") != volume:
                continue
            blocks = d.get("blocks", [])
            rows.append(
                {
                    "id": d["id"],
                    "chapter": d["chapter"],
                    "bookChapter": d.get("bookChapter"),
                    "title": d.get("title", ""),
                    "images": (d.get("draft") or {}).get("images", []),
                    "blocks": len(blocks),
                    "flags": sum(1 for b in blocks if b.get("needsReview")),
                    "outside": sum(
                        1
                        for b in blocks
                        if b.get("type") in SPOKEN
                        and (b.get("speaker") == "unknown" or b.get("speaker") not in characters)
                    ),
                }
            )
        return sorted(rows, key=lambda r: r["chapter"])

    def detail(self, book: str, draft_id: str) -> dict[str, Any]:
        draft = self.repo.draft(book, draft_id)
        if draft is None:
            raise NotFound(f"No draft {draft_id!r}.")
        volume = draft["volume"]
        characters = self.repo.characters(book)
        images = (draft.get("draft") or {}).get("images", [])
        raw = [
            {"image": n, "text": parsed[1] if (parsed := self.repo.raw(book, volume, n)) else ""}
            for n in images
        ]
        cover = self.chapter_coverage(book, volume, draft["bookChapter"])
        siblings = [r["id"] for r in self.drafts(book, volume)]
        return {
            "draft": draft,
            "raw": raw,
            "coverage": cover,
            "problems": problems(draft, characters, cover),
            "speakers": [
                {"key": k, "name": c.get("name", k), "generic": bool(c.get("generic"))}
                for k, c in characters.items()
            ],
            "siblings": siblings,
        }

    def save(
        self, book: str, draft_id: str, blocks: list[dict[str, Any]], title: str | None
    ) -> dict[str, Any]:
        with self.repo.lock(book):
            draft = self.repo.draft(book, draft_id)
            if draft is None:
                raise NotFound(f"No draft {draft_id!r}.")
            self.runner.require_idle(book, draft["volume"])
            characters = self.repo.characters(book)
            kept = []
            for raw in blocks:
                block = normalize_block(raw, characters)
                if block is None:
                    continue
                speaker_ok = (
                    block.get("speaker", "") in characters and block.get("speaker") != "unknown"
                )
                if raw.get("needsReview") is not True and (
                    block["type"] not in SPOKEN or speaker_ok
                ):
                    block.pop("needsReview", None)  # a person cleared the flag
                kept.append(block)
            draft["blocks"] = kept
            if title:
                draft["title"] = title
            self.repo.write_draft(book, draft)
        return self.detail(book, draft_id)

    def publish(self, book: str, draft_id: str) -> dict[str, Any]:
        with self.repo.lock(book):
            found = self.detail(book, draft_id)
            draft = found["draft"]
            self.runner.require_idle(book, draft["volume"])
            if found["problems"]:
                raise Conflict("ยัง publish ไม่ได้: " + " · ".join(found["problems"]))
            if self.repo.chapter(book, draft_id) is not None:
                raise Conflict(f"มีตอน {draft_id} publish อยู่แล้ว")
            earlier = [
                d["id"]
                for d in self.repo.drafts(book)
                if d.get("volume") == draft["volume"] and d["chapter"] < draft["chapter"]
            ]
            if earlier:
                raise Conflict(f"publish ตามลำดับตอน — ยังมี {', '.join(earlier)} ก่อนหน้านี้")
            chapter = {k: v for k, v in draft.items() if k != "draft"}
            self.repo.publish_chapter(book, chapter)
            self.repo.delete_draft(book, draft_id)
        return {"id": draft_id, "published": True}
