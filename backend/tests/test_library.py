from __future__ import annotations

import json
import threading

import pytest

from app.core.config import Settings, resolve_from_root
from app.core.workdir import Workdir
from app.modules.library.repository import (
    Conflict,
    LibraryError,
    LibraryRepository,
    atomic_write_json,
    parse_raw,
)
from app.modules.library.status import book_status


def test_atomic_write_leaves_no_temp_files_and_replaces(tmp_path):
    target = tmp_path / "a" / "x.json"
    atomic_write_json(target, {"v": 1})
    atomic_write_json(target, {"v": 2})
    assert json.loads(target.read_text(encoding="utf-8")) == {"v": 2}
    assert [p.name for p in target.parent.iterdir()] == ["x.json"]


def test_atomic_write_retries_permission_error(tmp_path, monkeypatch):
    import os

    calls = {"n": 0}
    real = os.replace

    def flaky(src, dst):
        calls["n"] += 1
        if calls["n"] < 3:
            raise PermissionError("locked")
        real(src, dst)

    monkeypatch.setattr(os, "replace", flaky)
    atomic_write_json(tmp_path / "y.json", [1])
    assert calls["n"] == 3


def test_book_lock_serializes_writers(library):
    repo = LibraryRepository(library)

    def bump(i: int) -> None:
        repo.update_book("demo", {f"k{i}": i})

    threads = [threading.Thread(target=bump, args=(i,)) for i in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    card = repo.book("demo")
    assert all(card[f"k{i}"] == i for i in range(20))  # no lost update


def test_raw_is_never_overwritten(library):
    repo = LibraryRepository(library)
    with pytest.raises(Conflict):
        repo.write_raw("demo", 1, 1, 1, "x", "ใหม่")
    path = repo.write_raw("demo", 1, 9, None, "workdir/demo/v1/pages/009.webp", "ข้อความ")
    headers, body = parse_raw(path.read_text(encoding="utf-8"))
    assert headers == {"image": "009", "book-page": "?", "source": "workdir/demo/v1/pages/009.webp"}
    assert body == "ข้อความ"


def test_publish_writes_chapter_before_index(library, monkeypatch):
    repo = LibraryRepository(library)
    order = []
    import app.modules.library.repository as module

    real = module.atomic_write_json
    monkeypatch.setattr(
        module, "atomic_write_json", lambda p, v: (order.append(p.name), real(p, v))
    )
    chapter = {
        "id": "v1-c3",
        "volume": 1,
        "volumeTitle": "เล่มแรก",
        "chapter": 3,
        "title": "t",
        "sourcePages": [3],
        "blocks": [],
    }
    repo.publish_chapter("demo", chapter)
    assert order == ["v1-c3.json", "index.json"]
    assert [e["id"] for e in repo.index("demo")["chapters"]] == ["v1-c1", "v1-c2", "v1-c3"]
    assert "sourcePages" not in repo.index("demo")["chapters"][-1]


def test_bad_slugs_are_refused(library):
    repo = LibraryRepository(library)
    for slug in ("../etc", "A", "", "a/b", "a" * 80):
        with pytest.raises(LibraryError):
            repo.book(slug)


def test_status_comes_from_files(library, tmp_path):
    repo = LibraryRepository(library)
    workdir = Workdir(tmp_path / "workdir")
    pages = workdir.pages_dir("demo", 1)
    pages.mkdir(parents=True)
    for n in range(1, 6):
        (pages / f"{n:03d}.webp").write_bytes(b"x")
    repo.set_volume(
        "demo", {"n": 1, "chapters": [{"n": 1, "startImage": 1}, {"n": 2, "startImage": 4}]}
    )
    volume = book_status(repo, workdir, "demo")["volumes"][0]
    assert volume | {"chapters": None} == {
        "n": 1,
        "title": "เล่มแรก",
        "closed": False,
        "hasSource": False,
        "pages": 5,
        "ocrPages": 3,
        "chatPages": 2,
        "publishedPages": 2,
        "publishedChapters": 2,
        "drafts": 0,
        "imported": False,
        "summarized": False,
        "chapters": None,
    }
    first, second = volume["chapters"]
    assert first["rawComplete"] and first["published"] and first["endImage"] == 3
    assert not second["rawComplete"] and second["endImage"] is None  # volume still open


def test_paths_resolve_from_the_repo_root_not_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    root = tmp_path / "repo"
    settings = Settings.from_env({"LIBRARY_DIR": "./library.example"}, root=root)
    assert settings.library_dir == (root / "library.example").resolve()
    assert resolve_from_root(None, "library", root) == (root / "library").resolve()
