from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

from cairn.server import db
from cairn.server.models import (
    CreateDirectoryRequest,
    CreateProjectRequest,
    UpdateProjectDirectoryRequest,
    UpdateProjectFavoriteRequest,
    UpdateProjectStatusRequest,
    UpdateTitleRequest,
)
from cairn.server.routers.projects import (
    create_project,
    create_project_directory,
    delete_project_directory,
    list_project_directories,
    list_projects,
    update_fact_title,
    update_intent_title,
    update_project_favorite,
    update_project_status,
    update_project_directory_assignment,
)
from cairn.server.routers.export import _export_yaml


class ProjectTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmpdir = tempfile.TemporaryDirectory()
        db.configure(Path(cls._tmpdir.name) / "cairn.db")

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmpdir.cleanup()

    def setUp(self) -> None:
        with db.get_conn() as conn:
            conn.execute("DELETE FROM intent_sources")
            conn.execute("DELETE FROM intents")
            conn.execute("DELETE FROM hints")
            conn.execute("DELETE FROM facts")
            conn.execute("DELETE FROM scoped_counters")
            conn.execute("DELETE FROM projects")
            conn.execute("DELETE FROM project_directories")
            conn.execute(
                "UPDATE counters SET value = 0 WHERE name IN ('project', 'directory')"
            )

    def test_project_list_preserves_scheduled_start_at(self) -> None:
        create_project(
            CreateProjectRequest(
                title="scheduled",
                origin="origin",
                goal="goal",
                scheduled_start_at="2026-05-13T00:00:00+08:00",
            )
        )

        projects = list_projects()

        self.assertEqual(projects[0].scheduled_start_at, "2026-05-12T16:00:00Z")

    def test_fact_and_intent_titles_can_be_updated_for_graph_labels(self) -> None:
        project = create_project(
            CreateProjectRequest(
                title="titles",
                origin="A very long origin description",
                goal="A very long goal description",
            )
        )
        with db.get_conn() as conn:
            conn.execute(
                "INSERT INTO intents (id, project_id, to_fact_id, description, creator, worker, last_heartbeat_at, created_at, concluded_at) VALUES ('i001', ?, 'goal', ?, 'agent', 'agent', '2026-05-13T00:00:00Z', '2026-05-13T00:00:00Z', '2026-05-13T00:00:00Z')",
                (project.project.id, "Long complete explanation that should be summarized"),
            )
            conn.execute(
                "INSERT INTO intent_sources (intent_id, project_id, fact_id) VALUES ('i001', ?, 'origin')",
                (project.project.id,),
            )

        fact = update_fact_title(project.project.id, "goal", UpdateTitleRequest(title="Goal title"))
        intent = update_intent_title(project.project.id, "i001", UpdateTitleRequest(title="Complete title"))

        self.assertEqual(fact.title, "Goal title")
        self.assertEqual(intent.title, "Complete title")

    def test_project_running_time_counts_only_active_due_intervals(self) -> None:
        with patch("cairn.server.routers.projects.utcnow", return_value="2026-05-13T00:00:00Z"):
            project = create_project(
                CreateProjectRequest(title="runtime", origin="origin", goal="goal")
            )

        with patch("cairn.server.services.utcnow", return_value="2026-05-13T00:00:05Z"):
            self.assertEqual(list_projects()[0].running_time_ms, 5000)

        with patch("cairn.server.routers.projects.utcnow", return_value="2026-05-13T00:00:05Z"):
            stopped = update_project_status(
                project.project.id,
                UpdateProjectStatusRequest(status="stopped"),
            )
        self.assertEqual(stopped.running_time_ms, 5000)

        with patch("cairn.server.services.utcnow", return_value="2026-05-13T00:00:20Z"):
            self.assertEqual(list_projects()[0].running_time_ms, 5000)

        with patch("cairn.server.routers.projects.utcnow", return_value="2026-05-13T00:00:20Z"):
            update_project_status(
                project.project.id,
                UpdateProjectStatusRequest(
                    status="active",
                    scheduled_start_at="2026-05-13T00:00:30Z",
                ),
            )

        with patch("cairn.server.services.utcnow", return_value="2026-05-13T00:00:25Z"):
            self.assertEqual(list_projects()[0].running_time_ms, 5000)
        with patch("cairn.server.services.utcnow", return_value="2026-05-13T00:00:35Z"):
            self.assertEqual(list_projects()[0].running_time_ms, 10000)

    def test_project_directory_assignment_and_counts(self) -> None:
        directory = create_project_directory(
            CreateDirectoryRequest(
                name="Client Work",
                local_path="/tmp/client-work",
            )
        )
        project = create_project(
            CreateProjectRequest(
                title="scoped",
                origin="origin",
                goal="goal",
                directory_id=directory.id,
            )
        )

        projects = list_projects()
        directories = list_project_directories()

        scoped_project = next(p for p in projects if p.id == project.project.id)
        self.assertEqual(scoped_project.directory_id, directory.id)
        self.assertEqual(scoped_project.directory_local_path, "/tmp/client-work")
        self.assertEqual(directories[0].local_path, "/tmp/client-work")
        self.assertEqual(directories[0].project_count, 1)

    def test_export_yaml_includes_project_workdir_context(self) -> None:
        directory = create_project_directory(
            CreateDirectoryRequest(name="Client Work", local_path="/tmp/client-work")
        )
        project = create_project(
            CreateProjectRequest(
                title="scoped",
                origin="origin",
                goal="goal",
                directory_id=directory.id,
            )
        )

        with db.get_conn() as conn:
            exported = yaml.safe_load(_export_yaml(conn, project.project.id))

        self.assertEqual(exported["project"]["directory_id"], directory.id)
        self.assertEqual(exported["project"]["directory_local_path"], "/tmp/client-work")
        self.assertEqual(exported["project"]["current_working_directory"], "/tmp/client-work")

    def test_existing_uncategorized_project_can_be_assigned_to_directory(self) -> None:
        directory = create_project_directory(
            CreateDirectoryRequest(name="Client Work")
        )
        project = create_project(
            CreateProjectRequest(
                title="existing uncategorized",
                origin="origin",
                goal="goal",
            )
        )

        updated = update_project_directory_assignment(
            project.project.id,
            UpdateProjectDirectoryRequest(directory_id=directory.id),
        )
        projects = list_projects()
        directories = list_project_directories()

        scoped_project = next(p for p in projects if p.id == project.project.id)
        self.assertEqual(updated.directory_id, directory.id)
        self.assertEqual(scoped_project.directory_id, directory.id)
        self.assertEqual(directories[0].project_count, 1)

    def test_project_can_be_favorited_and_lists_first(self) -> None:
        first = create_project(
            CreateProjectRequest(title="first", origin="origin", goal="goal")
        )
        second = create_project(
            CreateProjectRequest(title="second", origin="origin", goal="goal")
        )

        updated = update_project_favorite(
            second.project.id,
            UpdateProjectFavoriteRequest(favorite=True),
        )
        projects = list_projects()

        self.assertTrue(updated.favorite)
        self.assertEqual(projects[0].id, second.project.id)
        self.assertTrue(projects[0].favorite)
        self.assertEqual(projects[1].id, first.project.id)
        self.assertFalse(projects[1].favorite)

    def test_project_directory_can_be_cleared_and_deleted(self) -> None:
        directory = create_project_directory(CreateDirectoryRequest(name="Archive"))
        project = create_project(
            CreateProjectRequest(
                title="archive target",
                origin="origin",
                goal="goal",
                directory_id=directory.id,
            )
        )

        updated = update_project_directory_assignment(
            project.project.id,
            UpdateProjectDirectoryRequest(directory_id=None),
        )
        delete_project_directory(directory.id)

        self.assertIsNone(updated.directory_id)
        self.assertNotIn(directory.id, [d.id for d in list_project_directories()])
