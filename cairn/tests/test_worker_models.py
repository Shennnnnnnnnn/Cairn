from __future__ import annotations

import unittest
from pathlib import Path

from cairn.dispatcher.config import DispatchConfig, WorkerConfig
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

    def test_summarize_worker_defaults_to_gpt_5_4_mini(self) -> None:
        worker = WorkerConfig(
            name="summarizer",
            type="codex",
            task_types=["summarize"],
            max_running=1,
            priority=0,
        )

        argv = CodexDriver().build_execute(worker, "prompt", None).argv

        self.assertIn("--model", argv)
        self.assertEqual(argv[argv.index("--model") + 1], "gpt-5.4-mini")

    def test_default_dispatch_config_declares_dedicated_summary_worker(self) -> None:
        config = DispatchConfig.load(Path(__file__).parents[2] / "dispatch.yaml")

        summary_workers = [worker for worker in config.workers if worker.task_types == ["summarize"]]

        self.assertEqual(len(summary_workers), 1)
        self.assertEqual(summary_workers[0].type, "codex")
        self.assertEqual(summary_workers[0].model, "gpt-5.4-mini")

    def test_mock_dispatch_config_can_schedule_summaries(self) -> None:
        config = DispatchConfig.load(Path(__file__).parents[2] / "dispatch_mock.yaml")

        summary_workers = [worker for worker in config.workers if "summarize" in worker.task_types]

        self.assertTrue(summary_workers)


if __name__ == "__main__":
    unittest.main()
