"""Phase 6 end to end with a fake text model: scan -> convert -> review -> publish -> summarize."""

from __future__ import annotations

import json
import re
import time

import pytest
from fastapi.testclient import TestClient

from app.core.config import ROOT
from app.core.services import Services
from app.infrastructure.llm import LlmGateway, StructuredCall, StructuredResult
from app.infrastructure.llm.providers.claude import INFO as CLAUDE_INFO
from app.main import create_app
from app.modules.convert.coverage import coverage

from .conftest import HEADERS

MODEL = {"provider": "claude", "model": "sonnet", "effort": "low"}
PAGES = {1: "ต้นเดินเข้าร้านแต่เช้า แดดยังอ่อน", 2: "ขอกาแฟดำแก้วหนึ่งครับ", 3: "มะลิยิ้มแล้วหันไปชงกาแฟ"}


class FakeTextModel:
    """Answers scan / convert / summarize from the prompt it is sent."""

    info = CLAUDE_INFO

    def __init__(self) -> None:
        self.prompts: list[tuple[str, str]] = []
        self.summary = "ต้นมาที่ร้านแต่เช้าและสั่งกาแฟจากมะลิ"

    async def status(self):
        from app.infrastructure.llm.cli import utcnow
        from app.infrastructure.llm.models import ProviderStatus

        return ProviderStatus(available=True, detail="fake", checked_at=utcnow())

    async def call(self, request: StructuredCall) -> StructuredResult:
        self.prompts.append((request.task, request.prompt))
        if request.task == "scan":
            answer = {
                "newCharacters": [
                    {"key": "ton", "name": "ต้น", "short": "ต้น", "initials": None,
                     "color": "#1d4ed8", "side": "left", "role": None, "aliases": [],
                     "appearance": None, "speakingStyle": None, "evidence": "หน้า 1"}
                ],
                "newAliases": [], "newGenerics": [], "speakingStyles": [],
                "promotedGenerics": [], "appearanceUpdates": [], "questions": [],
            }  # fmt: skip
        elif request.task == "convert":
            section = request.prompt.split("## หน้าที่ต้องแปลง", 1)[1].split("## รูปแบบคำตอบ")[0]
            found = re.findall(r"### image (\d+)\n(.*?)(?=\n\n### image|\Z)", section, re.S)
            answer = {
                "pages": [
                    {
                        "image": image,
                        "blocks": [
                            {
                                "type": "dialogue",
                                "text": text.strip(),
                                "speaker": "ton",
                                "note": None,
                                "speakerNum": None,
                                "action": None,
                                # the model is unsure of page 2's speaker
                                "needsReview": image == "002",
                            }
                        ],
                    }  # fmt: skip
                    for image, text in found
                ]
            }
        else:
            answer = {
                "summary": self.summary, "short": None, "party": ["ton"], "location": "ร้าน",
                "openThreads": [], "questions": [],
                "statusProposals": [{"key": "ton", "status": "left", "evidence": "ออกจากร้าน"}],
            }  # fmt: skip
        return StructuredResult(payload=answer, raw_text=json.dumps(answer, ensure_ascii=False))


@pytest.fixture
def model() -> FakeTextModel:
    return FakeTextModel()


@pytest.fixture
def services(settings, model) -> Services:
    services = Services.build(settings, gateway=LlmGateway([model]))
    for image, text in PAGES.items():
        services.repo.write_raw("demo", 2, image, image, "x", text)
    services.repo.set_volume(
        "demo",
        {"n": 2, "chapters": [{"n": 1, "startImage": 1}], "closed": True, "endImage": 3},
    )
    return services


@pytest.fixture
def client(services):
    with TestClient(create_app(services=services), headers=HEADERS) as test_client:
        yield test_client


def wait(client, job_id: str) -> dict:
    for _ in range(200):
        job = client.get(f"/api/jobs/{job_id}").json()
        if not job["running"]:
            return job
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def convert(client, **extra):
    body = {"book": "demo", "volume": 2, "chapter": 1, "model": MODEL, "pagesPerCall": 2}
    return client.post("/api/convert/jobs", json=body | extra)


@pytest.mark.parametrize(
    "case",
    json.loads((ROOT / "scripts" / "coverage-cases.json").read_text(encoding="utf-8")),
    ids=lambda c: c["name"],
)
def test_coverage_cases_shared_with_node(case):
    got = coverage(case["blocks"], case["raw"])
    assert (got["ratio"], len(got["missing"]), got["ok"]) == (
        case["ratio"],
        case["missing"],
        case["ok"],
    )


