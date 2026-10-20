"""Read a JSON answer out of CLI text that may carry prose around it."""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from typing import Any

_USAGE_LIMIT = re.compile(
    r"usage limit|rate limit|quota (?:exceeded|exhausted)|hit your limit|out of credits", re.I
)


def first_json_object(text: str) -> dict[str, Any] | None:
    """The first ``{...}`` in the text that parses as a JSON object.

    CLIs sometimes put a sentence before the JSON or wrap it in a code fence,
    so stdout is never trusted to be pure JSON.
    """

    decoder = json.JSONDecoder()
    start = text.find("{")
    while start != -1:
        try:
            value, _ = decoder.raw_decode(text, start)
        except json.JSONDecodeError:
            start = text.find("{", start + 1)
            continue
        if isinstance(value, dict):
            return value
        start = text.find("{", start + 1)
    return None


def answer_object(text: str, required: Sequence[str]) -> dict[str, Any] | None:
    """The answer among several JSON objects in one reply.

    grok with --json-schema sometimes writes an empty placeholder object next to the
    real answer (`{"text":"",...}{"text":"..."}`). Objects are read top level only;
    one that lacks a required key (a fragment of a cut-off answer, `{}` in prose) is
    ignored. Of the rest, the last one with any non-empty value wins, else the last.
    """

    decoder = json.JSONDecoder()
    found: list[dict[str, Any]] = []
    start = text.find("{")
    while start != -1:
        try:
            value, end = decoder.raw_decode(text, start)
        except json.JSONDecodeError:
            start = text.find("{", start + 1)
            continue
        if isinstance(value, dict) and all(key in value for key in required):
            found.append(value)
        start = text.find("{", end)
    filled = [value for value in found if any(value.values())]
    return (filled or found or [None])[-1]


def is_usage_limit(text: str) -> bool:
    return bool(_USAGE_LIMIT.search(text))
