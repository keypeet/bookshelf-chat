"""One cap on concurrent CLI processes for the whole backend.

Created once from settings when the app starts and shared by every caller;
a job's own parallelism (M) is a smaller semaphore nested inside this one.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager


class ProcessGate:
    def __init__(self, limit: int) -> None:
        if limit < 1:
            raise ValueError("The process limit must be at least 1.")
        self.limit = limit
        self._semaphore = asyncio.Semaphore(limit)
        self.active = 0

    @asynccontextmanager
    async def slot(self) -> AsyncIterator[None]:
        async with self._semaphore:
            self.active += 1
            try:
                yield
            finally:
                self.active -= 1
