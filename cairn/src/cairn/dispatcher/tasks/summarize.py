from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Literal

from cairn.dispatcher.config import DispatchConfig, WorkerConfig
from cairn.dispatcher.contracts import parse_json_output, validate_summary_payload
from cairn.dispatcher.prompting import load_prompt, render_prompt
from cairn.dispatcher.protocol.client import CairnClient
from cairn.dispatcher.runtime.cancellation import TaskCancellation
from cairn.dispatcher.runtime.containers import ContainerManager
from cairn.dispatcher.tasks.common import cancel_reason, did_timeout, preview, run_healthcheck, run_worker_process
from cairn.dispatcher.workers.registry import get_driver

LOG = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class SummaryTarget:
    kind: Literal["fact", "intent"]
    id: str
    description: str


def run_summarize_task(
    config: DispatchConfig,
    client: CairnClient,
    container_manager: ContainerManager,
    project_id: str,
    worker: WorkerConfig,
    target: SummaryTarget,
    cancellation: TaskCancellation,
) -> str:
    driver = get_driver(worker.type)
    task_started = time.perf_counter()
    try:
        container_name = container_manager.ensure_running(project_id)
        healthcheck = run_healthcheck(
            container_manager,
            container_name,
            worker,
            driver.build_healthcheck(worker),
            timeout_seconds=config.runtime.healthcheck_timeout,
            cancellation=cancellation,
        )
        cancelled = cancel_reason(healthcheck.result, cancellation)
        if cancelled is not None:
            LOG.info("summary cancelled during healthcheck project=%s target=%s:%s worker=%s", project_id, target.kind, target.id, worker.name)
            return "cancelled"
        if healthcheck.result.returncode != 0:
            LOG.warning(
                "summary worker unhealthy project=%s target=%s:%s worker=%s stderr=%s",
                project_id,
                target.kind,
                target.id,
                worker.name,
                preview(healthcheck.result.stderr),
            )
            return "unhealthy"

        prompt = render_prompt(
            load_prompt(config.runtime.prompt_group, "summary.md"),
            {
                "kind": target.kind,
                "id": target.id,
                "description": target.description,
            },
        )
        command = driver.build_execute(worker, prompt, driver.prepare_session())
        result = run_worker_process(
            container_manager,
            container_name,
            worker,
            command.argv,
            phase="summary",
            timeout_seconds=config.tasks.summarize.timeout,
            cancellation=cancellation,
        )
        total_ms = int((time.perf_counter() - task_started) * 1000)
        cancelled = cancel_reason(result, cancellation)
        if cancelled is not None:
            LOG.info("summary cancelled project=%s target=%s:%s worker=%s reason=%s", project_id, target.kind, target.id, worker.name, cancelled)
            return "cancelled"
        if did_timeout(result):
            LOG.warning("summary timed out project=%s target=%s:%s worker=%s total_ms=%s", project_id, target.kind, target.id, worker.name, total_ms)
            return "failed"
        if result.returncode != 0:
            LOG.warning(
                "summary command failed project=%s target=%s:%s worker=%s code=%s stdout_preview=%s stderr_preview=%s",
                project_id,
                target.kind,
                target.id,
                worker.name,
                result.returncode,
                preview(result.stdout),
                preview(result.stderr),
            )
            return "failed"
        try:
            model_output = driver.extract_response_text(result.stdout, result.stderr)
            payload = parse_json_output(model_output)
            kind, title = validate_summary_payload(payload, source_description=target.description)
        except Exception as exc:
            LOG.warning(
                "summary parse failed project=%s target=%s:%s worker=%s error=%s stdout_preview=%s stderr_preview=%s",
                project_id,
                target.kind,
                target.id,
                worker.name,
                exc,
                preview(result.stdout),
                preview(result.stderr),
            )
            return "failed"
        if kind == "rejected":
            return "rejected"
        assert title is not None
        if target.kind == "fact":
            response = client.update_fact_title(project_id, target.id, title)
        else:
            response = client.update_intent_title(project_id, target.id, title)
        if not response.ok:
            LOG.warning(
                "summary title write failed project=%s target=%s:%s worker=%s status=%s body=%s",
                project_id,
                target.kind,
                target.id,
                worker.name,
                response.status_code,
                response.text,
            )
            return "failed"
        LOG.info("summary wrote title project=%s target=%s:%s worker=%s title=%s", project_id, target.kind, target.id, worker.name, title)
        return "success"
    except Exception:
        LOG.exception("summary task crashed project=%s target=%s:%s worker=%s", project_id, target.kind, target.id, worker.name)
        return "failed"
