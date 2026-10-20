"""The single entry point tasks use to reach a provider."""

from __future__ import annotations

import asyncio
import dataclasses
import logging
import time
from collections.abc import Callable, Iterable
from typing import Protocol, runtime_checkable

from ...core.process_gate import ProcessGate
from .cli import ARG_PATTERN, CliTransport
from .errors import InvalidChoice, ProviderUnavailable, UnknownProvider
from .models import ProviderInfo, ProviderStatus, StructuredCall, StructuredResult, Task
from .providers.agy import AgyProvider
from .providers.claude import ClaudeProvider
from .providers.codex import CodexProvider
from .providers.grok import GrokProvider

logger = logging.getLogger("bookshelf.llm")

STATUS_TTL_S = 60.0


@runtime_checkable
class Provider(Protocol):
    info: ProviderInfo

    async def status(self) -> ProviderStatus:
        """Report whether the provider can take calls, without spending anything."""
        ...

    async def call(self, request: StructuredCall) -> StructuredResult:
        """Run one call. Failures are returned in the result, never raised."""
        ...


def validate_choice(info: ProviderInfo, model: str, effort: str, task: Task) -> None:
    """Refuse anything the provider does not list, before an argv is built from it."""

    if task not in info.capabilities.tasks:
        raise InvalidChoice(info.id, f"{info.label} is not offered for {task}.")
    if not ARG_PATTERN.fullmatch(model) or not ARG_PATTERN.fullmatch(effort):
        raise InvalidChoice(info.id, "Model and effort ids may only use a-z, 0-9, '.' and '-'.")
    option = info.model(model)
    if option is None:
        raise InvalidChoice(info.id, f"{info.label} does not offer the model {model!r}.")
    if effort not in option.efforts:
        raise InvalidChoice(info.id, f"{option.label} does not accept the effort {effort!r}.")


class LlmGateway:
    """Provider lookup, choice validation, status caching and call logging.

    There is no fallback: a call names its provider, and an unknown or
    unavailable one is an error.
    """

    def __init__(
        self,
        providers: Iterable[Provider],
        *,
        status_ttl_s: float = STATUS_TTL_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._providers: dict[str, Provider] = {}
        for provider in providers:
            if provider.info.id in self._providers:
                raise ValueError(f"Duplicate provider id: {provider.info.id!r}.")
            self._providers[provider.info.id] = provider
        self._status_ttl_s = status_ttl_s
        self._clock = clock
        self._statuses: dict[str, tuple[float, ProviderStatus]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def require(self, provider_id: str) -> Provider:
        provider = self._providers.get(provider_id)
        if provider is None:
            raise UnknownProvider(provider_id)
        return provider

    def catalog(self) -> tuple[ProviderInfo, ...]:
        return tuple(provider.info for provider in self._providers.values())

    async def status(self, provider_id: str, *, refresh: bool = False) -> ProviderStatus:
        provider = self.require(provider_id)
        lock = self._locks.setdefault(provider_id, asyncio.Lock())
        async with lock:
            cached = self._statuses.get(provider_id)
            if (
                not refresh
                and cached is not None
                and self._clock() - cached[0] < self._status_ttl_s
            ):
                return cached[1]
            status = await provider.status()
            self._statuses[provider_id] = (self._clock(), status)
            return status

    async def statuses(self, *, refresh: bool = False) -> list[tuple[ProviderInfo, ProviderStatus]]:
        providers = list(self._providers.values())
        found = await asyncio.gather(
            *(self.status(provider.info.id, refresh=refresh) for provider in providers)
        )
        return [(p.info, status) for p, status in zip(providers, found, strict=True)]

    async def require_available(self, provider_id: str) -> ProviderInfo:
        status = await self.status(provider_id)
        info = self.require(provider_id).info
        if not status.available:
            raise ProviderUnavailable(
                provider_id, info.label, installed=status.installed, detail=status.detail
            )
        return info

    def check(self, provider_id: str, model: str, effort: str, task: Task) -> ProviderInfo:
        info = self.require(provider_id).info
        validate_choice(info, model, effort, task)
        return info

    async def call(self, provider_id: str, request: StructuredCall) -> StructuredResult:
        info = self.check(provider_id, request.model, request.effort, request.task)
        if request.images and request.task not in info.capabilities.vision:
            raise InvalidChoice(provider_id, f"{info.label} cannot read images for {request.task}.")
        result = await self.require(provider_id).call(dataclasses.replace(request))
        logger.info(
            "llm call provider=%s task=%s model=%s effort=%s duration_ms=%d launched=%s "
            "error_kind=%s cost_usd=%s",
            provider_id,
            request.task,
            request.model,
            request.effort,
            result.duration_ms,
            result.launched,
            result.error_kind,
            result.cost_usd,
        )
        return result


def build_gateway(gate: ProcessGate, binaries: dict[str, str] | None = None) -> LlmGateway:
    transport = CliTransport(gate)
    binaries = binaries or {}
    return LlmGateway(
        [
            cls(transport, binaries.get(cls.info.id))
            for cls in (AgyProvider, ClaudeProvider, CodexProvider, GrokProvider)
        ]
    )
