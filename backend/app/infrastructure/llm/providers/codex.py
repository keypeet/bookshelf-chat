"""OpenAI models through the Codex CLI.

Only effort `low` is offered until the other levels are proven (phase 0 ran
out of quota before testing them).
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
    id="codex",
    label="Codex",
    description="OpenAI models through the Codex CLI.",
    models=(ModelOption("gpt-5.6-terra", "GPT-5.6 Terra", ("low",)),),
    capabilities=Capabilities(
        tasks=frozenset({"ocr", "scan", "convert", "summarize"}),
        vision=frozenset({"ocr"}),
    ),
    install_hint="Install the Codex CLI so `codex` is on PATH, or set STUDIO_CODEX_BINARY.",
)

TOOL_INSTRUCTION = (
    "Do not run commands or edit files. Use only the material below and any attached images, "
    "and return only the JSON object the instructions describe."
)


class CodexProvider(CliProvider):
    info = INFO
    binary_name = "codex"

    def build_command(
        self, request: StructuredCall, scratch: Scratch, images: Sequence[Path]
    ) -> list[str]:
        schema_path = scratch.write("schema.json", json.dumps(strict_schema(dict(request.schema))))
        argv = [
            "exec",
            "--model",
            request.model,
            "-c",
            f"model_reasoning_effort={request.effort}",
            "--sandbox",
            "read-only",
            "--ephemeral",
            "--skip-git-repo-check",
            "--output-schema",
            str(schema_path),
        ]
        for image in images:  # -i must come before --json
            argv += ["-i", str(image)]
        return [*argv, "--json", "-"]

    def stdin_payload(self, request: StructuredCall, images: Sequence[Path]) -> bytes:
        return f"{TOOL_INSTRUCTION}\n\n{request.prompt}".encode()

    def decode(self, outcome: ProcessOutcome, request: StructuredCall) -> StructuredResult:
        message, usage, error = _read_events(outcome.stdout_text())
        if error:
            return StructuredResult(usage=usage, error_kind="reported_error", error_detail=error)
        if outcome.returncode not in (None, 0):
            detail = outcome.stderr_tail() or str(outcome.returncode)
            return StructuredResult(usage=usage, error_kind="exit_status", error_detail=detail)
        if not message:
            return StructuredResult(
                usage=usage, error_kind="no_output", error_detail=outcome.stderr_tail()
            )
        payload = first_json_object(message)
        if payload is None:
            return StructuredResult(usage=usage, error_kind="not_json", raw_text=message)
        return StructuredResult(payload=payload, raw_text=message, usage=usage)


def strict_schema(value: Any) -> Any:
    """OpenAI strict output: every property listed as required and no extras."""

    if isinstance(value, list):
        return [strict_schema(item) for item in value]
    if not isinstance(value, dict):
        return value
    normalized = {key: strict_schema(item) for key, item in value.items() if key != "default"}
    properties = normalized.get("properties")
    if isinstance(properties, dict):
        normalized["required"] = list(properties)
        normalized["additionalProperties"] = False
    return normalized


def _read_events(text: str) -> tuple[str, dict[str, Any], str | None]:
    """The last agent message, the final usage and the last reported error of the JSONL stream."""

    message = ""
    usage: dict[str, Any] = {}
    error: str | None = None
    for line in text.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict):
            continue
        kind = event.get("type")
        item = event.get("item")
        if kind == "item.completed" and isinstance(item, dict):
            if item.get("type") == "agent_message":
                message = str(item.get("text") or "")
        elif kind == "turn.completed" and isinstance(event.get("usage"), dict):
            usage = event["usage"]
        elif kind == "error":
            error = str(event.get("message") or "error")
        elif kind == "turn.failed":
            failure = event.get("error")
            if isinstance(failure, dict) and failure.get("message"):
                error = str(failure["message"])
    return message, usage, error
