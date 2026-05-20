from __future__ import annotations

import unittest
from concurrent.futures import Future

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
from cairn.dispatcher.models import RunningTask
from cairn.dispatcher.runtime.cancellation import TaskCancellation
from cairn.dispatcher.scheduler.loop import DispatcherLoop
from cairn.dispatcher.tasks.summarize import SummaryTarget
from cairn.server.models import Fact, Intent, ProjectDetail, ProjectMeta, ProjectSummary


class _FakeExecutor:
    def __init__(self) -> None:
        self.submissions: list[tuple[object, tuple[object, ...]]] = []

    def submit(self, fn, *args):
        future: Future[str] = Future()
        self.submissions.append((fn, args))
        return future


class _FakeClient:
    def __init__(self, project: ProjectDetail | dict[str, ProjectDetail]) -> None:
        if isinstance(project, dict):
            self.projects = project
        else:
            self.projects = {project.project.id: project}

    def get_project(self, project_id: str) -> ProjectDetail:
        return self.projects[project_id]


class SummaryDispatcherTests(unittest.TestCase):
    def _loop_for_project(
        self,
        project: ProjectDetail | dict[str, ProjectDetail],
        *,
        summary_backfill: bool = False,
    ) -> tuple[DispatcherLoop, _FakeExecutor]:
        loop = DispatcherLoop.__new__(DispatcherLoop)
        loop.config = DispatchConfig(
            server="http://example.test",
            runtime=RuntimeConfig(
                max_workers=2,
                max_running_projects=1,
                max_project_workers=2,
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
                    name="summary",
                    type="codex",
                    task_types=["summarize"],
                    max_running=1,
                    priority=0,
                )
            ],
        )
        loop.client = _FakeClient(project)
        loop.container_manager = object()
        loop.executor = _FakeExecutor()
        loop.futures = {}
        loop.runtime_project_ids = set()
        loop.worker_unhealthy_until = {}
        loop.worker_rejected_until = {}
        loop._log_state = {}
        loop.summary_backfill = summary_backfill
        return loop, loop.executor

    def _summary(self, project_id: str = "p1", *, status: str = "active") -> ProjectSummary:
        return ProjectSummary(
            id=project_id,
            title="Project",
            directory_id=None,
            directory_local_path=None,
            status=status,
            created_at="2026-05-13T00:00:00Z",
            fact_count=3,
            intent_count=1,
            working_intent_count=0,
            unclaimed_intent_count=0,
            hint_count=0,
        )

    def _project(
        self,
        *,
        project_id: str = "p1",
        status: str = "active",
        fact_title: str | None = None,
        intent_title: str | None = None,
    ) -> ProjectDetail:
        return ProjectDetail(
            project=ProjectMeta(
                id=project_id,
                title="Project",
                status=status,
                created_at="2026-05-13T00:00:00Z",
            ),
            facts=[
                Fact(id="origin", title="Origin", description="origin"),
                Fact(id="goal", title="Goal", description="goal"),
                Fact(id="f1", title=fact_title, description="Long fact description"),
            ],
            intents=[
                Intent(
                    id="i1",
                    **{"from": ["origin"]},
                    to="f1",
                    title=intent_title,
                    description="Long intent description",
                    creator="tester",
                    worker="tester",
                    created_at="2026-05-13T00:00:00Z",
                    concluded_at="2026-05-13T00:00:00Z",
                )
            ],
            hints=[],
        )

    def test_dispatcher_schedules_summary_for_first_untitled_fact(self) -> None:
        loop, executor = self._loop_for_project(self._project(fact_title=None, intent_title=None))

        loop._dispatch_summaries([self._summary()])

        self.assertEqual(len(executor.submissions), 1)
        target = executor.submissions[0][1][5]
        self.assertEqual(target, SummaryTarget("fact", "f1", "Long fact description"))
        running = list(loop.futures.values())
        self.assertEqual(running[0].task_type, "summarize")
        self.assertEqual(running[0].intent_id, "fact:f1")

    def test_dispatcher_schedules_summary_for_untitled_intent_after_facts_have_titles(self) -> None:
        loop, executor = self._loop_for_project(self._project(fact_title="Fact", intent_title=None))

        loop._dispatch_summaries([self._summary()])

        target = executor.submissions[0][1][5]
        self.assertEqual(target, SummaryTarget("intent", "i1", "Long intent description"))

    def test_dispatcher_reschedules_fact_when_existing_title_is_too_long(self) -> None:
        loop, executor = self._loop_for_project(
            self._project(fact_title="一二三四五六七八九十一二三四五六七八九十一", intent_title="Intent")
        )

        loop._dispatch_summaries([self._summary()])

        target = executor.submissions[0][1][5]
        self.assertEqual(target, SummaryTarget("fact", "f1", "Long fact description"))

    def test_dispatcher_reschedules_intent_when_existing_title_is_too_long(self) -> None:
        loop, executor = self._loop_for_project(
            self._project(fact_title="Fact", intent_title="一二三四五六七八九十一二三四五六七八九十一")
        )

        loop._dispatch_summaries([self._summary()])

        target = executor.submissions[0][1][5]
        self.assertEqual(target, SummaryTarget("intent", "i1", "Long intent description"))

    def test_dispatcher_reschedules_title_that_is_description_prefix(self) -> None:
        loop, executor = self._loop_for_project(
            self._project(fact_title="Long fact", intent_title="Intent")
        )

        loop._dispatch_summaries([self._summary()])

        target = executor.submissions[0][1][5]
        self.assertEqual(target, SummaryTarget("fact", "f1", "Long fact description"))

    def test_dispatcher_reschedules_semantically_incomplete_title(self) -> None:
        loop, executor = self._loop_for_project(
            self._project(fact_title="事实处理的", intent_title="Intent")
        )

        loop._dispatch_summaries([self._summary()])

        target = executor.submissions[0][1][5]
        self.assertEqual(target, SummaryTarget("fact", "f1", "Long fact description"))

    def test_failed_summary_is_retriable_on_next_dispatch_tick(self) -> None:
        loop, executor = self._loop_for_project(self._project(fact_title=None, intent_title="Intent"))
        failed: Future[str] = Future()
        failed.set_result("failed")
        loop.futures[failed] = RunningTask("p1", "summarize", "summary", TaskCancellation(), intent_id="fact:f1")

        loop._reap_futures()
        loop._dispatch_summaries([self._summary()])

        self.assertEqual(len(executor.submissions), 1)
        target = executor.submissions[0][1][5]
        self.assertEqual(target, SummaryTarget("fact", "f1", "Long fact description"))

    def test_default_summary_dispatch_skips_inactive_projects(self) -> None:
        inactive_project = self._project(project_id="p1", status="completed", fact_title=None, intent_title=None)
        loop, executor = self._loop_for_project({"p1": inactive_project})

        loop._dispatch_summaries([self._summary("p1", status="completed")])

        self.assertEqual(executor.submissions, [])

    def test_summary_dispatch_prioritizes_active_projects_over_backfill(self) -> None:
        inactive_project = self._project(project_id="p1", status="completed", fact_title=None, intent_title=None)
        active_project = self._project(project_id="p2", status="active", fact_title=None, intent_title=None)
        loop, executor = self._loop_for_project(
            {"p1": inactive_project, "p2": active_project},
            summary_backfill=True,
        )

        loop._dispatch_summaries([
            self._summary("p1", status="completed"),
            self._summary("p2", status="active"),
        ])

        self.assertEqual(len(executor.submissions), 1)
        self.assertEqual(executor.submissions[0][1][3], "p2")
        target = executor.submissions[0][1][5]
        self.assertEqual(target, SummaryTarget("fact", "f1", "Long fact description"))

    def test_summary_backfill_can_dispatch_inactive_when_no_active_target_exists(self) -> None:
        inactive_project = self._project(project_id="p1", status="completed", fact_title=None, intent_title=None)
        loop, executor = self._loop_for_project(
            {"p1": inactive_project},
            summary_backfill=True,
        )

        loop._dispatch_summaries([self._summary("p1", status="completed")])

        self.assertEqual(len(executor.submissions), 1)
        self.assertEqual(executor.submissions[0][1][3], "p1")


if __name__ == "__main__":
    unittest.main()
