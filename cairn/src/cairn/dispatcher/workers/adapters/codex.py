from __future__ import annotations

from cairn.dispatcher.config import WorkerConfig
from cairn.dispatcher.workers.base import DriverResult, RegexSessionDriver


class CodexDriver(RegexSessionDriver):
    type_name = "codex"

    def _model_args(self, worker: WorkerConfig) -> list[str]:
        args = self.model_args(worker)
        if not args and worker.env.get("CODEX_MODEL"):
            args = ["--model", worker.env["CODEX_MODEL"]]
        if worker.env.get("CODEX_BASE_URL"):
            args.extend(
                [
                    "-c",
                    'model_provider="cairn"',
                    "-c",
                    f'model_providers.cairn.base_url="{worker.env["CODEX_BASE_URL"]}"',
                ]
            )
        return args

    def build_healthcheck(self, worker: WorkerConfig) -> list[str]:
        # codex CLI is configured locally; no API keys or base_url needed.
        return [
            "codex",
            "exec",
            *self._model_args(worker),
            "--dangerously-bypass-approvals-and-sandbox",
            "--",
            "Reply with exactly: pong",
        ]

    def build_execute(self, worker: WorkerConfig, prompt: str, session: str | None) -> DriverResult:
        return DriverResult(
            argv=[
                "codex",
                "exec",
                *self._model_args(worker),
                "--dangerously-bypass-approvals-and-sandbox",
                "--",
                prompt,
            ]
        )

    def build_conclude(self, worker: WorkerConfig, prompt: str, session: str) -> list[str]:
        return [
            "codex",
            "exec",
            "resume",
            session,
            *self._model_args(worker),
            "--dangerously-bypass-approvals-and-sandbox",
            prompt,
        ]
