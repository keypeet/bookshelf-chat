from __future__ import annotations

import pytest

from app.infrastructure.llm import InvalidChoice, validate_choice
from app.infrastructure.llm.binaries import resolve_command
from app.infrastructure.llm.providers.agy import INFO as AGY
from app.infrastructure.llm.providers.claude import INFO as CLAUDE
from app.infrastructure.llm.providers.codex import INFO as CODEX

from .conftest import HEADERS, TOKEN


@pytest.mark.parametrize(
    ("info", "model", "effort", "task"),
    [
        (AGY, "gemini-3.8-flash; rm -rf /", "low", "ocr"),
        (AGY, "gemini-3.8-flash", "--dangerously-skip-permissions", "ocr"),
        (AGY, "gemini-3.8-flash", "xhigh", "ocr"),  # agy offers low/medium/high only
        (AGY, "gemini-3.8-flash", "low", "convert"),  # agy is not offered for convert
        (AGY, "unknown-model", "low", "ocr"),
        (CODEX, "gpt-5.6-terra", "medium", "ocr"),  # only low is proven
        (CLAUDE, "sonnet", "low", "ocr"),  # claude refuses OCR
        (CLAUDE, "Sonnet", "low", "convert"),
    ],
)
def test_choices_outside_the_allowlist_are_refused(info, model, effort, task):
    with pytest.raises(InvalidChoice):
        validate_choice(info, model, effort, task)


def test_allowed_choice_passes():
    validate_choice(AGY, "gemini-3.8-flash", "medium", "ocr")
    validate_choice(CLAUDE, "opus", "max", "summarize")


def test_wrong_host_is_rejected(client):
    response = client.get("/api/books", headers={"host": "evil.example:8000"})
    assert response.status_code == 400


def test_missing_or_wrong_token_is_rejected(client):
    assert client.get("/api/books", headers={"x-studio-token": ""}).status_code == 401
    assert client.get("/api/books", headers={"x-studio-token": "nope"}).status_code == 401


def test_wrong_origin_is_rejected_for_state_changes(client):
    response = client.post(
        "/api/books", json={"slug": "x", "title": "x"}, headers={"origin": "http://evil.example"}
    )
    assert response.status_code == 403


def test_form_posts_are_rejected(client):
    response = client.post(
        "/api/books",
        content="slug=x&title=x",
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 415


def test_allowed_origin_and_json_pass(client):
    response = client.post(
        "/api/books",
        json={"slug": "new-book", "title": "ใหม่"},
        headers={"origin": "http://localhost:3000"},
    )
    assert response.status_code == 201


def test_no_token_configured_disables_the_api(services):
    from dataclasses import replace

    from fastapi.testclient import TestClient

    from app.main import create_app

    services.settings = replace(services.settings, token="")
    with TestClient(create_app(services=services)) as c:
        response = c.get("/api/books", headers={**HEADERS, "x-studio-token": TOKEN})
    assert response.status_code == 503


def test_cmd_shim_resolves_to_the_real_program(tmp_path, monkeypatch):
    import os

    if os.name != "nt":
        pytest.skip("npm .cmd shims exist only on Windows")
    exe = tmp_path / "node_modules" / "@x" / "tool" / "bin" / "tool.exe"
    exe.parent.mkdir(parents=True)
    exe.write_bytes(b"MZ")
    shim = tmp_path / "tool.cmd"
    shim.write_text('@ECHO off\r\n"%dp0%\\node_modules\\@x\\tool\\bin\\tool.exe"   %*\r\n')
    monkeypatch.setenv("PATH", str(tmp_path))
    assert resolve_command("tool") == (str(exe.resolve()),)

    script = tmp_path / "node_modules" / "@y" / "cli" / "bin" / "cli.js"
    script.parent.mkdir(parents=True)
    script.write_text("")
    (tmp_path / "node.exe").write_bytes(b"MZ")
    (tmp_path / "cli.cmd").write_text(
        '@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\@y\\cli\\bin\\cli.js" %*\r\n'
    )
    assert resolve_command("cli") == (str(tmp_path / "node.exe"), str(script.resolve()))


def test_non_ascii_token_is_a_401_not_a_crash(client):
    response = client.get("/api/books", headers={"x-studio-token": "é".encode("latin-1")})
    assert response.status_code == 401
