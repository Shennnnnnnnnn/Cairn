from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

DEFAULT_DB = Path.home() / ".local" / "share" / "cairn" / "cairn.db"

_db_path: Path | None = None

SCHEMA = """\
CREATE TABLE IF NOT EXISTS settings (
    intent_timeout INTEGER NOT NULL DEFAULT 15,
    reason_timeout INTEGER NOT NULL DEFAULT 15
);

INSERT OR IGNORE INTO settings (rowid, intent_timeout, reason_timeout) VALUES (1, 15, 15);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    directory_id TEXT REFERENCES project_directories(id) ON DELETE SET NULL,
    favorite INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    bootstrap_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    run_started_at TEXT,
    accumulated_run_ms INTEGER NOT NULL DEFAULT 0,
    scheduled_start_at TEXT,
    reason_worker TEXT,
    reason_trigger TEXT,
    reason_started_at TEXT,
    reason_last_heartbeat_at TEXT
);

CREATE TABLE IF NOT EXISTS project_directories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    local_path TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT,
    description TEXT NOT NULL,
    PRIMARY KEY (id, project_id)
);

CREATE TABLE IF NOT EXISTS intents (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    to_fact_id TEXT,
    title TEXT,
    description TEXT NOT NULL,
    creator TEXT NOT NULL,
    worker TEXT,
    last_heartbeat_at TEXT,
    created_at TEXT NOT NULL,
    concluded_at TEXT,
    PRIMARY KEY (id, project_id)
);

CREATE TABLE IF NOT EXISTS intent_sources (
    intent_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    fact_id TEXT NOT NULL,
    PRIMARY KEY (intent_id, project_id, fact_id),
    FOREIGN KEY (intent_id, project_id) REFERENCES intents(id, project_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS hints (
    id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    creator TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (id, project_id)
);

CREATE TABLE IF NOT EXISTS counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO counters (name, value) VALUES ('project', 0);
INSERT OR IGNORE INTO counters (name, value) VALUES ('directory', 0);

CREATE TABLE IF NOT EXISTS scoped_counters (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, kind)
);
"""


def configure(path: Path) -> None:
    global _db_path
    if _db_path is not None:
        return
    _db_path = path
    _db_path.parent.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)


def _migrate(conn: sqlite3.Connection) -> None:
    project_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(projects)").fetchall()
    }
    if "scheduled_start_at" not in project_columns:
        conn.execute("ALTER TABLE projects ADD COLUMN scheduled_start_at TEXT")
    if "bootstrap_enabled" not in project_columns:
        conn.execute("ALTER TABLE projects ADD COLUMN bootstrap_enabled INTEGER NOT NULL DEFAULT 1")
        if "bootstrap_mode" in project_columns:
            conn.execute(
                "UPDATE projects SET bootstrap_enabled = CASE WHEN bootstrap_mode = 'disabled' THEN 0 ELSE 1 END"
            )
    if "directory_id" not in project_columns:
        conn.execute(
            "ALTER TABLE projects ADD COLUMN directory_id TEXT REFERENCES project_directories(id) ON DELETE SET NULL"
        )
    if "favorite" not in project_columns:
        conn.execute("ALTER TABLE projects ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0")
    if "run_started_at" not in project_columns:
        conn.execute("ALTER TABLE projects ADD COLUMN run_started_at TEXT")
    if "accumulated_run_ms" not in project_columns:
        conn.execute("ALTER TABLE projects ADD COLUMN accumulated_run_ms INTEGER NOT NULL DEFAULT 0")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS project_directories (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            local_path TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    directory_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(project_directories)").fetchall()
    }
    if "local_path" not in directory_columns:
        conn.execute("ALTER TABLE project_directories ADD COLUMN local_path TEXT")
    conn.execute("INSERT OR IGNORE INTO counters (name, value) VALUES ('directory', 0)")

    fact_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(facts)").fetchall()
    }
    if "title" not in fact_columns:
        conn.execute("ALTER TABLE facts ADD COLUMN title TEXT")

    intent_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(intents)").fetchall()
    }
    if "title" not in intent_columns:
        conn.execute("ALTER TABLE intents ADD COLUMN title TEXT")


@contextmanager
def get_conn() -> Generator[sqlite3.Connection, None, None]:
    assert _db_path is not None
    conn = sqlite3.connect(str(_db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
