"""The local Studio API. Run it bound to 127.0.0.1, one worker, without --reload:

    uv run --directory backend uvicorn app.main:app --host 127.0.0.1 --port 8000

(--reload switches Windows to a selector event loop that cannot spawn the CLIs.)
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .core.config import Settings
from .core.security import StudioGuard
from .core.services import Services
from .infrastructure.llm import InvalidChoice, LlmError, ProviderUnavailable, UnknownProvider
from .modules.books.router import router as books_router
from .modules.convert.router import router as convert_router
from .modules.jobs.router import router as jobs_router
from .modules.jobs.runner import JobNotFound
from .modules.library.repository import Conflict, LibraryError, NotFound
from .modules.ocr.router import router as ocr_router
from .modules.providers.router import router as providers_router
from .modules.story.router import router as story_router

logger = logging.getLogger("bookshelf")
if not logger.handlers:  # uvicorn only configures its own loggers; show job and LLM call logs too
    _handler_out = logging.StreamHandler()
    _handler_out.setFormatter(logging.Formatter("%(levelname)s:     %(name)s %(message)s"))
    logger.addHandler(_handler_out)
    logger.setLevel(logging.INFO)

_ERRORS: tuple[tuple[type[Exception], int], ...] = (
    (NotFound, 404),
    (Conflict, 409),
    (LibraryError, 400),
    (UnknownProvider, 404),
    (InvalidChoice, 400),
    (ProviderUnavailable, 409),
    (LlmError, 400),
    (JobNotFound, 404),
    (ValueError, 400),
)


def create_app(settings: Settings | None = None, services: Services | None = None) -> FastAPI:
    settings = settings or (services.settings if services else Settings.from_env())

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        found = app.state.services.runner.recover()
        if found:
            logger.warning(
                "Marked %d job(s) left running by a previous process as interrupted.", found
            )
        yield
        await app.state.services.runner.shutdown()

    app = FastAPI(
        title="bookshelf-chat Studio API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,  # the contract is exported to a file by scripts/export_openapi.py
    )
    app.state.services = services or Services.build(settings)
    app.add_middleware(
        StudioGuard,
        token=settings.token,
        allowed_hosts=settings.allowed_hosts,
        allowed_origins=settings.allowed_origins,
    )

    for error_type, status in _ERRORS:
        app.add_exception_handler(error_type, _handler(status))

    app.include_router(providers_router)
    app.include_router(books_router)
    app.include_router(ocr_router)
    app.include_router(jobs_router)
    app.include_router(convert_router)
    app.include_router(story_router)
    return app


def _handler(status: int):
    async def handle(request: Request, exc: Exception) -> JSONResponse:
        message = getattr(exc, "message", None) or str(exc) or type(exc).__name__
        return JSONResponse({"detail": message}, status_code=status)

    return handle


def __getattr__(name: str) -> FastAPI:
    # `uvicorn app.main:app` builds the app on first access, so importing this module
    # (tests, the openapi export) does not read the environment.
    if name == "app":
        globals()["app"] = created = create_app()
        return created
    raise AttributeError(name)
