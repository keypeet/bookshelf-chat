"""Character scan, proposals, and chapter/volume summaries.

Both kinds of AI result wait in workdir/ for a person: a scan proposes new
characters, aliases, generics and appearance notes; a summary proposes the
summary text plus character status changes. Each proposal is accepted or
rejected one by one; accepting writes characters.json (atomic, under the book
lock). An approved summary goes to library/<book>/summaries/vN.json.

Character budgets are enforced here: chapter <= 1,500, volume <= 4,000, the
volume's short form (used for volumes further back) <= 800. A summary over budget
is sent back once to be shortened, never cut.
"""

from __future__ import annotations

import asyncio
import re
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
from ..library.status import chapter_pages, volume_meta
from ..prompts.context import (
    CHAPTER_BUDGET,
    FAR_VOLUME_BUDGET,
    VOLUME_BUDGET,
    context_pack,
    roster_block,
)
from ..prompts.templates import Prompt, pages_block, render, style_notes

CALL_TIMEOUT_S = 900.0
KEY = re.compile(r"^[a-z0-9_]{1,40}$")
COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
STATUSES = ("dead", "left", "changed-side", "returned")
PROPOSAL_ID = re.compile(r"^(scan|sum)-v(\d{1,3})-(c\d{1,3}|vol)-(\d{1,4})$")
SUMMARY_ATTEMPTS = 2

_S = {"type": "string"}


