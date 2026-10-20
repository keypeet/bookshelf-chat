"""Claude models through the Claude Code CLI.

Not offered for OCR: in phase 0 it refused to transcribe whole pages. It runs
in a scratch folder outside the repo so it does not load this project's
instructions into context.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

from ..cli import CliProvider, ProcessOutcome, Scratch
from ..models import Capabilities, ModelOption, ProviderInfo, StructuredCall, StructuredResult
from ..parse import first_json_object

_EFFORTS = ("low", "medium", "high", "xhigh", "max")

INFO = ProviderInfo(
    id="claude",
    label="Claude Code",
    description="Claude models through the Claude Code CLI. For conversion and summaries, not OCR.",
    models=(
        ModelOption("sonnet", "Sonnet", _EFFORTS),
        ModelOption("opus", "Opus", _EFFORTS),
        ModelOption("haiku", "Haiku", _EFFORTS),
    ),
    capabilities=Capabilities(
        tasks=frozenset({"scan", "convert", "summarize", "ask"}),
        vision=frozenset(),
    ),
    install_hint="Install Claude Code so `claude` is on PATH, or set STUDIO_CLAUDE_BINARY.",
)


class ClaudeProvider(CliProvider):
    info = INFO
    binary_name = "claude"

    def build_command(
        self, request: StructuredCall, scratch: Scratch, images: Sequence[Path]
    ) -> list[str]:
        argv = [
            "-p",
            "--output-format",
            "json",
            "--json-schema",
            json.dumps(dict(request.schema)),
            "--model",
            request.model,
            # The CLI only warns about an unknown level, so the allowlist upstream guards it.
            "--effort",
            request.effort,
            "--strict-mcp-config",
            "--no-session-persistence",
        ]
        if images:
            argv += ["--add-dir", str(scratch.root), "--allowedTools", "Read"]
        else:
            # An empty --tools list also removes the structured-output tool.
            argv += ["--tools", "TodoWrite"]
        return argv

    def stdin_payload(self, request: StructuredCall, images: Sequence[Path]) -> bytes:
        return request.prompt.encode("utf-8")

    def decode(self, outcome: ProcessOutcome, request: StructuredCall) -> StructuredResult:
        text = outcome.stdout_text()
        if not text:
            return StructuredResult(error_kind="no_output", error_detail=outcome.stderr_tail())
        envelope = first_json_object(text)
        if envelope is None:
            return StructuredResult(error_kind="not_json", error_detail=outcome.stderr_tail())
        usage = envelope.get("usage") if isinstance(envelope.get("usage"), dict) else {}
        common = {"usage": usage, "cost_usd": _cost(envelope.get("total_cost_usd"))}
        result = envelope.get("result") if isinstance(envelope.get("result"), str) else ""
        if envelope.get("is_error"):
            return StructuredResult(
                **common, error_kind="reported_error", error_detail=result or "no detail given."
            )
        structured = envelope.get("structured_output")
        payload = structured if isinstance(structured, dict) and structured else None
        if payload is None:
            payload = first_json_object(result)
        if payload is None:
            kind = "empty_result" if not result.strip() else "not_json"
            return StructuredResult(**common, error_kind=kind, error_detail=result[:500])
        return StructuredResult(**common, payload=payload, raw_text=result)


def _cost(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or value < 0:
        return None
    return float(value)
