from __future__ import annotations

import unittest

from cairn.dispatcher.config import WorkerConfig
from cairn.dispatcher.workers.adapters.claudecode import ClaudeCodeDriver
from cairn.dispatcher.workers.adapters.codex import CodexDriver
from cairn.dispatcher.workers.adapters.gemini import GeminiDriver


class WorkerModelTests(unittest.TestCase):
    def test_codex_uses_worker_model_key_for_cli_model_arg(self) -> None:
        worker = WorkerConfig(
            name="codex",
            type="codex",
            task_types=["bootstrap"],
            max_running=1,
            priority=0,
            model="o3",
        )

        argv = CodexDriver().build_execute(worker, "prompt", None).argv

        self.assertIn("--model", argv)
        self.assertEqual(argv[argv.index("--model") + 1], "o3")

    def test_claude_uses_worker_model_key_for_cli_model_arg(self) -> None:
        worker = WorkerConfig(
            name="claude",
            type="claudecode",
            task_types=["reason"],
            max_running=1,
            priority=0,
            model="claude-sonnet-4-20250514",
        )

        argv = ClaudeCodeDriver().build_execute(worker, "prompt", "session-1").argv

        self.assertIn("--model", argv)
        self.assertEqual(argv[argv.index("--model") + 1], "claude-sonnet-4-20250514")

    def test_gemini_uses_worker_model_key_for_cli_model_arg(self) -> None:
        worker = WorkerConfig(
            name="gemini",
            type="gemini",
            task_types=["explore"],
            max_running=1,
            priority=0,
            model="gemini-2.5-pro",
        )

        argv = GeminiDriver().build_execute(worker, "prompt", None).argv

        self.assertIn("--model", argv)
        self.assertEqual(argv[argv.index("--model") + 1], "gemini-2.5-pro")

    def test_provider_specific_env_model_keys_are_ignored(self) -> None:
        worker = WorkerConfig(
            name="gemini",
            type="gemini",
            task_types=["explore"],
            max_running=1,
            priority=0,
            env={"GEMINI_MODEL": "gemini-2.5-pro"},
        )

        argv = GeminiDriver().build_execute(worker, "prompt", None).argv

        self.assertNotIn("--model", argv)


if __name__ == "__main__":
    unittest.main()
