"""The objects every router uses, built once when the app starts."""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Request

from ..infrastructure.llm import LlmGateway, build_gateway
from ..modules.convert.service import ConvertService
from ..modules.jobs.runner import JobRunner
from ..modules.library.repository import LibraryRepository
from ..modules.ocr.service import OcrService
from ..modules.sources.service import SourceService
from ..modules.story.service import StoryService
from .config import Settings
from .process_gate import ProcessGate
from .workdir import Workdir


@dataclass
class Services:
    settings: Settings
    gate: ProcessGate
    repo: LibraryRepository
    workdir: Workdir
    gateway: LlmGateway
    runner: JobRunner
    sources: SourceService
    ocr: OcrService
    story: StoryService
    convert: ConvertService

    @classmethod
    def build(cls, settings: Settings, gateway: LlmGateway | None = None) -> Services:
        gate = ProcessGate(settings.process_limit)
        repo = LibraryRepository(settings.library_dir)
        workdir = Workdir(settings.workdir)
        gateway = gateway or build_gateway(gate, settings.binaries)
        runner = JobRunner(workdir)
        sources = SourceService(
            workdir, max_bytes=settings.max_pdf_bytes, max_pages=settings.max_pdf_pages
        )
        ocr = OcrService(repo, workdir, sources, gateway, runner, settings.prompts_dir)
        story = StoryService(repo, workdir, gateway, runner, settings.prompts_dir)
        convert = ConvertService(repo, workdir, gateway, runner, settings.prompts_dir, story)
        return cls(settings, gate, repo, workdir, gateway, runner, sources, ocr, story, convert)

    def start_job(self, job_id: str) -> dict:
        """Start or resume a job with the service that owns its kind."""

        kind = self.runner.get(job_id)["kind"]
        if kind == "ocr":
            return self.ocr.start(job_id)
        if kind == "convert":
            return self.convert.start(job_id)
        return self.story.start(job_id)


def services(request: Request) -> Services:
    return request.app.state.services