def test_scan_convert_review_publish_summarize(client, services, model):
    # converting waits for the character scan (hard gate)
    blockers = convert(client, dryRun=True).json()["plan"]["blockers"]
    assert any("สแกนตัวละคร" in b for b in blockers)

    job = client.post(
        "/api/scan/jobs", json={"book": "demo", "volume": 2, "chapter": 1, "model": MODEL}
    ).json()
    assert wait(client, job["id"])["state"] == "done"
    (proposal,) = client.get("/api/books/demo/proposals").json()
    accepted = client.post(f"/api/books/demo/proposals/{proposal['id']}/accept", json={})
    assert accepted.status_code == 200
    assert services.repo.characters("demo")["ton"]["firstSeen"] == "v2-book1"

    plan = convert(client, dryRun=True).json()["plan"]
    assert plan["blockers"] == [] and plan["batches"] == [[1, 2], [3]]
    assert convert(client).status_code == 409  # soft gate: volume 1 has no summary
    job = convert(client, acceptRisk=True).json()["job"]
    assert wait(client, job["id"])["state"] == "done"
    drafts = client.get("/api/books/demo/volumes/2/drafts").json()
    assert [d["id"] for d in drafts] == ["v2-c1", "v2-c2", "v2-c3"]

    flagged = client.get("/api/books/demo/drafts/v2-c2").json()
    assert flagged["coverage"]["ok"] and flagged["problems"] == ["ยังมีธง needsReview 1 จุด"]
    assert client.post("/api/books/demo/drafts/v2-c2/publish", json={}).status_code == 409
    block = flagged["draft"]["blocks"][0] | {"needsReview": False}
    saved = client.patch("/api/books/demo/drafts/v2-c2", json={"blocks": [block]}).json()
    assert saved["problems"] == []

    assert client.post("/api/books/demo/drafts/v2-c3/publish", json={}).status_code == 409  # order
    for draft_id in ("v2-c1", "v2-c2", "v2-c3"):
        assert client.post(f"/api/books/demo/drafts/{draft_id}/publish", json={}).status_code == 200
    index = services.repo.index("demo")["chapters"]
    assert [e["id"] for e in index if e["volume"] == 2] == ["v2-c1", "v2-c2", "v2-c3"]
    assert "draft" not in services.repo.chapter("demo", "v2-c1")
    assert services.repo.drafts("demo") == []

    job = client.post(
        "/api/summarize/jobs", json={"book": "demo", "volume": 2, "chapter": 1, "model": MODEL}
    ).json()
    assert wait(client, job["id"])["state"] == "done"
    approved = client.post(
        "/api/books/demo/volumes/2/summaries/approve", json={"chapter": 1}
    ).json()
    assert approved["summary"] == model.summary
    assert services.repo.summaries("demo", 2)["chapters"]["1"]["templateHash"]
    proposals = client.get("/api/books/demo/proposals").json()
    status = next(p for p in proposals if p["kind"] == "status")
    client.post(f"/api/books/demo/proposals/{status['id']}/accept", json={})
    assert services.repo.characters("demo")["ton"]["status"] == "left"


def test_a_summary_over_budget_is_sent_back_then_refused(client, services, model):
    model.summary = "ก" * 1600
    services.repo.publish_chapter(
        "demo",
        {"id": "v2-c1", "volume": 2, "volumeTitle": "สอง", "chapter": 1, "bookChapter": 1,
         "title": "x", "blocks": [{"type": "narration", "text": "".join(PAGES.values())}]},
    )  # fmt: skip
    job = client.post(
        "/api/summarize/jobs", json={"book": "demo", "volume": 2, "chapter": 1, "model": MODEL}
    ).json()
    finished = wait(client, job["id"])
    assert finished["state"] == "failed" and "เกินงบ" in finished["items"]["1"]["detail"]
    assert [t for t, _ in model.prompts] == ["summarize", "summarize"]  # asked once to shorten
    assert "ย่อใหม่" in model.prompts[1][1]


def test_volume_two_converts_with_the_volume_one_summary_as_context(client, services, model):
    services.repo.write_summaries(
        "demo", 1, {"chapters": {}, "volume": {"summary": "สรุปของเล่มหนึ่ง", "short": "ย่อ"}}
    )
    scan = {"status": "ok", "proposals": []}
    path = services.workdir.scan_file("demo", 2, 1)
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(scan), encoding="utf-8")
    services.repo.update_characters("demo", lambda c: c.update(ton={"name": "ต้น"}))
    job = convert(client).json()["job"]  # no soft-gate warning: volume 1 is summarized
    assert wait(client, job["id"])["state"] == "done"
    batch = json.loads(
        (services.workdir.convert_dir("demo", 2, 1) / "batch-01.json").read_text(encoding="utf-8")
    )
    assert batch["contextIds"] == ["v1"] and "สรุปของเล่มหนึ่ง" in batch["prompt"]
