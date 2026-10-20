"""Structured calls to LLM CLIs behind one contract (ported from smc_eval)."""

from .errors import InvalidChoice, LlmError, ProviderUnavailable, UnknownProvider
from .gateway import LlmGateway, Provider, build_gateway, validate_choice
from .models import (
    TASKS,
    Capabilities,
    ErrorKind,
    ModelOption,
    ProviderInfo,
    ProviderStatus,
    StructuredCall,
    StructuredResult,
    Task,
)

__all__ = [
    "TASKS",
    "Capabilities",
    "ErrorKind",
    "InvalidChoice",
    "LlmError",
    "LlmGateway",
    "ModelOption",
    "Provider",
    "ProviderInfo",
    "ProviderStatus",
    "ProviderUnavailable",
    "StructuredCall",
    "StructuredResult",
    "Task",
    "UnknownProvider",
    "build_gateway",
    "validate_choice",
]
