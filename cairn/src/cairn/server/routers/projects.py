import sqlite3

from fastapi import APIRouter, HTTPException

from cairn.server.db import get_conn
from cairn.server.models import (
    CompleteRequest,
    CreateDirectoryRequest,
    CreateProjectRequest,
    Fact,
    Hint,
    HeartbeatRequest,
    Intent,
    ProjectDirectory,
    ProjectDetail,
    ProjectMeta,
    ProjectSummary,
    ReopenRequest,
    ReopenResponse,
    ReasonClaimRequest,
    UpdateDirectoryRequest,
    UpdateProjectDirectoryRequest,
    UpdateProjectFavoriteRequest,
    UpdateProjectTitleRequest,
    UpdateProjectStatusRequest,
    UpdateTitleRequest,
)
from cairn.server.services import (
    build_intents,
    check_project_completed,
    check_project_active,
    clear_project_reason,
    expire_reason_leases,
    expire_workers,
    get_completion_intent_or_409,
    get_directory_or_404,
    get_intent_or_404,
    get_project_or_404,
    intent_to_model,
    next_directory_id,
    next_fact_id,
    next_hint_id,
    next_intent_id,
    next_project_id,
    project_meta_from_row,
    project_reason_from_row,
    project_running_time_ms,
    run_started_at_for_schedule,
    settle_project_running_time,
    utcnow,
    validate_facts_exist,
    validate_goal_not_in_sources,
)

router = APIRouter(tags=["projects"])


