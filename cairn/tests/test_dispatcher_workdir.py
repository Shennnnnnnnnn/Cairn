from __future__ import annotations

import unittest
from unittest.mock import patch

from cairn.dispatcher.config import (
    BootstrapTaskConfig,
    ContainerConfig,
    DispatchConfig,
    ExploreTaskConfig,
    ReasonTaskConfig,
    RuntimeConfig,
    TasksConfig,
    WorkerConfig,
)
from cairn.dispatcher.runtime.cancellation import TaskCancellation
from cairn.dispatcher.runtime.process import ProcessResult
from cairn.dispatcher.tasks.bootstrap import run_bootstrap_task
from cairn.dispatcher.tasks.explore import run_explore_task
from cairn.dispatcher.tasks.reason import run_reason_task
from cairn.dispatcher.workers.base import DriverResult
from cairn.server.models import Fact, Hint, Intent, ProjectDetail, ProjectMeta


class _FakeContainerManager:
    def __init__(self) -> None:
        self.files: dict[str, str] = {}

    def ensure_running(self, project_id: str) -> str:
        return f"container-{project_id}"

    def write_text_file(self, container_name: str, path: str, content: str) -> None:
        self.files[path] = content


class _FakeClient:
    def __init__(self, project: ProjectDetail):
        self._project = project

    def get_project(self, project_id: str) -> ProjectDetail:
        return self._project

    def conclude(self, project_id: str, intent_id: str, worker: str, description: str):
        return _ApiResult(200, {"fact": {"id": "f-next"}})

    def release(self, project_id: str, intent_id: str, worker: str):
        return _ApiResult(200)

    def release_reason(self, project_id: str, worker: str):
        return _ApiResult(200)


class _ApiResult:
    def __init__(self, status_code: int, data=None, text: str = ""):
        self.status_code = status_code
        self.data = data
        self.text = text

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300


class _FakeDriver:
    def __init__(self) -> None:
        self.execute_prompts: list[str] = []
        self.conclude_prompts: list[str] = []

    def build_healthcheck(self, worker: WorkerConfig) -> list[str]:
        return ["healthcheck"]

    def prepare_session(self) -> str:
        return "session-1"

    def build_execute(self, worker: WorkerConfig, prompt: str, session: str | None) -> DriverResult:
        self.execute_prompts.append(prompt)
        return DriverResult(["execute"], session=session)

    def build_conclude(self, worker: WorkerConfig, prompt: str, session: str) -> list[str]:
        self.conclude_prompts.append(prompt)
        return ["conclude"]

    def supports_conclude(self) -> bool:
        return True

    def extract_session(self, session: str | None, stdout: str, stderr: str) -> str | None:
        return session

    def extract_response_text(self, stdout: str, stderr: str) -> str:
        return stdout


class DispatcherWorkdirTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = DispatchConfig(
            server="http://example.test",
            runtime=RuntimeConfig(
                max_workers=1,
                max_running_projects=1,
                max_project_workers=1,
                interval=60,
                healthcheck_timeout=5,
                prompt_group="default",
            ),
            tasks=TasksConfig(
                bootstrap=BootstrapTaskConfig(timeout=5, conclude_timeout=5),
                reason=ReasonTaskConfig(timeout=5, max_intents=1),
                explore=ExploreTaskConfig(timeout=5, conclude_timeout=5),
            ),
            container=ContainerConfig(image="image", network_mode="bridge", completed_action="remove"),
            workers=[
                WorkerConfig(
                    name="worker-a",
                    type="mock",
                    task_types=["bootstrap", "reason", "explore"],
                    max_running=1,
                    priority=1,
                )
            ],
        )
        self.worker = self.config.workers[0]
        self.project = ProjectDetail(
            project=ProjectMeta(
                id="p1",
                title="Project",
                directory_id="dir1",
                directory_local_path="/tmp/cairn-project",
                status="active",
                created_at="2026-05-13T00:00:00Z",
            ),
            facts=[
                Fact(id="origin", description="origin"),
                Fact(id="goal", description="goal"),
                Fact(id="f1", description="fact"),
            ],
            intents=[
                Intent(
                    id="i1",
                    **{"from": ["f1"]},
                    to=None,
                    description="explore",
                    creator="tester",
                    worker=None,
                    created_at="2026-05-13T00:00:00Z",
                )
            ],
            hints=[],
        )
        self.client = _FakeClient(self.project)
        self.container_manager = _FakeContainerManager()

    def test_reason_executes_in_project_directory_local_path(self) -> None:
        calls: list[str | None] = []

        def fake_run_worker_process(*args, **kwargs):
            calls.append(kwargs.get("workdir"))
            return ProcessResult(returncode=1, stdout="", stderr="failed")

        with (
            patch("cairn.dispatcher.tasks.reason.get_driver", return_value=_FakeDriver()),
            patch("cairn.dispatcher.tasks.reason.run_healthcheck") as healthcheck,
            patch("cairn.dispatcher.tasks.reason.run_worker_process", side_effect=fake_run_worker_process),
        ):
            healthcheck.return_value.result = ProcessResult(returncode=0, stdout="", stderr="")
            run_reason_task(
                self.config,
                self.client,
                self.container_manager,
                self.project,
                "graph: yaml",
                self.worker,
                TaskCancellation(),
            )

        self.assertEqual(calls, ["/tmp/cairn-project"])

    def test_reason_prompt_and_graph_snapshot_include_project_workdir(self) -> None:
        driver = _FakeDriver()

        def fake_run_worker_process(*args, **kwargs):
            return ProcessResult(returncode=1, stdout="", stderr="failed")

        with (
            patch("cairn.dispatcher.tasks.reason.get_driver", return_value=driver),
            patch("cairn.dispatcher.tasks.reason.run_healthcheck") as healthcheck,
            patch("cairn.dispatcher.tasks.reason.run_worker_process", side_effect=fake_run_worker_process),
        ):
            healthcheck.return_value.result = ProcessResult(returncode=0, stdout="", stderr="")
            run_reason_task(
                self.config,
                self.client,
                self.container_manager,
                self.project,
                "project:\n  title: Project\n",
                self.worker,
                TaskCancellation(),
            )

        self.assertIn("## Current Working Directory", driver.execute_prompts[0])
        self.assertIn("/tmp/cairn-project", driver.execute_prompts[0])
        snapshot = next(iter(self.container_manager.files.values()))
        self.assertIn("current_working_directory: /tmp/cairn-project", snapshot)
        self.assertIn("directory_local_path: /tmp/cairn-project", snapshot)

    def test_explore_execute_and_conclude_use_project_directory_local_path(self) -> None:
        calls: list[str | None] = []

        def fake_run_worker_process(*args, **kwargs):
            calls.append(kwargs.get("workdir"))
            if len(calls) == 1:
                return ProcessResult(returncode=0, stdout="{invalid json", stderr="")
            return ProcessResult(
                returncode=0,
                stdout='{"accepted": true, "data": {"description": "fact"}}',
                stderr="",
            )

        with (
            patch("cairn.dispatcher.tasks.explore.get_driver", return_value=_FakeDriver()),
            patch("cairn.dispatcher.tasks.explore.run_healthcheck") as healthcheck,
            patch("cairn.dispatcher.tasks.explore.run_worker_process", side_effect=fake_run_worker_process),
        ):
            healthcheck.return_value.result = ProcessResult(returncode=0, stdout="", stderr="")
            run_explore_task(
                self.config,
                self.client,
                self.container_manager,
                self.project,
                "graph: yaml",
                self.project.intents[0],
                self.worker,
                TaskCancellation(),
            )

        self.assertEqual(calls, ["/tmp/cairn-project", "/tmp/cairn-project"])

    def test_explore_prompt_and_conclude_prompt_include_project_workdir(self) -> None:
        driver = _FakeDriver()

        def fake_run_worker_process(*args, **kwargs):
            if len(driver.execute_prompts) == 1 and not driver.conclude_prompts:
                return ProcessResult(returncode=0, stdout="{invalid json", stderr="")
            return ProcessResult(
                returncode=0,
                stdout='{"accepted": true, "data": {"description": "fact"}}',
                stderr="",
            )

        with (
            patch("cairn.dispatcher.tasks.explore.get_driver", return_value=driver),
            patch("cairn.dispatcher.tasks.explore.run_healthcheck") as healthcheck,
            patch("cairn.dispatcher.tasks.explore.run_worker_process", side_effect=fake_run_worker_process),
        ):
            healthcheck.return_value.result = ProcessResult(returncode=0, stdout="", stderr="")
            run_explore_task(
                self.config,
                self.client,
                self.container_manager,
                self.project,
                "project:\n  title: Project\n",
                self.project.intents[0],
                self.worker,
                TaskCancellation(),
            )

        self.assertIn("/tmp/cairn-project", driver.execute_prompts[0])
        self.assertIn("/tmp/cairn-project", driver.conclude_prompts[0])
        self.assertTrue(
            all("current_working_directory: /tmp/cairn-project" in content for content in self.container_manager.files.values())
        )

    def test_bootstrap_execute_and_conclude_use_project_directory_local_path(self) -> None:
        calls: list[str | None] = []

        def fake_run_worker_process(*args, **kwargs):
            calls.append(kwargs.get("workdir"))
            if len(calls) == 1:
                return ProcessResult(returncode=0, stdout="{invalid json", stderr="")
            return ProcessResult(
                returncode=0,
                stdout='{"accepted": true, "data": {"fact": {"description": "fact"}}}',
                stderr="",
            )

        with (
            patch("cairn.dispatcher.tasks.bootstrap.get_driver", return_value=_FakeDriver()),
            patch("cairn.dispatcher.tasks.bootstrap.run_healthcheck") as healthcheck,
            patch("cairn.dispatcher.tasks.bootstrap.run_worker_process", side_effect=fake_run_worker_process),
        ):
            healthcheck.return_value.result = ProcessResult(returncode=0, stdout="", stderr="")
            run_bootstrap_task(
                self.config,
                self.client,
                self.container_manager,
                self.project,
                self.project.intents[0],
                self.worker,
                TaskCancellation(),
            )

        self.assertEqual(calls, ["/tmp/cairn-project", "/tmp/cairn-project"])

    def test_bootstrap_prompt_and_conclude_prompt_include_project_workdir(self) -> None:
        driver = _FakeDriver()

        def fake_run_worker_process(*args, **kwargs):
            if len(driver.execute_prompts) == 1 and not driver.conclude_prompts:
                return ProcessResult(returncode=0, stdout="{invalid json", stderr="")
            return ProcessResult(
                returncode=0,
                stdout='{"accepted": true, "data": {"fact": {"description": "fact"}}}',
                stderr="",
            )

        with (
            patch("cairn.dispatcher.tasks.bootstrap.get_driver", return_value=driver),
            patch("cairn.dispatcher.tasks.bootstrap.run_healthcheck") as healthcheck,
            patch("cairn.dispatcher.tasks.bootstrap.run_worker_process", side_effect=fake_run_worker_process),
        ):
            healthcheck.return_value.result = ProcessResult(returncode=0, stdout="", stderr="")
            run_bootstrap_task(
                self.config,
                self.client,
                self.container_manager,
                self.project,
                self.project.intents[0],
                self.worker,
                TaskCancellation(),
            )

        self.assertIn("/tmp/cairn-project", driver.execute_prompts[0])
        self.assertIn("/tmp/cairn-project", driver.conclude_prompts[0])


if __name__ == "__main__":
    unittest.main()
