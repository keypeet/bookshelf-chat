"""OCR with several models: page x model calls, everything to the queue, pick one per page."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.core.services import Services
from app.infrastructure.llm import LlmGateway
from app.infrastructure.llm.providers.grok import INFO as GROK_INFO
from app.main import create_app

from .conftest import HEADERS, FakeOcrProvider
from .test_ocr_jobs import MODEL, upload, wait_for

GROK = {"provider": "grok", "model": "grok-4.7", "effort": "low"}
BOTH = [MODEL, GROK]


@pytest.fixture
def grok() -> FakeOcrProvider:
    return FakeOcrProvider(info=GROK_INFO)


@pytest.fixture
def services(settings, fake_provider, grok) -> Services:
    return Services.build(settings, gateway=LlmGateway([fake_provider, grok]))


@pytest.fixture
def client(services):
    with TestClient(create_app(services=services), headers=HEADERS) as test_client:
        yield test_client


def start(client, **overrides):
    body = {"book": "demo", "volume": 2, "from": 1, "count": 3, "parallel": 2, "models": BOTH}
    return client.post("/api/ocr/jobs", json=body | overrides)


def queue_pages(client, volume=2):
    return sorted(
        {q["image"] for q in client.get(f"/api/books/demo/volumes/{volume}/ocr/queue").json()}
    )


def test_call_count_is_pages_times_models(client):
    upload(client)
    assert start(client, dryRun=True).json()["plan"]["calls"] == 6


def test_the_same_model_twice_or_too_many_models_is_refused(client):
    upload(client)
    assert start(client, models=[MODEL, MODEL], dryRun=True).status_code == 400
    assert start(client, models=[MODEL] * 5, dryRun=True).status_code == 422


def test_several_models_never_accept_on_their_own(client, services, fake_provider, grok):
    upload(client)
    job = wait_for(client, start(client).json()["job"]["id"])
    assert job["state"] == "done"
    assert {i["detail"] for i in job["items"].values()} == {"review"}
    assert sorted(fake_provider.calls) == [1, 2, 3] and sorted(grok.calls) == [1, 2, 3]
    assert services.repo.raw_images("demo", 2) == []
    assert queue_pages(client) == [1, 2, 3]

    page = client.get("/api/books/demo/volumes/2/pages/2").json()
    assert page["raw"] is None and page["lastPage"] == 8
    assert {c["provider"] for c in page["candidates"]} == {"agy", "grok"}
    assert page["candidates"][0]["result"]["text"].startswith("ข้อความหน้า 2")


def test_picking_one_result_writes_raw_and_settles_the_page(client, services):
    upload(client)
    wait_for(client, start(client).json()["job"]["id"])
    body = {**GROK, "text": "ข้อความที่แก้แล้ว"}
    body.pop("effort")
    accepted = client.post("/api/books/demo/volumes/2/pages/2/accept", json=body).json()
    assert accepted["state"] == "accepted" and "แก้ข้อความ" in accepted["reasons"][0]
    assert services.repo.raw("demo", 2, 2)[1] == "ข้อความที่แก้แล้ว"
    assert queue_pages(client) == [1, 3]

    states = {
        c["provider"]: c["accept"]
        for c in client.get("/api/books/demo/volumes/2/pages/2").json()["candidates"]
    }
    assert states == {"grok": "accepted", "agy": "rejected"}

    # an empty edit is refused rather than writing a blank page
    empty = {"provider": "agy", "model": "gemini-3.8-flash", "text": "  "}
    assert client.post("/api/books/demo/volumes/2/pages/1/accept", json=empty).status_code == 400


def test_one_model_failing_marks_the_page_failed_and_resume_calls_only_that_model(
    client, fake_provider, grok
):
    grok.fail = {2}
    upload(client)
    job = wait_for(client, start(client).json()["job"]["id"])
    assert job["state"] == "failed" and "grok" in job["items"]["2"]["detail"]

    grok.fail = set()
    agy_before, grok_before = len(fake_provider.calls), len(grok.calls)
    client.post(f"/api/jobs/{job['id']}/resume", json={})
    assert wait_for(client, job["id"])["state"] == "done"
    assert fake_provider.calls[agy_before:] == [] and grok.calls[grok_before:] == [2]


def test_keep_raw_settles_every_model_on_a_checked_page(client, services):
    v1 = services.workdir.pages_dir("demo", 1)
    v1.mkdir(parents=True)
    (v1 / "001.webp").write_bytes(b"x")
    wait_for(client, start(client, volume=1, count=1).json()["job"]["id"])
    reasons = client.get("/api/books/demo/volumes/1/ocr/queue").json()[0]["reasons"]
    assert any("raw" in r for r in reasons)
    body = {"provider": "agy", "model": "gemini-3.8-flash"}
    assert client.post("/api/books/demo/volumes/1/pages/1/keep-raw", json=body).status_code == 200
    assert queue_pages(client, volume=1) == []


def test_odd_results_carry_their_reasons_to_the_compare_page(client, grok):
    grok.answers = {1: {"text": "", "bookPage": None, "uncertain": [], "isCover": False}}
    upload(client)
    wait_for(client, start(client, count=1).json()["job"]["id"])
    page = client.get("/api/books/demo/volumes/2/pages/1").json()
    reasons = {c["provider"]: c["reasons"] for c in page["candidates"]}
    assert any("หน้าว่าง" in r for r in reasons["grok"])
    assert not any("หน้าว่าง" in r for r in reasons["agy"])


def test_a_settled_page_is_not_called_again_on_resume(client, services, grok):
    grok.fail = {2}
    upload(client)
    job = wait_for(client, start(client).json()["job"]["id"])
    body = {"provider": "agy", "model": "gemini-3.8-flash"}
    assert client.post("/api/books/demo/volumes/2/pages/2/accept", json=body).status_code == 200
    grok.fail = set()
    before = len(grok.calls)
    client.post(f"/api/jobs/{job['id']}/resume", json={})
    assert wait_for(client, job["id"])["state"] == "done"
    assert grok.calls[before:] == []  # page 2 was settled, so grok was not asked again
    assert queue_pages(client) == [1, 3]


def test_a_model_finishing_after_the_page_was_chosen_stays_out_of_the_queue(client, grok):
    grok.delay = 0.6
    upload(client)
    job = start(client, count=1).json()["job"]
    page = "/api/books/demo/volumes/2/pages/1"
    deadline = time.time() + 5
    while not client.get(page).json()["candidates"]:
        assert time.time() < deadline
        time.sleep(0.05)
    body = {"provider": "agy", "model": "gemini-3.8-flash"}
    assert client.post(f"{page}/accept", json=body).status_code == 200
    wait_for(client, job["id"])
    states = {c["provider"]: c["accept"] for c in client.get(page).json()["candidates"]}
    assert states == {"agy": "accepted", "grok": "rejected"}
    assert queue_pages(client) == []


def test_a_chosen_page_refuses_a_second_choice(client, fake_provider):
    fake_provider.answers = {1: {"text": "", "bookPage": None, "uncertain": [], "isCover": True}}
    upload(client)
    wait_for(client, start(client, count=1).json()["job"]["id"])
    cover = {"provider": "agy", "model": "gemini-3.8-flash"}
    assert (
        client.post("/api/books/demo/volumes/2/pages/1/accept", json=cover).json()["state"]
        == "cover"
    )
    other = {"provider": "grok", "model": "grok-4.7"}
    assert client.post("/api/books/demo/volumes/2/pages/1/accept", json=other).status_code == 409


def test_resuming_while_another_job_runs_on_the_volume_is_refused(client, fake_provider):
    upload(client)
    first = wait_for(client, start(client, count=1).json()["job"]["id"])
    fake_provider.delay = 0.5
    second = start(client, **{"from": 2, "count": 1}).json()["job"]
    assert client.post(f"/api/jobs/{first['id']}/resume", json={}).status_code == 409
    client.post(f"/api/jobs/{second['id']}/cancel", json={})


def test_one_model_run_does_not_auto_accept_while_another_result_waits(client, services, grok):
    grok.answers = {1: {"text": "", "bookPage": None, "uncertain": [], "isCover": False}}
    upload(client)
    wait_for(client, start(client, count=1, models=[GROK]).json()["job"]["id"])  # blank: queued
    wait_for(client, start(client, count=1, models=[MODEL]).json()["job"]["id"])
    assert services.repo.raw_images("demo", 2) == []
    reasons = client.get("/api/books/demo/volumes/2/ocr/queue").json()
    assert any("โมเดลอื่น" in r for q in reasons if q["provider"] == "agy" for r in q["reasons"])
