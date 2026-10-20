from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import ROOT, Settings
from app.core.process_gate import ProcessGate
from app.core.services import Services
from app.infrastructure.llm import LlmGateway, StructuredCall, StructuredResult
from app.infrastructure.llm.cli import CliTransport, ProcessOutcome
from app.infrastructure.llm.providers.agy import INFO as AGY_INFO
from app.main import create_app

GOLDEN = Path(__file__).parent / "golden"
TOKEN = "test-token"
HEADERS = {"x-studio-token": TOKEN, "host": "127.0.0.1:8000"}


def golden(name: str) -> ProcessOutcome:
    data = json.loads((GOLDEN / f"{name}.json").read_text(encoding="utf-8"))
    return ProcessOutcome(
        launched=True,
        stdout=data["stdout"].encode("utf-8"),
        stderr=data["stderr"].encode("utf-8"),
        returncode=data["returncode"],
    )


class RecordingTransport(CliTransport):
    """Replays a golden recording instead of spawning, and keeps the argv it was given."""

    def __init__(self, outcome: ProcessOutcome) -> None:
        super().__init__(ProcessGate(1))
        self.outcome = outcome
        self.calls: list[dict[str, Any]] = []

    async def run(
        self, argv: Sequence[str], *, stdin: bytes, cwd: Path, timeout_s: float
    ) -> ProcessOutcome:
        files = {p.name for p in cwd.iterdir()}
        self.calls.append({"argv": list(argv), "stdin": stdin, "cwd": cwd, "files": files})
        return self.outcome


class FakeOcrProvider:
    """Stands in for agy (or another provider): answers each page from a table, optionally slowly.

    Pages in `fail` come back as a failed call, as a CLI that timed out would.
    """

    def __init__(
        self,
        answers: dict[int, dict[str, Any]] | None = None,
        delay: float = 0,
        info: Any = AGY_INFO,
    ) -> None:
        self.info = info
        self.answers = answers or {}
        self.delay = delay
        self.fail: set[int] = set()
        self.calls: list[int] = []

    async def status(self):
        from app.infrastructure.llm.cli import utcnow
        from app.infrastructure.llm.models import ProviderStatus

        return ProviderStatus(available=True, detail="fake", checked_at=utcnow())

    async def call(self, request: StructuredCall) -> StructuredResult:
        import asyncio

        image = int(request.images[0].stem)
        self.calls.append(image)
        if self.delay:
            await asyncio.sleep(self.delay)
        if image in self.fail:
            return StructuredResult(error_kind="timeout", error_detail="fake timeout")
        answer = self.answers.get(
            image,
            {
                "text": f"ข้อความหน้า {image} " * 20,
                "bookPage": image,
                "uncertain": [],
                "isCover": False,
            },
        )
        return StructuredResult(payload=answer, raw_text=json.dumps(answer, ensure_ascii=False))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


@pytest.fixture
def library(tmp_path: Path) -> Path:
    """A one-book library: 2 published chapters on pages 1-2, raw for pages 1-3."""

    root = tmp_path / "library"
    book = root / "demo"
    write_json(book / "book.json", {"title": "ตัวอย่าง", "author": "ทดสอบ", "language": "th"})
    write_json(
        book / "characters.json",
        {"a": {"name": "เอ", "short": "เอ", "color": "#000000", "side": "left"}},
    )
    entries = []
    for n in (1, 2):
        chapter = {
            "id": f"v1-c{n}",
            "volume": 1,
            "volumeTitle": "เล่มแรก",
            "chapter": n,
            "bookChapter": 1,
            "title": f"บทที่ 1 · ช่วงที่ {n}",
            "sourcePages": [n],
            "blocks": [{"type": "narration", "text": "x"}],
        }
        write_json(book / "chapters" / f"v1-c{n}.json", chapter)
        entries.append({k: v for k, v in chapter.items() if k not in ("blocks", "sourcePages")})
    write_json(book / "index.json", {"title": "ตัวอย่าง", "author": "ทดสอบ", "chapters": entries})
    for n in (1, 2, 3):
        raw = book / "raw" / "v1" / f"img-{n:03d}.txt"
        raw.parent.mkdir(parents=True, exist_ok=True)
        marker = "<!-- chapter: 1 -->\n\n" if n == 1 else ""
        raw.write_text(
            f"<!-- image: {n:03d} -->\n<!-- book-page: {n} -->\n<!-- source: x -->\n\n{marker}"
            + "ข้อความในหน้า " * 20,
            encoding="utf-8",
        )
    return root


@pytest.fixture
def settings(tmp_path: Path, library: Path) -> Settings:
    return Settings(
        root=tmp_path,  # cover uploads also write <root>/public/books/
        library_dir=library,
        prompts_dir=ROOT / "prompts",
        workdir=tmp_path / "workdir",
        token=TOKEN,
    )


@pytest.fixture
def fake_provider() -> FakeOcrProvider:
    return FakeOcrProvider()


@pytest.fixture
def services(settings: Settings, fake_provider: FakeOcrProvider) -> Services:
    return Services.build(settings, gateway=LlmGateway([fake_provider]))


@pytest.fixture
def client(services: Services):
    with TestClient(create_app(services=services), headers=HEADERS) as test_client:
        yield test_client
