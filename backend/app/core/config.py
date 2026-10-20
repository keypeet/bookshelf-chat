"""Settings for the local Studio backend.

Every path resolves from the repository root, never from the working
directory, so `uv run --directory backend ...` and a run from the root see the
same folders as the Next.js reader (`src/lib/content.ts`).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ENV_FILES = (".env", ".env.local")  # the same files Next.js loads, later wins

DEFAULT_PROCESS_LIMIT = 4
DEFAULT_ALLOWED_HOSTS = ("127.0.0.1", "localhost")
DEFAULT_ALLOWED_ORIGINS = ("http://localhost:3000", "http://127.0.0.1:3000")


def read_env_file(path: Path) -> dict[str, str]:
    """KEY=VALUE lines; blank lines, comments and malformed lines are skipped."""

    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip().removeprefix("export ").strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def load_environment(root: Path = ROOT) -> dict[str, str]:
    """The root env files overlaid by the real environment."""

    merged: dict[str, str] = {}
    for name in ENV_FILES:
        merged.update(read_env_file(root / name))
    merged.update(os.environ)
    return merged


def resolve_from_root(value: str | None, default: str, root: Path = ROOT) -> Path:
    path = Path(value) if value else Path(default)
    return (path if path.is_absolute() else root / path).resolve()


@dataclass(frozen=True, slots=True)
class Settings:
    root: Path
    library_dir: Path
    prompts_dir: Path
    workdir: Path
    token: str  # shared secret the Next.js Studio proxy sends; empty = API refuses calls
    process_limit: int = DEFAULT_PROCESS_LIMIT
    allowed_hosts: tuple[str, ...] = DEFAULT_ALLOWED_HOSTS
    allowed_origins: tuple[str, ...] = DEFAULT_ALLOWED_ORIGINS
    binaries: dict[str, str] = field(default_factory=dict)  # provider id → override
    max_pdf_bytes: int = 600 * 1024 * 1024
    max_pdf_pages: int = 3000
    max_cover_bytes: int = 8 * 1024 * 1024

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None, root: Path = ROOT) -> Settings:
        env = load_environment(root) if env is None else env
        limit = int(env.get("STUDIO_PROCESS_LIMIT") or DEFAULT_PROCESS_LIMIT)
        origins = env.get("STUDIO_ALLOWED_ORIGINS")
        return cls(
            root=root,
            library_dir=resolve_from_root(env.get("LIBRARY_DIR"), "library", root),
            prompts_dir=root / "prompts",
            workdir=resolve_from_root(env.get("WORKDIR"), "workdir", root),
            token=env.get("STUDIO_TOKEN", ""),
            process_limit=max(1, min(limit, 16)),
            allowed_origins=tuple(o.strip() for o in origins.split(",") if o.strip())
            if origins
            else DEFAULT_ALLOWED_ORIGINS,
            binaries={
                provider: env[f"STUDIO_{provider.upper()}_BINARY"]
                for provider in ("claude", "codex", "agy", "grok")
                if env.get(f"STUDIO_{provider.upper()}_BINARY")
            },
        )