def _obj(props: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": list(props)}


def _arr(items: dict[str, Any]) -> dict[str, Any]:
    return {"type": "array", "items": items}


SCAN_SCHEMA = _obj(
    {
        "newCharacters": _arr(
            _obj(
                {
                    "key": _S,
                    "name": _S,
                    "short": _S,
                    "initials": nullable("string"),
                    "color": nullable("string"),
                    "side": nullable("string"),
                    "role": nullable("string"),
                    "aliases": _arr(_S),
                    "appearance": nullable("string"),
                    "speakingStyle": nullable("string"),
                    "evidence": _S,
                }
            )
        ),
        "newAliases": _arr(_obj({"key": _S, "alias": _S, "evidence": _S})),
        "newGenerics": _arr(
            _obj({"key": _S, "name": _S, "short": _S, "color": nullable("string"), "evidence": _S})
        ),
        "speakingStyles": _arr(_obj({"key": _S, "speakingStyle": _S, "evidence": _S})),
        "promotedGenerics": _arr(_obj({"fromGeneric": _S, "toKey": _S, "evidence": _S})),
        "appearanceUpdates": _arr(_obj({"key": _S, "appearance": _S, "source": _S})),
        "questions": _arr(_S),
    }
)
SUMMARY_SCHEMA = _obj(
    {
        "summary": _S,
        "short": nullable("string"),
        "party": _arr(_S),
        "location": _S,
        "openThreads": _arr(_S),
        "statusProposals": _arr(
            _obj({"key": _S, "status": {"type": "string", "enum": list(STATUSES)}, "evidence": _S})
        ),
        "questions": _arr(_S),
    }
)


def over_budget(result: dict[str, Any], level: str) -> str:
    """Why a summary is too long, or ""."""

    summary = str(result.get("summary") or "")
    limit = CHAPTER_BUDGET if level == "chapter" else VOLUME_BUDGET
    if not summary.strip():
        return "สรุปว่าง"
    if len(summary) > limit:
        return f"สรุปยาว {len(summary)} ตัวอักษร เกินงบ {limit:,}"
    short = str(result.get("short") or "")
    if level == "volume" and not short.strip():
        return "สรุปเล่มแบบสั้นว่าง (ใช้เป็นบริบทเมื่อเล่มนี้อยู่ไกล)"
    if level == "volume" and len(short) > FAR_VOLUME_BUDGET:
        return f"สรุปเล่มแบบสั้นยาว {len(short)} ตัวอักษร เกินงบ {FAR_VOLUME_BUDGET}"
    return ""


def scan_proposals(volume: int, chapter: int, result: dict[str, Any]) -> list[dict[str, Any]]:
    """The scan answer's decisions, one entry each (the rest is notes for a person)."""

    found: list[tuple[str, str, dict[str, Any], str]] = []
    for c in result.get("newCharacters") or []:
        value = {k: c.get(k) for k in ("name", "short", "initials", "color", "side", "role")}
        value |= {"aliases": c.get("aliases") or [], "appearance": c.get("appearance")}
        found.append(("character", c.get("key", ""), value, c.get("evidence", "")))
    for a in result.get("newAliases") or []:
        found.append(("alias", a.get("key", ""), {"alias": a.get("alias")}, a.get("evidence", "")))
    for g in result.get("newGenerics") or []:
        value = {k: g.get(k) for k in ("name", "short", "color")}
        found.append(("generic", g.get("key", ""), value, g.get("evidence", "")))
    for u in result.get("appearanceUpdates") or []:
        found.append(
            (
                "appearance",
                u.get("key", ""),
                {"appearance": u.get("appearance")},
                u.get("source", ""),
            )
        )
    return [
        {
            "id": f"scan-v{volume}-c{chapter}-{i}",
            "kind": kind,
            "key": str(key).strip(),
            "value": value,
            "evidence": str(evidence or ""),
            "state": "pending",
        }
        for i, (kind, key, value, evidence) in enumerate(found, start=1)
    ]


def apply_proposal(characters: dict[str, Any], proposal: dict[str, Any], first_seen: str) -> None:
    """Write one accepted proposal into characters (in place). Raises LibraryError if it cannot."""

    kind, key, value = proposal["kind"], proposal["key"], proposal["value"]

    def text(field: str) -> str:
        return str(value.get(field) or "").strip()

    if kind in ("character", "generic"):
        if key == "unknown":
            raise LibraryError("unknown สงวนไว้สำหรับผู้พูดที่ไม่รู้ตัว")
        if not KEY.fullmatch(key):
            raise LibraryError(f"key {key!r} ใช้ได้แค่ a-z 0-9 _")
        if key in characters:
            raise LibraryError(f"มี key {key!r} ในทะเบียนแล้ว")
        if not text("name"):
            raise LibraryError("ข้อเสนอไม่มีชื่อ")
        generic = kind == "generic"
        color = text("color")
        entry: dict[str, Any] = {
            "name": text("name"),
            "short": text("short") or text("name"),
            "color": color if COLOR.fullmatch(color) else ("#8a7f72" if generic else "#57534e"),
            "side": "right" if not generic and text("side") == "right" else "left",
        }
        if generic:
            entry["generic"] = True
        else:
            for field in ("initials", "role", "appearance"):
                if text(field):
                    entry[field] = text(field)
            if aliases := [str(a).strip() for a in value.get("aliases") or [] if str(a).strip()]:
                entry["aliases"] = aliases
        entry["firstSeen"] = first_seen
        characters[key] = entry
        return
    if key not in characters:
        raise LibraryError(f"ไม่มี key {key!r} ในทะเบียน — รับข้อเสนอตัวละครใหม่ก่อน")
    character = characters[key]
    if kind == "alias":
        alias = text("alias")
        if not alias:
            raise LibraryError("ข้อเสนอไม่มีคำเรียก")
        if alias not in character.get("aliases", []):
            character["aliases"] = [*character.get("aliases", []), alias]
    elif kind == "appearance":
        if character.get("generic"):
            raise LibraryError("ตัวประกอบไม่มีคำบรรยายรูปลักษณ์")
        character["appearance"] = text("appearance")
    elif kind == "status":
        if text("status") not in STATUSES:
            raise LibraryError("สถานะไม่ถูกต้อง")
        character["status"] = text("status")
    else:
        raise LibraryError(f"ไม่รู้จักข้อเสนอชนิด {kind!r}")


def _save_unless_failed_over_ok(path: Path, record: dict[str, Any]) -> None:
    """A failed re-run keeps the earlier good result (and its decisions); the job reports why."""

    if record["status"] != "ok" and (read_json(path) or {}).get("status") == "ok":
        return
    atomic_write_json(path, record)


class StoryService:
    def __init__(
        self,
        repo: LibraryRepository,
        workdir: Workdir,
        gateway: LlmGateway,
        runner: JobRunner,
        prompts_dir: Path,
    ) -> None:
        self.repo = repo
        self.workdir = workdir
        self.gateway = gateway
        self.runner = runner
        self.prompts_dir = prompts_dir
        self._lock = threading.Lock()  # proposal decisions and summary approvals

    # --- gates read by convert and status

    def scanned(self, book: str, volume: int, chapter: int) -> bool:
        """The chapter's scan came back and every proposal from it was decided."""

        found = read_json(self.workdir.scan_file(book, volume, chapter))
        return bool(
            found
            and found.get("status") == "ok"
            and all(p["state"] != "pending" for p in found.get("proposals", []))
        )

    def previous_summarized(self, book: str, volume: int, chapter: int) -> bool:
        """The soft gate before converting: the chapter before has an approved summary
        (the previous volume's summary for a first chapter). An imported volume passes."""

        current = self.repo.summaries(book, volume) or {}
        if current.get("imported"):
            return True
        meta = volume_meta(self.repo.book(book), volume)
        earlier = [c["n"] for c in meta.get("chapters", []) if c["n"] < chapter]
        if earlier:
            return str(max(earlier)) in current.get("chapters", {})
        if volume == 1:
            return True
        before = self.repo.summaries(book, volume - 1) or {}
        return bool(before.get("imported") or before.get("volume"))

    def chapter_published(self, book: str, volume: int, chapter: int) -> bool:
        pages = chapter_pages(self.repo, self.workdir, book, volume, chapter)
        drafts = [
            d
            for d in self.repo.drafts(book)
            if d.get("volume") == volume and d.get("bookChapter") == chapter
        ]
        entries = [
            e
            for e in self.repo.index(book)["chapters"]
            if e.get("volume") == volume and e.get("bookChapter") == chapter
        ]
        return pages.complete and not drafts and bool(entries)

    # --- scan

    def create_scan_job(
        self, book: str, volume: int, chapter: int, choice: ModelChoice
    ) -> dict[str, Any]:
        self.repo.require_book(book)
        self.gateway.check(choice.provider, choice.model, choice.effort, "scan")
        pages = chapter_pages(self.repo, self.workdir, book, volume, chapter)
        if not pages.complete:
            raise Conflict("บทยังไม่ครบทุกหน้า (หรือเป็นบทสุดท้ายของเล่มที่ยังไม่ปิด)")
        self.runner.require_idle(book, volume)
        record = self.runner.create(
            kind="scan",
            book=book,
            volume=volume,
            items=[chapter],
            params={"chapter": chapter, "model": choice.as_dict(), "parallel": 1, "calls": 1},
        )
        return self.start(record["id"])

    async def run_scan(
        self, book: str, volume: int, chapter: int, choice: ModelChoice, job_id: str
    ) -> ItemOutcome:
        pages = chapter_pages(self.repo, self.workdir, book, volume, chapter)
        card = self.repo.book(book)
        prompt = render(
            self.prompts_dir,
            "scan",
            {
                "bookTitle": card.get("title", ""),
                "styleNotes": style_notes(card),
                "roster": roster_block(self.repo.characters(book)),
                "chapterText": pages_block(pages.texts),
            },
        )
        payload, record = await call_task(
            self.gateway, choice, prompt, SCAN_SCHEMA, "scan", CALL_TIMEOUT_S
        )
        record.update({"job": job_id, "chapter": chapter})
        if payload is not None:
            record["result"] = payload
            record["proposals"] = scan_proposals(volume, chapter, payload)
            record["notes"] = {
                k: payload.get(k) or [] for k in ("speakingStyles", "promotedGenerics", "questions")
            }
        path = self.workdir.scan_file(book, volume, chapter)
        await asyncio.to_thread(_save_unless_failed_over_ok, path, record)
        if payload is None:
            return ItemOutcome("failed", f"{record['errorKind']}: {record['detail'][:200]}")
        return ItemOutcome("done", f"ข้อเสนอ {len(record['proposals'])} ข้อ")

    # --- summaries

    def create_summary_job(
        self, book: str, volume: int, chapter: int | None, choice: ModelChoice
    ) -> dict[str, Any]:
        self.repo.require_book(book)
        self.gateway.check(choice.provider, choice.model, choice.effort, "summarize")
        if chapter is None:
            meta = volume_meta(self.repo.book(book), volume)
            if not meta.get("closed"):
                raise Conflict("สรุปเล่มได้เมื่อปิดเล่มแล้ว (จบเล่มที่หน้า N)")
            done = (self.repo.summaries(book, volume) or {}).get("chapters", {})
            waiting = [c["n"] for c in meta.get("chapters", []) if str(c["n"]) not in done]
            if waiting or not meta.get("chapters"):
                raise Conflict(f"ยังไม่ได้สรุปบท: {', '.join(map(str, waiting)) or 'ไม่มีบท'}")
        elif not self.chapter_published(book, volume, chapter):
            raise Conflict("สรุปบทได้เมื่อ publish ครบทั้งบทแล้ว")
        self.runner.require_idle(book, volume)
        record = self.runner.create(
            kind="summarize",
            book=book,
            volume=volume,
            items=[chapter or 0],
            params={"chapter": chapter, "model": choice.as_dict(), "parallel": 1, "calls": 1},
        )
        return self.start(record["id"])

    def _summary_source(self, book: str, volume: int, chapter: int | None) -> str:
        if chapter is None:
            done = (self.repo.summaries(book, volume) or {}).get("chapters", {})
            return "\n\n".join(f"### บทที่ {n}\n{done[n]['summary']}" for n in sorted(done, key=int))
        characters = self.repo.characters(book)
        lines = []
        entries = sorted(
            (
                e
                for e in self.repo.index(book)["chapters"]
                if e.get("volume") == volume and e.get("bookChapter") == chapter
            ),
            key=lambda e: e["chapter"],
        )
        for entry in entries:
            for block in (self.repo.chapter(book, entry["id"]) or {}).get("blocks", []):
                kind = block.get("type")
                if kind == "scene":
                    lines.append(f"[ฉาก: {block.get('text', '')}]")
                elif kind == "gap":
                    lines.append(f"[เนื้อหาขาด: {block.get('note', '')}]")
                elif kind == "narration":
                    lines.append(block.get("text", ""))
                else:
                    speaker = block.get("speaker", "unknown")
                    name = (characters.get(speaker) or {}).get("short", speaker)
                    verb = "คิด" if kind == "thought" else "พูด"
                    lines.append(f"{name} ({speaker}) {verb}: {block.get('text', '')}")
        return "\n".join(lines)

    async def run_summary(
        self, book: str, volume: int, chapter: int | None, choice: ModelChoice, job_id: str
    ) -> ItemOutcome:
        level = "volume" if chapter is None else "chapter"
        context, ids = context_pack(self.repo, book, volume, chapter)
        card = self.repo.book(book)
        prompt = render(
            self.prompts_dir,
            "summarize",
            {
                "bookTitle": card.get("title", ""),
                "level": level,
                "context": context,
                "roster": roster_block(self.repo.characters(book)),
                "source": self._summary_source(book, volume, chapter),
            },
        )
        why = ""
        for _attempt in range(SUMMARY_ATTEMPTS):
            payload, record = await call_task(
                self.gateway, choice, prompt, SUMMARY_SCHEMA, "summarize", CALL_TIMEOUT_S, ids
            )
            if payload is None:
                break
            why = over_budget(payload, level)
            if not why:
                break
            # over budget: ask again for a shorter one (never cut the text ourselves)
            prompt = Prompt(
                prompt.template,
                prompt.text + f"\n\n## ย่อใหม่\nคำตอบรอบก่อน{why} — เขียนใหม่ให้อยู่ในงบ ห้ามตัดท้ายเฉย ๆ\n",
                prompt.template_hash,
            )
        record.update({"job": job_id, "level": level, "chapter": chapter})
        if payload is not None and why:
            record.update({"status": "failed", "errorKind": "over_budget", "detail": why})
        elif payload is not None:
            target = f"c{chapter}" if chapter else "vol"
            record["result"] = payload
            record["state"] = "pending"
            record["proposals"] = [
                {
                    "id": f"sum-v{volume}-{target}-{i}",
                    "kind": "status",
                    "key": str(p.get("key", "")),
                    "value": {"status": p.get("status")},
                    "evidence": str(p.get("evidence", "")),
                    "state": "pending",
                }
                for i, p in enumerate(payload.get("statusProposals") or [], start=1)
            ]
        path = self.workdir.summary_file(book, volume, chapter)
        await asyncio.to_thread(_save_unless_failed_over_ok, path, record)
        if record["status"] != "ok":
            return ItemOutcome("failed", f"{record['errorKind']}: {record['detail'][:200]}")
        return ItemOutcome("done", f"สรุป {len(payload['summary'])} ตัวอักษร")

    def approve_summary(
        self,
        book: str,
        volume: int,
        chapter: int | None,
        summary: str | None,
        short: str | None,
    ) -> dict[str, Any]:
        level = "volume" if chapter is None else "chapter"
        with self._lock:
            path = self.workdir.summary_file(book, volume, chapter)
            pending = read_json(path)
            if not pending or pending.get("status") != "ok":
                raise NotFound("ยังไม่มีสรุปที่รออนุมัติ")
            result = dict(pending["result"])
            if summary is not None:
                result["summary"] = summary.strip()
            if short is not None:
                result["short"] = short.strip()
            if why := over_budget(result, level):
                raise LibraryError(why)
            entry = {k: result.get(k) for k in ("summary", "party", "location", "openThreads")} | {
                "approvedAt": stamp(),
                "templateHash": pending["templateHash"],
                "contextIds": pending.get("contextIds", []),
                "model": f"{pending['provider']}/{pending['model']}",
            }
            if level == "volume":
                entry["short"] = result.get("short") or ""
            with self.repo.lock(book):
                current = self.repo.summaries(book, volume) or {}
                current.setdefault("chapters", {})
                if chapter is None:
                    current["volume"] = entry
                else:
                    current["chapters"][str(chapter)] = entry
                self.repo.write_summaries(book, volume, current)
            pending["state"] = "approved"
            atomic_write_json(path, pending)
            return entry

    def set_imported(self, book: str, volume: int, imported: bool) -> dict[str, Any]:
        """Volume 1 was published before summaries existed: skip the summary gates for it."""

        with self.repo.lock(book):
            current = self.repo.summaries(book, volume) or {"chapters": {}}
            if imported:
                current["imported"] = True
            else:
                current.pop("imported", None)
            self.repo.write_summaries(book, volume, current)
            return current

    # --- jobs

    def start(self, job_id: str) -> dict[str, Any]:
        record = self.runner.get(job_id)
        book, volume, params = record["book"], record["volume"], record["params"]
        self.runner.require_idle(book, volume)
        choice = ModelChoice(**params["model"])
        chapter = params["chapter"]
        if record["kind"] == "scan":
            path = self.workdir.scan_file(book, volume, chapter)
            run = self.run_scan
        else:
            path = self.workdir.summary_file(book, volume, chapter)
            run = self.run_summary
        return self.runner.start(
            job_id,
            Work(
                is_done=lambda _n: bool(
                    (found := read_json(path))
                    and found.get("job") == job_id
                    and found.get("status") == "ok"
                ),
                run=lambda _n: run(book, volume, chapter, choice, job_id),
            ),
            1,
        )

    # --- proposals

    def _sources(self, book: str) -> list[tuple[Path, int, int | None]]:
        """Every scan and summary file of the book: (path, volume, chapter or None)."""

        found = []
        for volume in sorted(self.workdir.volumes_on_disk(book)):
            base = self.workdir.volume(book, volume)
            for path in sorted((base / "scan").glob("c*.json")):
                found.append((path, volume, int(path.stem[1:])))
            for path in sorted((base / "summaries").glob("*.json")):
                found.append((path, volume, None if path.stem == "volume" else int(path.stem[1:])))
        return found

    def proposals(self, book: str) -> list[dict[str, Any]]:
        self.repo.require_book(book)
        out = []
        for path, volume, chapter in self._sources(book):
            record = read_json(path) or {}
            source = "scan" if path.parent.name == "scan" else "summary"
            for p in record.get("proposals", []):
                out.append(p | {"volume": volume, "chapter": chapter, "source": source})
        return out

    def notes(self, book: str) -> list[dict[str, Any]]:
        """Scan questions, speaking styles and promoted generics: for a person to read."""

        out = []
        for path, volume, chapter in self._sources(book):
            record = read_json(path) or {}
            if path.parent.name == "scan" and record.get("status") == "ok":
                out.append({"volume": volume, "chapter": chapter, **record.get("notes", {})})
        return out

    def decide(self, book: str, proposal_id: str, accept: bool) -> dict[str, Any]:
        match = PROPOSAL_ID.fullmatch(proposal_id)
        if not match:
            raise LibraryError(f"Bad proposal id {proposal_id!r}.")
        source, volume, target = match.group(1), int(match.group(2)), match.group(3)
        chapter = None if target == "vol" else int(target[1:])
        if source == "scan":
            path = self.workdir.scan_file(book, volume, chapter or 0)
        else:
            path = self.workdir.summary_file(book, volume, chapter)
        with self._lock:
            record = read_json(path)
            proposal = next(
                (p for p in (record or {}).get("proposals", []) if p["id"] == proposal_id), None
            )
            if proposal is None:
                raise NotFound(f"No proposal {proposal_id!r}.")
            if proposal["state"] != "pending":
                raise Conflict("ข้อเสนอนี้ตัดสินไปแล้ว")
            if accept:
                first_seen = f"v{volume}-book{chapter}" if chapter else f"v{volume}"
                self.repo.update_characters(
                    book, lambda characters: apply_proposal(characters, proposal, first_seen)
                )
            proposal["state"] = "accepted" if accept else "rejected"
            proposal["decidedAt"] = stamp()
            atomic_write_json(path, record)
            return proposal

    # --- the story page

    def story(self, book: str) -> dict[str, Any]:
        card = self.repo.book(book)
        numbers = {v["n"] for v in card.get("volumes", [])} | self.workdir.volumes_on_disk(book)
        numbers |= {e["volume"] for e in self.repo.index(book)["chapters"]}
        volumes = []
        for volume in sorted(numbers):
            approved = self.repo.summaries(book, volume) or {}
            meta = volume_meta(card, volume)

            def pending(chapter: int | None, volume: int = volume) -> dict[str, Any] | None:
                found = read_json(self.workdir.summary_file(book, volume, chapter))
                if found and found.get("status") == "ok" and found.get("state") == "pending":
                    return found["result"]
                return None

            volumes.append(
                {
                    "n": volume,
                    "title": meta.get("title"),
                    "closed": bool(meta.get("closed")),
                    "imported": bool(approved.get("imported")),
                    "chapters": [
                        {
                            "n": c["n"],
                            "title": c.get("title"),
                            "approved": approved.get("chapters", {}).get(str(c["n"])),
                            "pending": pending(c["n"]),
                        }
                        for c in sorted(meta.get("chapters", []), key=lambda c: c["n"])
                    ],
                    "volume": approved.get("volume"),
                    "volumePending": pending(None),
                }
            )
        return {
            "book": book,
            "title": card.get("title", ""),
            "styleNotes": card.get("styleNotes"),
            "characters": self.repo.characters(book),
            "proposals": self.proposals(book),
            "notes": self.notes(book),
            "volumes": volumes,
        }
