"""CLI providers: what each offers and whether it is installed."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ...core.services import Services, services
from ...infrastructure.llm import StructuredCall

router = APIRouter(prefix="/api/providers", tags=["providers"])

PROBE_SCHEMA = {
    "type": "object",
    "properties": {"ok": {"type": "boolean"}},
    "required": ["ok"],
}


class ModelOut(BaseModel):
    value: str
    label: str
    efforts: list[str]


class ProviderStatusOut(BaseModel):
    available: bool
    installed: bool
    detail: str
    version: str | None


class ProviderOut(BaseModel):
    id: str
    label: str
    description: str
    models: list[ModelOut]
    tasks: list[str]
    vision: list[str]
    installHint: str
    status: ProviderStatusOut


class ProbeIn(BaseModel):
    model: str
    effort: str


class ProbeOut(BaseModel):
    ok: bool
    errorKind: str | None
    detail: str
    durationMs: int


@router.get("", response_model=list[ProviderOut])
async def list_providers(
    refresh: bool = False, s: Services = Depends(services)
) -> list[ProviderOut]:
    """Every provider with its install status (a `--version` call; spends nothing)."""

    return [
        ProviderOut(
            id=info.id,
            label=info.label,
            description=info.description,
            models=[
                ModelOut(value=m.value, label=m.label, efforts=list(m.efforts)) for m in info.models
            ],
            tasks=sorted(info.capabilities.tasks),
            vision=sorted(info.capabilities.vision),
            installHint=info.install_hint,
            status=ProviderStatusOut(
                available=status.available,
                installed=status.installed,
                detail=status.detail,
                version=status.version,
            ),
        )
        for info, status in await s.gateway.statuses(refresh=refresh)
    ]


@router.post("/{provider_id}/probe", response_model=ProbeOut)
async def probe(provider_id: str, body: ProbeIn, s: Services = Depends(services)) -> ProbeOut:
    """One tiny real call, only when the user picks a model, to see if the account may use it."""

    info = s.gateway.require(provider_id).info
    await s.gateway.require_available(provider_id)
    task = sorted(info.capabilities.tasks - {"ask"})[0]
    result = await s.gateway.call(
        provider_id,
        StructuredCall(
            prompt='Reply with the JSON {"ok": true} and nothing else.',
            schema=PROBE_SCHEMA,
            model=body.model,
            effort=body.effort,  # type: ignore[arg-type]
            timeout_s=120,
            task=task,  # type: ignore[arg-type]
        ),
    )
    return ProbeOut(
        ok=not result.failed,
        errorKind=result.error_kind,
        detail=result.error_detail[:500],
        durationMs=result.duration_ms,
    )
