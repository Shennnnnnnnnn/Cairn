from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import yaml

from cairn.server import db
from cairn.server.models import (
    CreateDirectoryRequest,
    CreateProjectRequest,
    UpdateProjectDirectoryRequest,
    UpdateProjectFavoriteRequest,
)
from cairn.server.routers.projects import (
    create_project,
    create_project_directory,
    delete_project_directory,
    list_project_directories,
    list_projects,
    update_project_favorite,
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
