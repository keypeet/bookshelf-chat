"""Each provider against golden recordings of its CLI. No real CLI runs here."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from app.infrastructure.llm import StructuredCall
from app.infrastructure.llm.providers.agy import AgyProvider
from app.infrastructure.llm.providers.claude import ClaudeProvider
from app.infrastructure.llm.providers.codex import CodexProvider
from app.infrastructure.llm.providers.grok import GrokProvider

from .conftest import RecordingTransport, golden

SCHEMA = {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}


def make(cls, recording: str, tmp_path: Path):
    transport = RecordingTransport(golden(recording))
    provider = cls(transport)
    provider._command, provider._resolved = (str(tmp_path / f"{cls.binary_name}.exe"),), True
    return provider, transport


def request(
    task: str = "ocr", images: tuple[Path, ...] = (), effort: str = "low", model: str = "m"
):
    return StructuredCall(
        prompt="ถอดภาพ: {{image}}",
        schema=SCHEMA,
        model=model,
        effort=effort,  # type: ignore[arg-type]
        timeout_s=30,
        task=task,  # type: ignore[arg-type]
        images=images,
    )


@pytest.fixture
def page(tmp_path: Path) -> Path:
    path = tmp_path / "012.webp"
    path.write_bytes(b"RIFF0000WEBP")
    return path


def run(provider, req):
    return asyncio.run(provider.call(req))


def test_agy_reads_the_text_answer_over_a_hollow_structured_output(tmp_path, page):
    provider, transport = make(AgyProvider, "agy_ok", tmp_path)
    result = run(provider, request(images=(page,), model="gemini-3.8-flash"))
    assert not result.failed
    assert result.payload["bookPage"] == 12 and result.payload["text"].startswith("บรรทัดแรก")
    call = transport.calls[0]
    argv = call["argv"]
    assert argv[argv.index("--input-format") + 1] == "stream-json"
    assert argv[argv.index("--effort") + 1] == "low"
    assert "--add-dir" in argv and not any(a == "-p" or a.startswith("--print=") for a in argv)
    message = json.loads(call["stdin"].decode("utf-8"))
    assert message["event"] == "user"
    assert "page-001.webp" in message["message"]["content"]  # {{image}} became the copied path
    assert "page-001.webp" in call["files"]


def test_agy_empty_answer_with_denied_tool_is_a_failure(tmp_path):
    provider, _ = make(AgyProvider, "agy_empty_denied", tmp_path)
    result = run(provider, request())
    assert result.error_kind == "empty_result"
    assert "RunCommand" in result.error_detail


def test_agy_reported_error(tmp_path):
    provider, _ = make(AgyProvider, "agy_error", tmp_path)
    result = run(provider, request())
    assert result.error_kind == "reported_error"
    assert "invalid model" in result.error_detail


def test_codex_puts_images_before_json_and_reads_the_last_message(tmp_path, page):
    provider, transport = make(CodexProvider, "codex_ok", tmp_path)
    result = run(provider, request(images=(page,)))
    assert result.payload["bookPage"] == 12
    argv = transport.calls[0]["argv"]
    assert argv.index("-i") < argv.index("--json") and argv[-1] == "-"
    assert "model_reasoning_effort=low" in argv


def test_codex_usage_limit_is_its_own_state(tmp_path):
    provider, _ = make(CodexProvider, "codex_usage_limit", tmp_path)
    result = run(provider, request())
    assert result.error_kind == "usage_limit"


def test_claude_prefers_structured_output_and_keeps_cost(tmp_path):
    provider, transport = make(ClaudeProvider, "claude_ok", tmp_path)
    result = run(provider, request(task="convert", effort="high"))
    assert result.payload["bookPage"] == 12
    assert result.cost_usd == pytest.approx(0.0123)
    argv = transport.calls[0]["argv"]
    assert argv[argv.index("--effort") + 1] == "high"
    assert transport.calls[0]["stdin"].decode("utf-8").startswith("ถอดภาพ")


def test_claude_error_envelope(tmp_path):
    provider, _ = make(ClaudeProvider, "claude_error", tmp_path)
    assert run(provider, request(task="convert")).error_kind == "reported_error"


def test_grok_strips_prose_before_the_json_and_always_sends_a_schema(tmp_path, page):
    provider, transport = make(GrokProvider, "grok_ok_prose", tmp_path)
    result = run(provider, request(images=(page,)))
    assert result.payload["bookPage"] == 12
    argv = transport.calls[0]["argv"]
    assert "--json-schema" in argv and "--prompt-file" in argv
    assert argv[argv.index("--allow") + 1] == "Read"
    assert "prompt.txt" in transport.calls[0]["files"]


def test_grok_takes_the_real_answer_after_an_empty_placeholder(tmp_path, page):
    # recorded shape from a real OCR call (2026-10-18): an empty object first, the answer second
    provider, _ = make(GrokProvider, "grok_ok_placeholder_first", tmp_path)
    result = run(provider, request(images=(page,)))
    assert result.payload["text"] == "บรรทัดจริงของหน้า" and result.payload["bookPage"] == 40


def test_grok_reported_error(tmp_path):
    provider, _ = make(GrokProvider, "grok_error", tmp_path)
    result = run(provider, request())
    assert result.error_kind == "reported_error"
    assert "unknown effort" in result.error_detail


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ('{"text":"","n":null}{"text":"real","n":1}', "real"),
        ('{"text":"real","n":1}{"text":"","n":null}', "real"),  # placeholder after the answer
        ('{"text":"real","n":1} trailing prose {} {"note": "x"}', "real"),
        ('{"text":"","n":null}', ""),  # a genuinely empty page is still an answer
        ('{"text":"x","n":1,"blocks":[{"text":"cut"}', None),  # cut off: the fragment lacks "n"
    ],
)
def test_answer_object_picks_the_real_answer(text, expected):
    from app.infrastructure.llm.parse import answer_object

    found = answer_object(text, ["text", "n"])
    assert (found or {}).get("text", None) == expected if expected is not None else found is None
