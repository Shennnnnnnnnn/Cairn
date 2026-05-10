from __future__ import annotations

import re

from cairn.dispatcher.config import WorkerConfig
from cairn.dispatcher.workers.base import DriverResult, WorkerDriver


class GeminiDriver(WorkerDriver):
    """
    Adapter for the Gemini CLI (https://github.com/google-gemini/gemini-cli).
    Assumes the CLI is authenticated locally via `gemini auth` or GEMINI_API_KEY
    environment variable — no credentials need to be set in dispatch.yaml.

    Session continuity: Gemini CLI does not expose a stable session-resume flag,
    so conclude fallback is disabled (supports_conclude returns False).
    The dispatcher will skip the conclude phase and mark the task as failed on
    timeout, which is the safe default.
    """

    type_name = "gemini"
    # Gemini CLI prints the session/conversation id in stderr as:
    #   "Conversation ID: <id>"
    session_pattern = re.compile(r"[Cc]onversation\s+[Ii][Dd]:\s*(\S+)")

    def supports_conclude(self) -> bool:
        return False

    def build_healthcheck(self, worker: WorkerConfig) -> list[str]:
        # gemini CLI is authenticated locally; no API keys needed.
        return [
            "gemini",
            "--yolo",
            "-p",
            "Reply with exactly: pong",
        ]

    def build_execute(self, worker: WorkerConfig, prompt: str, session: str | None) -> DriverResult:
        argv = [
            "gemini",
            "--yolo",
            "-p",
            prompt,
        ]
        return DriverResult(argv=argv, session=None)

    def build_conclude(self, worker: WorkerConfig, prompt: str, session: str) -> list[str]:
        # conclude is not supported; this should never be called
        return [
            "gemini",
            "--yolo",
            "-p",
            prompt,
        ]

    def extract_session(self, session: str | None, stdout: str, stderr: str) -> str | None:
        if session:
            return session
        match = self.session_pattern.search(stderr)
        if match:
            return match.group(1)
        return None

    def extract_response_text(self, stdout: str, stderr: str) -> str:
        return stdout
