from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from cairn.server import db
from cairn.server.models import CreateProjectRequest
from cairn.server.routers.projects import create_project, list_projects


class ProjectTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmpdir = tempfile.TemporaryDirectory()
        db.configure(Path(cls._tmpdir.name) / "cairn.db")

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmpdir.cleanup()

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
