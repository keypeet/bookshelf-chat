"""One structured LLM call for a text task (scan, convert, summarize), recorded the same way.

Every record keeps the assembled prompt, the template hash and the context summary
ids, so a result can always be traced back to what was sent.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from ...infrastructure.llm import LlmGateway, StructuredCall, Task
from ..prompts.templates import Prompt


@dataclass(frozen=True, slots=True)
class ModelChoice:
    provider: str
    model: str
    effort: str

    def as_dict(self) -> dict[str, str]:
        return {"provider": self.provider, "model": self.model, "effort": self.effort}


def stamp() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


async def call_task(
    gateway: LlmGateway,
    choice: ModelChoice,
    prompt: Prompt,
    schema: dict[str, Any],
    task: Task,
    timeout_s: float,
    context_ids: list[str] | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """The payload (None on failure) and a record of the call to store beside the result."""

    result = await gateway.call(
        choice.provider,
        StructuredCall(
            prompt=prompt.text,
            schema=schema,
            model=choice.model,
            effort=choice.effort,  # type: ignore[arg-type]
            timeout_s=timeout_s,
            task=task,
        ),
    )
    payload = result.payload if not result.failed and isinstance(result.payload, dict) else None
    record: dict[str, Any] = {
        **choice.as_dict(),
        "status": "ok" if payload is not None else "failed",
        "errorKind": result.error_kind or (None if payload is not None else "bad_payload"),
        "detail": result.error_detail[:2000],
        "durationMs": result.duration_ms,
        "costUsd": result.cost_usd,
        "templateHash": prompt.template_hash,
        "contextIds": context_ids or [],
        "prompt": prompt.text,
        "createdAt": stamp(),
    }
    return payload, record


def nullable(kind: str) -> dict[str, Any]:
    """An optional field in a schema every CLI accepts: listed as required, null allowed.

    codex's strict output requires every property; grok drops optional ones.
    """

    return {"type": [kind, "null"]}