@router.get("/project-directories", response_model=list[ProjectDirectory])
def list_project_directories():
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT d.*,
                (SELECT COUNT(*) FROM projects WHERE directory_id = d.id) AS project_count
            FROM project_directories d
            ORDER BY lower(d.name), d.created_at
        """).fetchall()
        return [ProjectDirectory(**dict(row)) for row in rows]


@router.post("/project-directories", response_model=ProjectDirectory, status_code=201)
def create_project_directory(body: CreateDirectoryRequest):
    with get_conn() as conn:
        directory_id = next_directory_id(conn)
        now = utcnow()
        try:
            conn.execute(
                "INSERT INTO project_directories (id, name, local_path, created_at) VALUES (?, ?, ?, ?)",
                (directory_id, body.name, body.local_path, now),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Directory name already exists") from exc
        return ProjectDirectory(
            id=directory_id,
            name=body.name,
            local_path=body.local_path,
            created_at=now,
            project_count=0,
        )


@router.put("/project-directories/{directory_id}", response_model=ProjectDirectory)
def update_project_directory(directory_id: str, body: UpdateDirectoryRequest):
    with get_conn() as conn:
        get_directory_or_404(conn, directory_id)
        assignments = []
        params = []
        if "name" in body.model_fields_set:
            assignments.append("name = ?")
            params.append(body.name)
        if "local_path" in body.model_fields_set:
            assignments.append("local_path = ?")
            params.append(body.local_path)
        if not assignments:
            raise HTTPException(400, "No directory fields provided")
        params.append(directory_id)
        try:
            conn.execute(
                f"UPDATE project_directories SET {', '.join(assignments)} WHERE id = ?",
                tuple(params),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "Directory name already exists") from exc
        row = conn.execute(
            """
            SELECT d.*,
                (SELECT COUNT(*) FROM projects WHERE directory_id = d.id) AS project_count
            FROM project_directories d
            WHERE d.id = ?
            """,
            (directory_id,),
        ).fetchone()
        return ProjectDirectory(**dict(row))


@router.delete("/project-directories/{directory_id}", status_code=204)
def delete_project_directory(directory_id: str):
    with get_conn() as conn:
        get_directory_or_404(conn, directory_id)
        conn.execute(
            "UPDATE projects SET directory_id = NULL WHERE directory_id = ?",
            (directory_id,),
        )
        conn.execute("DELETE FROM project_directories WHERE id = ?", (directory_id,))


@router.get("/projects", response_model=list[ProjectSummary])
def list_projects():
    with get_conn() as conn:
        expire_workers(conn)
        expire_reason_leases(conn)
        rows = conn.execute("""
            SELECT p.*,
                (SELECT local_path FROM project_directories WHERE id = p.directory_id) AS directory_local_path,
                (SELECT COUNT(*) FROM facts WHERE project_id = p.id) AS fact_count,
                (SELECT COUNT(*) FROM intents WHERE project_id = p.id) AS intent_count,
                (SELECT COUNT(*) FROM intents WHERE project_id = p.id AND concluded_at IS NULL AND worker IS NOT NULL) AS working_intent_count,
                (SELECT COUNT(*) FROM intents WHERE project_id = p.id AND concluded_at IS NULL AND worker IS NULL) AS unclaimed_intent_count,
                (SELECT COUNT(*) FROM hints WHERE project_id = p.id) AS hint_count
            FROM projects p
            ORDER BY p.favorite DESC, p.created_at
        """).fetchall()
        return [
            ProjectSummary(
                id=row["id"],
                title=row["title"],
                directory_id=row["directory_id"],
                directory_local_path=row["directory_local_path"],
                favorite=bool(row["favorite"]),
                status=row["status"],
                bootstrap_enabled=bool(row["bootstrap_enabled"]),
                created_at=row["created_at"],
                running_time_ms=project_running_time_ms(row),
                scheduled_start_at=row["scheduled_start_at"],
                reason=project_reason_from_row(row),
                fact_count=row["fact_count"],
                intent_count=row["intent_count"],
                working_intent_count=row["working_intent_count"],
                unclaimed_intent_count=row["unclaimed_intent_count"],
                hint_count=row["hint_count"],
            )
            for row in rows
        ]


@router.post("/projects", response_model=ProjectDetail, status_code=201)
def create_project(body: CreateProjectRequest):
    with get_conn() as conn:
        if body.directory_id is not None:
            get_directory_or_404(conn, body.directory_id)
        pid = next_project_id(conn)
        now = utcnow()

        conn.execute(
            "INSERT INTO projects (id, title, directory_id, status, bootstrap_enabled, created_at, run_started_at, scheduled_start_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)",
            (
                pid,
                body.title,
                body.directory_id,
                body.bootstrap_enabled,
                now,
                run_started_at_for_schedule(body.scheduled_start_at, now),
                body.scheduled_start_at,
            ),
        )
        conn.execute(
            "INSERT INTO facts (id, project_id, description) VALUES (?, ?, ?)",
            ("origin", pid, body.origin),
        )
        conn.execute(
            "INSERT INTO facts (id, project_id, description) VALUES (?, ?, ?)",
            ("goal", pid, body.goal),
        )

        hints = []
        if body.hints:
            for h in body.hints:
                hid = next_hint_id(conn, pid)
                conn.execute(
                    "INSERT INTO hints (id, project_id, content, creator, created_at) VALUES (?, ?, ?, ?, ?)",
                    (hid, pid, h.content, h.creator, now),
                )
                hints.append(Hint(id=hid, content=h.content, creator=h.creator, created_at=now))

        return ProjectDetail(
            project=ProjectMeta(
                id=pid,
                title=body.title,
                directory_id=body.directory_id,
                directory_local_path=get_directory_or_404(conn, body.directory_id)["local_path"] if body.directory_id is not None else None,
                favorite=False,
                status="active",
                bootstrap_enabled=body.bootstrap_enabled,
                created_at=now,
                running_time_ms=0,
                scheduled_start_at=body.scheduled_start_at,
                reason=None,
            ),
            facts=[
                Fact(id="origin", title=None, description=body.origin),
                Fact(id="goal", title=None, description=body.goal),
            ],
            intents=[],
            hints=hints,
        )


@router.get("/projects/{project_id}", response_model=ProjectDetail)
def get_project(project_id: str):
    with get_conn() as conn:
        expire_workers(conn, project_id)
        expire_reason_leases(conn, project_id)
        row = conn.execute(
            """
            SELECT p.*,
                (SELECT local_path FROM project_directories WHERE id = p.directory_id) AS directory_local_path
            FROM projects p
            WHERE p.id = ?
            """,
            (project_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Project not found")

        facts = conn.execute(
            "SELECT * FROM facts WHERE project_id = ?", (project_id,)
        ).fetchall()
        hints = conn.execute(
            "SELECT * FROM hints WHERE project_id = ? ORDER BY created_at",
            (project_id,),
        ).fetchall()

        return ProjectDetail(
            project=project_meta_from_row(row),
            facts=[Fact(**dict(f)) for f in facts],
            intents=build_intents(conn, project_id),
            hints=[Hint(**dict(h)) for h in hints],
        )


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: str):
    with get_conn() as conn:
        get_project_or_404(conn, project_id)
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))


@router.put("/projects/{project_id}/title", response_model=ProjectMeta)
def update_project_title(project_id: str, body: UpdateProjectTitleRequest):
    with get_conn() as conn:
        get_project_or_404(conn, project_id)
        conn.execute(
            "UPDATE projects SET title = ? WHERE id = ?",
            (body.title, project_id),
        )
        updated = conn.execute(
            """
            SELECT p.*,
                (SELECT local_path FROM project_directories WHERE id = p.directory_id) AS directory_local_path
            FROM projects p
            WHERE p.id = ?
            """,
            (project_id,),
        ).fetchone()
        return project_meta_from_row(updated)


@router.put("/projects/{project_id}/favorite", response_model=ProjectMeta)
def update_project_favorite(project_id: str, body: UpdateProjectFavoriteRequest):
    with get_conn() as conn:
        get_project_or_404(conn, project_id)
        conn.execute(
            "UPDATE projects SET favorite = ? WHERE id = ?",
            (1 if body.favorite else 0, project_id),
        )
        updated = conn.execute(
            """
            SELECT p.*,
                (SELECT local_path FROM project_directories WHERE id = p.directory_id) AS directory_local_path
            FROM projects p
            WHERE p.id = ?
            """,
            (project_id,),
        ).fetchone()
        return project_meta_from_row(updated)


@router.patch("/projects/{project_id}/directory", response_model=ProjectMeta)
@router.put("/projects/{project_id}/directory", response_model=ProjectMeta)
def update_project_directory_assignment(
    project_id: str, body: UpdateProjectDirectoryRequest
):
    with get_conn() as conn:
        get_project_or_404(conn, project_id)
        if body.directory_id is not None:
            get_directory_or_404(conn, body.directory_id)
        conn.execute(
            "UPDATE projects SET directory_id = ? WHERE id = ?",
            (body.directory_id, project_id),
        )
        updated = conn.execute(
            """
            SELECT p.*,
                (SELECT local_path FROM project_directories WHERE id = p.directory_id) AS directory_local_path
            FROM projects p
            WHERE p.id = ?
            """,
            (project_id,),
        ).fetchone()
        return project_meta_from_row(updated)


@router.put("/projects/{project_id}/status", response_model=ProjectMeta)
def update_project_status(project_id: str, body: UpdateProjectStatusRequest):
    with get_conn() as conn:
        expire_reason_leases(conn, project_id)
        row = get_project_or_404(conn, project_id)
        current_status = row["status"]
        if current_status == "completed":
            raise HTTPException(409, "Completed projects cannot change status")
        if current_status == body.status and row["scheduled_start_at"] == body.scheduled_start_at:
            return project_meta_from_row(row)

        now = utcnow()
        accumulated_run_ms = project_running_time_ms(row, now)
        if body.status == "active":
            run_started_at = run_started_at_for_schedule(body.scheduled_start_at, now)
            scheduled_start_at = body.scheduled_start_at
        else:
            run_started_at = None
            scheduled_start_at = None

        conn.execute(
            """
            UPDATE projects
            SET status = ?,
                scheduled_start_at = ?,
                run_started_at = ?,
                accumulated_run_ms = ?
            WHERE id = ?
            """,
            (
                body.status,
                scheduled_start_at,
                run_started_at,
                accumulated_run_ms,
                project_id,
            ),
        )
        if body.status == "stopped":
            conn.execute(
                "UPDATE intents SET worker = NULL WHERE project_id = ? AND concluded_at IS NULL",
                (project_id,),
            )
            clear_project_reason(conn, project_id)
        updated = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return project_meta_from_row(updated)


@router.post("/projects/{project_id}/reason/claim", response_model=ProjectMeta)
def claim_project_reason(project_id: str, body: ReasonClaimRequest):
    with get_conn() as conn:
        check_project_active(conn, project_id)
        expire_reason_leases(conn, project_id)
        row = get_project_or_404(conn, project_id)
        current_worker = row["reason_worker"]
        if current_worker is not None and current_worker != body.worker:
            raise HTTPException(409, f"Project reason is currently claimed by {current_worker}")
        if current_worker == body.worker:
            return project_meta_from_row(row)

        now = utcnow()
        conn.execute(
            """
            UPDATE projects
            SET reason_worker = ?,
                reason_trigger = ?,
                reason_started_at = ?,
                reason_last_heartbeat_at = ?
            WHERE id = ?
            """,
            (body.worker, body.trigger, now, now, project_id),
        )
        updated = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return project_meta_from_row(updated)


@router.post("/projects/{project_id}/reason/heartbeat", response_model=ProjectMeta)
def heartbeat_project_reason(project_id: str, body: HeartbeatRequest):
    with get_conn() as conn:
        check_project_active(conn, project_id)
        expire_reason_leases(conn, project_id)
        row = get_project_or_404(conn, project_id)
        current_worker = row["reason_worker"]
        if current_worker is None:
            raise HTTPException(409, "Project reason is not currently claimed")
        if current_worker != body.worker:
            raise HTTPException(409, f"Project reason is currently claimed by {current_worker}")

        now = utcnow()
        conn.execute(
            "UPDATE projects SET reason_last_heartbeat_at = ? WHERE id = ?",
            (now, project_id),
        )
        updated = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return project_meta_from_row(updated)


@router.post("/projects/{project_id}/reason/release", response_model=ProjectMeta)
def release_project_reason(project_id: str, body: HeartbeatRequest):
    with get_conn() as conn:
        check_project_active(conn, project_id)
        expire_reason_leases(conn, project_id)
        row = get_project_or_404(conn, project_id)
        current_worker = row["reason_worker"]
        if current_worker is None:
            return project_meta_from_row(row)
        if current_worker != body.worker:
            raise HTTPException(409, f"Project reason is currently claimed by {current_worker}")

        clear_project_reason(conn, project_id)
        updated = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return project_meta_from_row(updated)


@router.post("/projects/{project_id}/complete", response_model=Intent)
def complete_project(project_id: str, body: CompleteRequest):
    with get_conn() as conn:
        check_project_active(conn, project_id)
        expire_reason_leases(conn, project_id)
        validate_facts_exist(conn, project_id, body.from_)
        validate_goal_not_in_sources(body.from_)

        now = utcnow()
        settle_project_running_time(conn, project_id, now)
        iid = next_intent_id(conn, project_id)

        conn.execute(
            "INSERT INTO intents (id, project_id, to_fact_id, description, creator, worker, last_heartbeat_at, created_at, concluded_at) VALUES (?, ?, 'goal', ?, ?, ?, ?, ?, ?)",
            (iid, project_id, body.description, body.worker, body.worker, now, now, now),
        )
        for fid in body.from_:
            conn.execute(
                "INSERT INTO intent_sources (intent_id, project_id, fact_id) VALUES (?, ?, ?)",
                (iid, project_id, fid),
            )
        conn.execute(
            """
            UPDATE projects
            SET status = 'completed',
                scheduled_start_at = NULL,
                run_started_at = NULL,
                reason_worker = NULL,
                reason_trigger = NULL,
                reason_started_at = NULL,
                reason_last_heartbeat_at = NULL
            WHERE id = ?
            """,
            (project_id,),
        )

        return Intent(
            id=iid,
            **{"from": body.from_},
            to="goal",
            title=None,
            description=body.description,
            creator=body.worker,
            worker=body.worker,
            last_heartbeat_at=now,
            created_at=now,
            concluded_at=now,
        )


@router.post("/projects/{project_id}/reopen", response_model=ReopenResponse, response_model_exclude_none=True)
def reopen_project(project_id: str, body: ReopenRequest):
    with get_conn() as conn:
        expire_reason_leases(conn, project_id)
        check_project_completed(conn, project_id)
        completion = get_completion_intent_or_409(conn, project_id)

        source_rows = conn.execute(
            "SELECT fact_id FROM intent_sources WHERE intent_id = ? AND project_id = ? ORDER BY rowid",
            (completion["id"], project_id),
        ).fetchall()
        source_ids = [row["fact_id"] for row in source_rows]
        if not source_ids:
            raise HTTPException(409, "Completion intent is missing its source facts")

        now = utcnow()
        fact_id = next_fact_id(conn, project_id)
        intent_id = next_intent_id(conn, project_id)
        description = body.description
        creator = body.creator

        conn.execute(
            "DELETE FROM intents WHERE id = ? AND project_id = ?",
            (completion["id"], project_id),
        )
        conn.execute(
            "INSERT INTO facts (id, project_id, description) VALUES (?, ?, ?)",
            (fact_id, project_id, description),
        )
        conn.execute(
            "INSERT INTO intents (id, project_id, to_fact_id, description, creator, worker, last_heartbeat_at, created_at, concluded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (intent_id, project_id, fact_id, "external_feedback", creator, creator, now, now, now),
        )
        for source_id in source_ids:
            conn.execute(
                "INSERT INTO intent_sources (intent_id, project_id, fact_id) VALUES (?, ?, ?)",
                (intent_id, project_id, source_id),
            )
        clear_project_reason(conn, project_id)
        conn.execute(
            "UPDATE projects SET status = 'active', run_started_at = ?, scheduled_start_at = ? WHERE id = ?",
            (
                run_started_at_for_schedule(body.scheduled_start_at, now),
                body.scheduled_start_at,
                project_id,
            ),
        )

        updated_project = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        updated_intent = conn.execute(
            "SELECT * FROM intents WHERE id = ? AND project_id = ?",
            (intent_id, project_id),
        ).fetchone()
        assert updated_project is not None
        assert updated_intent is not None
        return ReopenResponse(
            project=project_meta_from_row(updated_project),
            fact=Fact(id=fact_id, description=description),
            intent=intent_to_model(conn, updated_intent, project_id),
        )


@router.put("/projects/{project_id}/facts/{fact_id}/title", response_model=Fact)
def update_fact_title(project_id: str, fact_id: str, body: UpdateTitleRequest):
    with get_conn() as conn:
        get_project_or_404(conn, project_id)
        row = conn.execute(
            "SELECT * FROM facts WHERE id = ? AND project_id = ?",
            (fact_id, project_id),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Fact not found")
        conn.execute(
            "UPDATE facts SET title = ? WHERE id = ? AND project_id = ?",
            (body.title, fact_id, project_id),
        )
        updated = conn.execute(
            "SELECT * FROM facts WHERE id = ? AND project_id = ?",
            (fact_id, project_id),
        ).fetchone()
        return Fact(**dict(updated))


@router.put("/projects/{project_id}/intents/{intent_id}/title", response_model=Intent)
def update_intent_title(project_id: str, intent_id: str, body: UpdateTitleRequest):
    with get_conn() as conn:
        get_project_or_404(conn, project_id)
        row = get_intent_or_404(conn, project_id, intent_id)
        conn.execute(
            "UPDATE intents SET title = ? WHERE id = ? AND project_id = ?",
            (body.title, intent_id, project_id),
        )
        updated = conn.execute(
            "SELECT * FROM intents WHERE id = ? AND project_id = ?",
            (row["id"], project_id),
        ).fetchone()
        return intent_to_model(conn, updated, project_id)
