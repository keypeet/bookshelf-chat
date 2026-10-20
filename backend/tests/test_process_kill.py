"""A real process tree is killed on cancel and on timeout (checked with tasklist on Windows)."""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

from app.core.process_gate import ProcessGate
from app.infrastructure.llm.cli import CliTransport

pytestmark = pytest.mark.skipif(os.name != "nt", reason="tree kill is checked with tasklist")

# The parent writes its child's pid to a file, then both sleep.
PARENT = """
import subprocess, sys, time
child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
open(sys.argv[1], "w").write(str(child.pid))
time.sleep(120)
"""


def alive(pid: int) -> bool:
    out = subprocess.run(
        ["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True
    ).stdout
    return str(pid) in out


def wait_for_file(path: Path) -> int:
    deadline = time.time() + 15
    while time.time() < deadline:
        if path.exists() and path.read_text():
            return int(path.read_text())
        time.sleep(0.05)
    raise AssertionError("child never started")


@pytest.mark.parametrize("how", ["cancel", "timeout"])
def test_tree_is_gone(tmp_path, how):
    pid_file = tmp_path / "child.pid"
    transport = CliTransport(ProcessGate(1))
    argv = [sys.executable, "-c", PARENT, str(pid_file)]

    async def scenario() -> int:
        task = asyncio.create_task(
            transport.run(argv, stdin=b"", cwd=tmp_path, timeout_s=2 if how == "timeout" else 60)
        )
        child = await asyncio.to_thread(wait_for_file, pid_file)
        if how == "cancel":
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            outcome = await task
            assert outcome.timed_out
        return child

    child = asyncio.run(scenario())
    time.sleep(0.5)
    assert not alive(child)
