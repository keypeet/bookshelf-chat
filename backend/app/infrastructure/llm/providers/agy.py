"""Gemini models through the Antigravity (agy) CLI.

The prompt goes in as one stream-json message on stdin (argv would cap it near
32k characters on Windows). Base model + --effort; ids with a level suffix
cannot be combined with --effort.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from ..cli import CliProvider, ProcessOutcome, Scratch
from ..models import Capabilities, ModelOption, ProviderInfo, StructuredCall, StructuredResult
from ..parse import first_json_object

INFO = ProviderInfo(
    id="agy",
    label="Antigravity",
    description="Gemini models through the Antigravity CLI. Default for OCR.",
    models=(ModelOption("gemini-3.8-flash", "Gemini 3.8 Flash", ("low", "medium", "high")),),
    capabilities=Capabilities(
        # Phase 3 spike: converting 4 pages at effort low returned broken, self-repeating JSON,
        # so only OCR is offered until scan/convert/summarize are proven.
        tasks=frozenset({"ocr"}),
        vision=frozenset({"ocr"}),
    ),
    install_hint="Install the Antigravity CLI so `agy` is on PATH, or set STUDIO_AGY_BINARY.",
)

# Headless agy auto-denies tools it would need permission for and then answers empty.
TOOL_INSTRUCTION = (
    "Do not run commands or edit files. The only tool you may use is reading the image files "
    "named below. Return only the JSON the instructions describe."
)


class AgyProvider(CliProvider):
    info = INFO
    binary_name = "agy"

    def build_command(
        self, request: StructuredCall, scratch: Scratch, images: Sequence[Path]
    ) -> list[str]:
        schema_path = scratch.write("schema.json", json.dumps(dict(request.schema)))
        argv = [
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--json-schema",
            str(schema_path),
            "--model",
            request.model,
            "--effort",
            request.effort,
            "--print-timeout",
            f"{max(1, int(request.timeout_s))}s",
        ]
        if images:
            argv += ["--add-dir", str(scratch.root)]
        return argv

    def stdin_payload(self, request: StructuredCall, images: Sequence[Path]) -> bytes:
        message = {
            "event": "user",
            "message": {"content": f"{TOOL_INSTRUCTION}\n\n{request.prompt}"},
        }
        return (json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8")

    def decode(self, outcome: ProcessOutcome, request: StructuredCall) -> StructuredResult:
        text = outcome.stdout_text()
        if not text:
            return StructuredResult(error_kind="no_output", error_detail=outcome.stderr_tail())
        envelope = _result_event(text)
        if envelope is None:
            return StructuredResult(error_kind="not_json", error_detail=outcome.stderr_tail())
        usage = envelope.get("usage") if isinstance(envelope.get("usage"), dict) else {}
        if envelope.get("status") != "SUCCESS":
            detail = envelope.get("error") or outcome.stderr_tail() or "no detail given."
            return StructuredResult(
                usage=usage, error_kind="reported_error", error_detail=str(detail)
            )
        # The text answer comes first: the schema-bound `structured_output` can be a hollow
        # skeleton ({"pages":[{"blocks":[{"type":"narration"}]}]}) while the answer is complete.
        structured = envelope.get("structured_output")
        response = envelope.get("response") if isinstance(envelope.get("response"), str) else ""
        payload = first_json_object(response)
        if payload is None and isinstance(structured, dict) and structured:
            payload = structured
        if payload is None:
            denied = envelope.get("denied_actions")
            detail = f"denied: {denied}" if denied else outcome.stderr_tail()
            kind = "empty_result" if not response.strip() else "not_json"
            return StructuredResult(usage=usage, error_kind=kind, error_detail=detail)
        return StructuredResult(payload=payload, raw_text=response, usage=usage)


def _result_event(text: str) -> dict[str, Any] | None:
    """The `result` payload of the stream (or the whole object when it is not a stream)."""

    found: dict[str, Any] | None = None
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        if event.get("event") == "result" and isinstance(event.get("result"), dict):
            found = event["result"]
        elif "event" not in event and "status" in event:
            found = event
    return found
