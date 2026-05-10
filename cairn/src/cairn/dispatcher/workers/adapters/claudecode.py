from __future__ import annotations

from cairn.dispatcher.config import WorkerConfig
from cairn.dispatcher.workers.base import DriverResult, SeedSessionDriver


class ClaudeCodeDriver(SeedSessionDriver):
    type_name = "claudecode"

    def build_healthcheck(self, worker: WorkerConfig) -> list[str]:
        # claude CLI is authenticated locally; no API key or base_url needed.
        return [
            "claude",
            "--dangerously-skip-permissions",
            "-p",
            "--",
            "Reply with exactly: pong",
        ]

    def build_execute(self, worker: WorkerConfig, prompt: str, session: str | None) -> DriverResult:
        assert session is not None
        return DriverResult(
            argv=[
                "claude",
                "--session-id",
                session,
                "--dangerously-skip-permissions",
                "-p",
                "--",
                prompt,
            ],
            session=session,
        )

    def build_conclude(self, worker: WorkerConfig, prompt: str, session: str) -> list[str]:
        return [
            "claude",
            "-r",
            session,
            "--dangerously-skip-permissions",
            "-p",
            "--",
            prompt,
        ]
