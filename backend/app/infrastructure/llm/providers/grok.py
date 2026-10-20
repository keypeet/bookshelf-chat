"""Grok models through the Grok Build CLI.

--json-schema is mandatory: without it grok is several times slower and puts
prose before the JSON.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

from ..cli import CliProvider, ProcessOutcome, Scratch
from ..models import Capabilities, ModelOption, ProviderInfo, StructuredCall, StructuredResult
from ..parse import answer_object, first_json_object

INFO = ProviderInfo(
    id="grok",
    label="Grok",
    description="xAI models through the Grok Build CLI.",
    models=(ModelOption("grok-4.7", "Grok 4.7", ("low", "medium", "high", "xhigh")),),
    capabilities=Capabilities(
        tasks=frozenset({"ocr", "scan", "convert", "summarize"}),
        vision=frozenset({"ocr"}),
    ),
    install_hint="Install Grok Build so `grok` is on PATH, or set STUDIO_GROK_BINARY.",
)

TOOL_INSTRUCTION = (
    "Do not run commands or edit files. The only tool you may use is reading the image files "
    "named below. Return only the JSON the instructions describe."
)


class GrokProvider(CliProvider):
    info = INFO
    binary_name = "grok"

    def build_command(
        self, request: StructuredCall, scratch: Scratch, images: Sequence[Path]
    ) -> list[str]:
        prompt_path = scratch.write("prompt.txt", f"{TOOL_INSTRUCTION}\n\n{request.prompt}")
        argv = [
            "--prompt-file",
            str(prompt_path),
            "--json-schema",
            json.dumps(dict(request.schema)),
            "-m",
            request.model,
            "--reasoning-effort",
            request.effort,
            "--cwd",
            str(scratch.root),
            "--no-subagents",
            "--disable-web-search",
        ]
        if images:
            argv += ["--allow", "Read"]
        return argv

    def stdin_payload(self, request: StructuredCall, images: Sequence[Path]) -> bytes:
        return b""

    def decode(self, outcome: ProcessOutcome, request: StructuredCall) -> StructuredResult:
        text = outcome.stdout_text()
        if not text:
            return StructuredResult(error_kind="no_output", error_detail=outcome.stderr_tail())
        envelope = first_json_object(text)
        if envelope is None:
            return StructuredResult(error_kind="not_json", error_detail=outcome.stderr_tail())
        if envelope.get("type") == "error" or outcome.returncode not in (None, 0):
            detail = envelope.get("message") or outcome.stderr_tail() or str(outcome.returncode)
            return StructuredResult(error_kind="reported_error", error_detail=str(detail))
        usage = envelope.get("usage") if isinstance(envelope.get("usage"), dict) else {}
        cost = envelope.get("total_cost_usd")
        cost_usd = (
            float(cost) if isinstance(cost, int | float) and not isinstance(cost, bool) else None
        )
        answer = envelope.get("text") if isinstance(envelope.get("text"), str) else ""
        payload = answer_object(answer, request.schema.get("required", ()))
        if payload is None:
            kind = "empty_result" if not answer.strip() else "not_json"
            return StructuredResult(usage=usage, cost_usd=cost_usd, error_kind=kind)
        return StructuredResult(payload=payload, raw_text=answer, usage=usage, cost_usd=cost_usd)
