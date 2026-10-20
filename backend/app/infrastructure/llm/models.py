"""Value types shared by every provider."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

# `ask` is reserved for the book assistant plan; no provider gate slot is held for it yet.
Task = Literal["ocr", "scan", "convert", "summarize", "ask"]
TASKS: tuple[Task, ...] = ("ocr", "scan", "convert", "summarize", "ask")
Effort = Literal["low", "medium", "high", "xhigh", "max"]

# Why a call produced no payload.
ErrorKind = Literal[
    "not_found",  # the executable does not exist
    "launch_failed",  # it exists but could not be started
    "timeout",
    "cancelled",
    "output_too_large",
    "no_output",
    "not_json",  # no JSON object anywhere in the answer
    "reported_error",  # the CLI answered with an error
    "usage_limit",  # the account hit its quota; retrying now will not help
    "exit_status",  # the process failed without saying why
    "empty_result",  # a well-formed answer with nothing in it
]


@dataclass(frozen=True, slots=True)
class Capabilities:
    """What a provider can do, so callers never branch on its id."""

    tasks: frozenset[Task]  # tasks the provider is offered for
    vision: frozenset[Task]  # tasks where it can read attached images


@dataclass(frozen=True, slots=True)
class ModelOption:
    value: str
    label: str
    efforts: tuple[Effort, ...]  # reasoning levels this model accepts; first is the default


@dataclass(frozen=True, slots=True)
class ProviderInfo:
    id: str
    label: str
    description: str
    models: tuple[ModelOption, ...]  # the first one is recommended
    capabilities: Capabilities
    install_hint: str

    @property
    def recommended_model(self) -> str:
        return self.models[0].value

    def model(self, value: str) -> ModelOption | None:
        return next((m for m in self.models if m.value == value), None)


@dataclass(frozen=True, slots=True)
class ProviderStatus:
    available: bool
    detail: str
    checked_at: datetime
    installed: bool = True
    version: str | None = None
    command: tuple[str, ...] = ()  # the resolved real binary (never a .cmd shim)


@dataclass(frozen=True, slots=True)
class StructuredCall:
    """One request for a JSON payload of a given schema."""

    prompt: str
    schema: Mapping[str, Any]
    model: str
    effort: Effort
    timeout_s: float
    task: Task
    images: tuple[Path, ...] = ()  # page images the CLI may read; copied into its scratch area


@dataclass(frozen=True, slots=True)
class StructuredResult:
    """What one call returned. Adapters report failures here and never raise."""

    launched: bool = True  # False only when nothing started, so nothing was spent
    duration_ms: int = 0
    payload: dict[str, Any] | None = None  # parsed, not yet validated by the task
    raw_text: str = ""
    error_kind: ErrorKind | None = None
    error_detail: str = ""
    cost_usd: float | None = None  # None when unknown, never an invented 0.0
    usage: dict[str, Any] = field(default_factory=dict)

    @property
    def failed(self) -> bool:
        return self.error_kind is not None
