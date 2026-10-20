"""Run provider CLIs as isolated, bounded subprocesses."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
import shutil
import signal
import subprocess
import tempfile
import time
from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import ClassVar

from ...core.process_gate import ProcessGate
from .binaries import resolve_command
from .models import ProviderInfo, ProviderStatus, StructuredCall, StructuredResult
from .parse import is_usage_limit

logger = logging.getLogger(__name__)

MAX_OUTPUT_BYTES = 16 * 1024 * 1024
VERSION_TIMEOUT_S = 20.0
STDERR_TAIL_CHARS = 2_000
SCRATCH_PREFIX = "bookshelf-cli-"
# Model and effort ids go into argv; anything outside this set is refused before a command exists.
ARG_PATTERN = re.compile(r"^[a-z0-9.\-]{1,64}$")

_READ_CHUNK = 64 * 1024
_WINDOWS = os.name == "nt"


def utcnow() -> datetime:
    return datetime.now(UTC)


class _OutputTooLarge(Exception):
    pass


@dataclass(frozen=True, slots=True)
class ProcessOutcome:
    """How one subprocess ended, before any provider-specific decoding."""

    launched: bool
    timed_out: bool = False
    output_too_large: bool = False
    stdout: bytes = b""
    stderr: bytes = b""
    returncode: int | None = None
    launch_error: OSError | None = None

    def stdout_text(self) -> str:
        return self.stdout.decode("utf-8", "replace").strip()

    def stderr_tail(self) -> str:
        return self.stderr.decode("utf-8", "replace").strip()[-STDERR_TAIL_CHARS:]


def kill_tree(pid: int) -> None:
    """Kill a process and every child it started.

    Killing only the parent leaves CLI children running on Windows, so the
    whole tree goes through taskkill. On POSIX the child leads its own session.
    """

    if _WINDOWS:
        subprocess.run(
            ["taskkill", "/T", "/F", "/PID", str(pid)],
            capture_output=True,
            check=False,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(pid, signal.SIGKILL)


class CliTransport:
    """Spawns CLI processes: stdin in, capped stdout and stderr out, never a shell."""

    def __init__(self, gate: ProcessGate, *, max_output_bytes: int = MAX_OUTPUT_BYTES) -> None:
        self._gate = gate
        self._max_output_bytes = max_output_bytes

    async def run(
        self, argv: Sequence[str], *, stdin: bytes, cwd: Path, timeout_s: float
    ) -> ProcessOutcome:
        """Run one call under the process-wide gate."""

        async with self._gate.slot():
            return await self._run(argv, stdin=stdin, cwd=cwd, timeout_s=timeout_s)

    async def probe(self, argv: Sequence[str], *, timeout_s: float) -> ProcessOutcome:
        """Run a free, short command such as ``--version``, outside the gate."""

        return await self._run(argv, stdin=b"", cwd=None, timeout_s=timeout_s)

    async def _run(
        self, argv: Sequence[str], *, stdin: bytes, cwd: Path | None, timeout_s: float
    ) -> ProcessOutcome:
        options: dict[str, object] = (
            {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW}
            if _WINDOWS
            else {"start_new_session": True}
        )
        try:
            process = await asyncio.create_subprocess_exec(
                *argv,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=None if cwd is None else str(cwd),
                **options,
            )
        except NotImplementedError as exc:
            # A selector event loop (uvicorn --reload on Windows) cannot spawn subprocesses.
            return ProcessOutcome(launched=False, launch_error=OSError(str(exc) or "unsupported"))
        except OSError as exc:
            return ProcessOutcome(launched=False, launch_error=exc)

        try:
            async with asyncio.timeout(timeout_s):
                stdout, stderr = await self._communicate(process, stdin)
        except TimeoutError:
            await self._terminate(process)
            return ProcessOutcome(launched=True, timed_out=True)
        except _OutputTooLarge:
            await self._terminate(process)
            return ProcessOutcome(launched=True, output_too_large=True)
        except asyncio.CancelledError:
            await self._terminate(process)
            raise
        return ProcessOutcome(
            launched=True, stdout=stdout, stderr=stderr, returncode=process.returncode
        )

    async def _communicate(
        self, process: asyncio.subprocess.Process, stdin: bytes
    ) -> tuple[bytes, bytes]:
        assert process.stdin and process.stdout and process.stderr
        pending = [
            asyncio.ensure_future(self._read(process.stdout)),
            asyncio.ensure_future(self._read(process.stderr)),
            asyncio.ensure_future(_feed(process.stdin, stdin)),
        ]
        try:
            stdout, stderr, _ = await asyncio.gather(*pending)
        finally:
            for item in pending:
                item.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
        await process.wait()
        return stdout, stderr

    async def _read(self, stream: asyncio.StreamReader) -> bytes:
        buffer = bytearray()
        while chunk := await stream.read(_READ_CHUNK):
            if len(buffer) + len(chunk) > self._max_output_bytes:
                raise _OutputTooLarge
            buffer += chunk
        return bytes(buffer)

    async def _terminate(self, process: asyncio.subprocess.Process) -> None:
        """Kill the tree, then wait a bounded time so a held pipe cannot hang the caller."""

        # Always kill the tree: the parent may have exited while a child still holds the pipes.
        await asyncio.to_thread(kill_tree, process.pid)
        with contextlib.suppress(TimeoutError, ProcessLookupError):
            await asyncio.wait_for(process.wait(), 5.0)
        if process.returncode is None:
            logger.warning("Process %s did not exit after kill; closing its pipes.", process.pid)
            with contextlib.suppress(Exception):
                process._transport.close()  # type: ignore[attr-defined]


async def _feed(pipe: asyncio.StreamWriter, data: bytes) -> None:
    try:
        if data:
            pipe.write(data)
            await pipe.drain()
    except (BrokenPipeError, ConnectionResetError):
        pass
    finally:
        pipe.close()


class Scratch:
    """A private working area for one call, outside the repository, removed when the call ends.

    It sits outside the repo so CLIs do not load this project's agent instructions.
    """

    def __init__(self, root: Path) -> None:
        self.root = root

    def write(self, name: str, text: str) -> Path:
        path = self.root / name
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(text)
        return path

    def add_image(self, source: Path, index: int) -> Path:
        target = self.root / f"page-{index:03d}{source.suffix.lower()}"
        shutil.copyfile(source, target)
        return target


class CliProvider(ABC):
    """A provider reached through a local CLI.

    Subclasses describe the command line and how to read the output; this
    class owns locating the binary, the scratch area, and launch, timeout and
    size failures.
    """

    info: ClassVar[ProviderInfo]
    binary_name: ClassVar[str]

    def __init__(self, transport: CliTransport, binary: str | None = None) -> None:
        self._transport = transport
        self._binary = binary or self.binary_name
        self._command: tuple[str, ...] | None = None
        self._resolved = False

    def command(self) -> tuple[str, ...] | None:
        """The real program, resolved once (paths under node_modules change between versions)."""

        if not self._resolved:
            self._command = resolve_command(self._binary)
            # A missing CLI is looked up again next time, so installing it needs no restart.
            self._resolved = self._command is not None
        return self._command

    def version_args(self) -> tuple[str, ...]:
        return ("--version",)

    @abstractmethod
    def build_command(
        self, request: StructuredCall, scratch: Scratch, images: Sequence[Path]
    ) -> list[str]:
        """The arguments after the program itself."""

    @abstractmethod
    def stdin_payload(self, request: StructuredCall, images: Sequence[Path]) -> bytes: ...

    @abstractmethod
    def decode(self, outcome: ProcessOutcome, request: StructuredCall) -> StructuredResult:
        """Read a process that ran to completion."""

    async def status(self) -> ProviderStatus:
        command = self.command()
        if command is None:
            return ProviderStatus(
                available=False,
                installed=False,
                detail=f"{self._binary!r} was not found. {self.info.install_hint}",
                checked_at=utcnow(),
            )
        outcome = await self._transport.probe(
            [*command, *self.version_args()], timeout_s=VERSION_TIMEOUT_S
        )
        if not outcome.launched:
            detail = f"{command[-1]} could not be run: {outcome.launch_error}"
        elif outcome.timed_out:
            detail = f"{command[-1]} did not report a version within {VERSION_TIMEOUT_S:g}s."
        elif outcome.returncode != 0 or not outcome.stdout_text():
            detail = f"{command[-1]} did not report a version. {outcome.stderr_tail()}".strip()
        else:
            version = outcome.stdout_text().splitlines()[0]
            return ProviderStatus(
                available=True,
                detail="Ready.",
                version=version,
                command=command,
                checked_at=utcnow(),
            )
        return ProviderStatus(available=False, detail=detail, command=command, checked_at=utcnow())

    async def call(self, request: StructuredCall) -> StructuredResult:
        started = time.monotonic()
        command = self.command()
        if command is None:
            return StructuredResult(
                launched=False, error_kind="not_found", error_detail=self._binary
            )
        with tempfile.TemporaryDirectory(prefix=SCRATCH_PREFIX, ignore_cleanup_errors=True) as root:
            scratch = Scratch(Path(root))
            images = [scratch.add_image(path, i) for i, path in enumerate(request.images, 1)]
            # Prompts name their pages with {{image}}; only now are the copied paths known.
            request = replace(
                request, prompt=request.prompt.replace("{{image}}", image_list(images))
            )
            outcome = await self._transport.run(
                [*command, *self.build_command(request, scratch, images)],
                stdin=self.stdin_payload(request, images),
                cwd=scratch.root,
                timeout_s=request.timeout_s,
            )
        elapsed = int((time.monotonic() - started) * 1000)

        if not outcome.launched:
            kind = "not_found" if isinstance(outcome.launch_error, FileNotFoundError) else None
            return StructuredResult(
                launched=False,
                duration_ms=elapsed,
                error_kind=kind or "launch_failed",
                error_detail=str(outcome.launch_error),
            )
        if outcome.timed_out:
            return StructuredResult(duration_ms=elapsed, error_kind="timeout")
        if outcome.output_too_large:
            return StructuredResult(duration_ms=elapsed, error_kind="output_too_large")
        result = self.decode(outcome, request)
        if result.failed and result.error_kind != "usage_limit":
            if is_usage_limit(f"{result.error_detail}\n{outcome.stderr_tail()}"):
                result = replace(result, error_kind="usage_limit")
        return replace(result, launched=True, duration_ms=elapsed)


def image_list(images: Sequence[Path]) -> str:
    """How a prompt names the attached pages, one absolute path per line."""

    return "\n".join(str(path) for path in images)
