"""OCR jobs through the API with a fake provider: plan, run, cancel, resume, accept, queue."""

from __future__ import annotations

import io
import time

from PIL import Image

from .conftest import FakeOcrProvider

MODEL = {"provider": "agy", "model": "gemini-3.8-flash", "effort": "low"}


def make_pdf(pages: int) -> bytes:
    images = [Image.new("RGB", (200, 280), "white") for _ in range(pages)]
    out = io.BytesIO()
    images[0].save(out, "PDF", save_all=True, append_images=images[1:])
    return out.getvalue()


def upload(client, pages: int = 8):
    return client.post(
        "/api/books/demo/volumes/2/source",
        files={"file": ("book.pdf", make_pdf(pages), "application/pdf")},
    )


def wait_for(client, job_id: str, states=("done", "failed", "cancelled"), timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["state"] in states and not job["running"]:
            return job
        time.sleep(0.05)
    raise AssertionError(f"job stayed {job['state']}")


def start(client, **overrides):
    body = {"book": "demo", "volume": 2, "from": 1, "count": 5, "parallel": 2, "models": [MODEL]}
    return client.post("/api/ocr/jobs", json=body | overrides)


def test_pdf_upload_checks_the_file(client):
    bad = client.post(
        "/api/books/demo/volumes/2/source",
        files={"file": ("x.pdf", b"not a pdf", "application/pdf")},
    )
    assert bad.status_code == 400
    assert upload(client).json() == {"pages": 8}
    assert upload(client).status_code == 409  # one source per volume


def test_dry_run_reports_the_call_count(client):
    upload(client)
    plan = start(client, dryRun=True).json()
    assert plan["job"] is None
    assert plan["plan"]["pages"] == [1, 2, 3, 4, 5] and plan["plan"]["calls"] == 5


def test_job_renders_pages_lazily_and_accepts_good_pages(client, services):
    upload(client)
    job = start(client, count=3).json()["job"]
    job = wait_for(client, job["id"])
    assert job["state"] == "done"
    pages = services.workdir.page_images("demo", 2)
    assert sorted(pages) == [1, 2, 3]  # only the requested range was rendered
    assert services.repo.raw_images("demo", 2) == [1, 2, 3]
    _, body = services.repo.raw("demo", 2, 1)
    assert body.startswith("ข้อความหน้า 1")


def test_cancel_then_resume_skips_finished_pages(client, services, fake_provider):
    fake_provider.delay = 0.3
    upload(client)
    job = start(client, count=5, parallel=1).json()["job"]
    time.sleep(0.45)
    cancelled = client.post(f"/api/jobs/{job['id']}/cancel", json={}).json()
    assert cancelled["state"] == "cancelled"
    done_before = [int(k) for k, v in cancelled["items"].items() if v["state"] == "done"]
    assert 1 <= len(done_before) < 5
    calls_before = list(fake_provider.calls)

    fake_provider.delay = 0
    client.post(f"/api/jobs/{job['id']}/resume", json={})
    finished = wait_for(client, job["id"])
    assert finished["state"] == "done"
    new_calls = fake_provider.calls[len(calls_before) :]
    assert not set(new_calls) & set(done_before)  # finished pages were not called again
    assert services.repo.raw_images("demo", 2) == [1, 2, 3, 4, 5]


def test_odd_pages_and_existing_raw_go_to_the_queue(client, services, fake_provider):
    fake_provider.answers = {
        2: {"text": "", "bookPage": None, "uncertain": [], "isCover": False},  # blank page
        1: {"text": "", "bookPage": None, "uncertain": [], "isCover": True},  # front cover
        3: {"text": "", "bookPage": None, "uncertain": [], "isCover": True},  # mid-book "cover"
    }
    upload(client)
    wait_for(client, start(client, count=4).json()["job"]["id"])
    queue = client.get("/api/books/demo/volumes/2/ocr/queue").json()
    assert [q["image"] for q in queue] == [2, 3]
    assert services.repo.raw_images("demo", 2) == [4]

    # confirming the mid-book cover writes no raw and clears it from the queue
    body = {"provider": "agy", "model": "gemini-3.8-flash"}
    assert (
        client.post("/api/books/demo/volumes/2/pages/3/accept", json=body).json()["state"]
        == "cover"
    )
    assert [q["image"] for q in client.get("/api/books/demo/volumes/2/ocr/queue").json()] == [2]
    assert services.repo.raw_images("demo", 2) == [4]

    # volume 1 already has raw pages 1-3, checked by hand: never overwritten
    v1 = services.workdir.pages_dir("demo", 1)
    v1.mkdir(parents=True)
    for n in (1, 2):
        (v1 / f"{n:03d}.webp").write_bytes(b"x")
    before = services.repo.raw_path("demo", 1, 1).read_bytes()
    job = start(client, volume=1, count=2).json()["job"]
    wait_for(client, job["id"])
    assert services.repo.raw_path("demo", 1, 1).read_bytes() == before
    queue = client.get("/api/books/demo/volumes/1/ocr/queue").json()
    assert {q["image"] for q in queue} == {1, 2} and all(q["rawExists"] for q in queue)


def test_manual_accept_writes_edited_text_once(client, services, fake_provider):
    fake_provider.answers = {1: {"text": "", "bookPage": 1, "uncertain": [], "isCover": False}}
    upload(client)
    wait_for(client, start(client, count=1).json()["job"]["id"])
    body = {"provider": "agy", "model": "gemini-3.8-flash", "text": "แก้แล้ว"}
    accepted = client.post("/api/books/demo/volumes/2/pages/1/accept", json=body)
    assert accepted.json()["state"] == "accepted"
    assert services.repo.raw("demo", 2, 1)[1] == "แก้แล้ว"
    again = client.post("/api/books/demo/volumes/2/pages/1/accept", json=body)
    assert again.status_code == 409


def test_restart_marks_running_jobs_interrupted(services):
    record = services.runner.create(kind="ocr", book="demo", volume=2, items=[1], params={})
    assert record["state"] == "running"
    from app.modules.jobs.runner import JobRunner

    fresh = JobRunner(services.workdir)
    assert fresh.recover() == 1
    assert fresh.get(record["id"])["state"] == "interrupted"


def test_unknown_model_is_refused_before_any_call(client, fake_provider):
    upload(client)
    bad = start(client, models=[{**MODEL, "effort": "max"}])
    assert bad.status_code == 400
    assert fake_provider.calls == []


def test_providers_endpoint_lists_status(client):
    providers = client.get("/api/providers").json()
    assert [p["id"] for p in providers] == ["agy"]
    assert providers[0]["status"]["available"] is True


def test_books_and_chapter_boundaries(client):
    assert [b["slug"] for b in client.get("/api/books").json()] == ["demo"]
    body = {"chapters": [{"n": 1, "startImage": 1}, {"n": 2, "startImage": 3}], "endImage": 5}
    card = client.put("/api/books/demo/volumes/1/chapters", json=body).json()
    assert card["volumes"][0]["closed"] is True and card["volumes"][0]["endImage"] == 5
    bad = {"chapters": [{"n": 1, "startImage": 4}], "endImage": 2}
    assert client.put("/api/books/demo/volumes/1/chapters", json=bad).status_code == 400
    status = client.get("/api/books/demo/status").json()
    chapters = status["volumes"][0]["chapters"]
    assert chapters[1]["endImage"] == 5 and chapters[0]["rawComplete"]


def test_cover_upload_and_color(client, services):
    image = io.BytesIO()
    Image.new("RGB", (40, 60), "red").save(image, "PNG")
    response = client.post(
        "/api/books/demo/cover", files={"file": ("c.png", image.getvalue(), "image/png")}
    )
    assert response.json()["cover"] == "cover.webp"
    assert (services.repo.book_dir("demo") / "assets" / "cover.webp").is_file()
    assert (services.settings.root / "public" / "books" / "demo" / "cover.webp").is_file()
    patched = client.patch("/api/books/demo", json={"coverColor": "#2f6f5e", "removeCover": True})
    assert patched.json()["coverColor"] == "#2f6f5e" and patched.json()["cover"] is None
    assert client.patch("/api/books/demo", json={"coverColor": "red"}).status_code == 422


def test_unused_fake_is_importable():
    assert FakeOcrProvider().info.id == "agy"


def test_bad_ids_and_volume_numbers_are_refused(client):
    upload(client)
    traversal = {"provider": "agy", "model": "../../../../book"}
    assert (
        client.post("/api/books/demo/volumes/2/pages/1/accept", json=traversal).status_code == 422
    )
    body = {"chapters": [{"n": 1, "startImage": 1}]}
    assert client.put("/api/books/demo/volumes/0/chapters", json=body).status_code == 422
    assert client.get("/api/books/demo/volumes/1000/pages").status_code == 422
    assert client.get("/api/books/demo/status").status_code == 200  # book.json untouched


def test_second_job_on_a_running_volume_is_refused(client, fake_provider):
    fake_provider.delay = 0.5
    upload(client)
    first = start(client, count=2, parallel=1).json()["job"]
    again = client.post(
        "/api/ocr/jobs",
        json={"book": "demo", "volume": 2, "from": 3, "count": 1, "parallel": 1, "models": [MODEL]},
    )
    assert again.status_code == 409
    client.post(f"/api/jobs/{first['id']}/cancel", json={})


def test_resume_keeps_earlier_item_details(client, services, fake_provider):
    fake_provider.answers = {1: {"text": "", "bookPage": 1, "uncertain": [], "isCover": False}}
    upload(client)
    job = start(client, count=2).json()["job"]
    wait_for(client, job["id"])
    client.post(f"/api/jobs/{job['id']}/resume", json={})
    resumed = wait_for(client, job["id"])
    assert resumed["items"]["1"]["detail"] == "review"


def test_keep_raw_clears_the_queue_entry(client, services):
    v1 = services.workdir.pages_dir("demo", 1)
    v1.mkdir(parents=True)
    (v1 / "001.webp").write_bytes(b"x")
    wait_for(client, start(client, volume=1, count=1).json()["job"]["id"])
    assert [q["image"] for q in client.get("/api/books/demo/volumes/1/ocr/queue").json()] == [1]
    body = {"provider": "agy", "model": "gemini-3.8-flash"}
    assert (
        client.post("/api/books/demo/volumes/1/pages/1/keep-raw", json=body).json()["state"]
        == "kept"
    )
    assert client.get("/api/books/demo/volumes/1/ocr/queue").json() == []


def test_status_counts_pdf_pages_before_rendering(client):
    upload(client, pages=8)
    status = client.get("/api/books/demo/status").json()
    v2 = next(v for v in status["volumes"] if v["n"] == 2)
    assert v2["pages"] == 8 and v2["hasSource"]


def test_a_pdf_page_becomes_the_cover(client, services):
    upload(client)
    card = client.post("/api/books/demo/cover/from-page", json={"volume": 2, "image": 1}).json()
    assert card["cover"] == "cover.webp"
    assert (services.settings.library_dir / "demo" / "assets" / "cover.webp").is_file()
    missing = client.post("/api/books/demo/cover/from-page", json={"volume": 3, "image": 1})
    assert missing.status_code == 404
