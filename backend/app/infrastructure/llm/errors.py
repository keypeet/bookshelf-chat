"""Errors raised before a call is made."""

from __future__ import annotations


class LlmError(Exception):
    """A provider problem with a message fit to show a user."""

    def __init__(self, provider_id: str, message: str) -> None:
        super().__init__(message)
        self.provider_id = provider_id
        self.message = message


class UnknownProvider(LlmError):
    def __init__(self, provider_id: str) -> None:
        super().__init__(provider_id, f"Unknown provider: {provider_id}.")


class InvalidChoice(LlmError):
    """A model, effort or task the provider does not offer. Checked before any argv is built."""


class ProviderUnavailable(LlmError):
    def __init__(self, provider_id: str, label: str, *, installed: bool, detail: str) -> None:
        message = (
            f"{label} can't be used on this machine. {detail}"
            if installed
            else f"{label} isn't installed on this machine."
        )
        super().__init__(provider_id, message)
