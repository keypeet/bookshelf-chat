"""Find the real program behind a CLI name.

On Windows, npm installs `.cmd` shims. Starting one goes through cmd.exe,
whose argument parsing is unsafe for untrusted text, and killing the shim
leaves its child running. So a shim is read once at startup and replaced by
the program it launches: a native `.exe`, or `node <script.js>`.
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path

_SHIM_TARGET = re.compile(r'"%dp0%\\([^"]+\.(?:exe|js|cjs|mjs))"', re.I)


def resolve_command(name_or_path: str) -> tuple[str, ...] | None:
    """The argv prefix that runs the CLI, or None when it is not installed."""

    found = shutil.which(name_or_path)
    if found is None:
        return None
    path = Path(found)
    if os.name != "nt" or path.suffix.lower() not in (".cmd", ".bat"):
        return (str(path),)
    return _from_shim(path)


def _from_shim(shim: Path) -> tuple[str, ...] | None:
    targets = _SHIM_TARGET.findall(shim.read_text(encoding="utf-8", errors="replace"))
    if not targets:
        return None
    target = (shim.parent / targets[-1]).resolve()
    if not target.is_file():
        return None
    if target.suffix.lower() == ".exe":
        return (str(target),)
    node = shim.parent / "node.exe"
    node_path = str(node) if node.is_file() else shutil.which("node")
    if node_path is None:
        return None
    return (node_path, str(target))
