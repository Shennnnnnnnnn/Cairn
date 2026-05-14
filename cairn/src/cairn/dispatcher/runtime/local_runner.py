"""
LocalProcessManager: a drop-in replacement for ContainerManager that runs
worker commands directly on the host instead of inside Docker containers.

Usage in dispatch.yaml:
    container:
      runner: "local"          # add this line to enable local mode
      image: "..."             # still required by config schema, but ignored
      network_mode: "host"     # ignored
      completed_action: "stop" # ignored
"""
from __future__ import annotations

import logging
import os
import signal
import subprocess
import threading
import time
from dataclasses import dataclass

from cairn.dispatcher.config import ContainerConfig
from cairn.dispatcher.runtime.process import ProcessResult

LOG = logging.getLogger(__name__)
EXEC_KILL_JOIN_TIMEOUT_SECONDS = 5.0


class LocalManagedProcess:
    """Mirrors the ManagedProcess interface but runs via subprocess on the host."""

    def __init__(
        self,
        command: list[str],
        env: dict[str, str],
        timeout_seconds: int | None = None,
        workdir: str | None = None,
    ):
        self.command = command
        self.env = env
        self._timeout_seconds = timeout_seconds
        self.workdir = workdir
        self._proc: subprocess.Popen | None = None
        self._stdout: list[str] = []
        self._stderr: list[str] = []
        self._returncode: int | None = None
        self._timed_out = False
        self._cancel_reason: str | None = None
        self._reader: threading.Thread | None = None
        self._done = threading.Event()

    def start(self) -> None:
        merged_env = {**os.environ, **self.env}
        self._proc = subprocess.Popen(
            self.command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,  # prevent interactive CLI tools from reading stdin
            env=merged_env,
            cwd=self.workdir,
            text=True,
            start_new_session=True,  # put in its own process group for clean kill
        )
        self._reader = threading.Thread(target=self._read_streams, daemon=True)
        self._reader.start()

    def communicate(self, timeout: float | None) -> ProcessResult:
        assert self._reader is not None
        # Use the stricter of the two timeouts
        effective_timeout = timeout
        if self._timeout_seconds is not None:
            if effective_timeout is None:
                effective_timeout = float(self._timeout_seconds)
            else:
                effective_timeout = min(effective_timeout, float(self._timeout_seconds))
        self._reader.join(timeout=effective_timeout)
        if self._reader.is_alive():
            self._timed_out = True
            self.kill()
            self._reader.join(timeout=EXEC_KILL_JOIN_TIMEOUT_SECONDS)
        self._done.wait(timeout=0)
        return ProcessResult(
            returncode=self._returncode if self._returncode is not None else 1,
            stdout="".join(self._stdout),
            stderr="".join(self._stderr),
            timed_out=self._timed_out,
            cancelled=self._cancel_reason is not None,
            cancel_reason=self._cancel_reason,
        )

    def kill(self) -> None:
        proc = self._proc
        if proc is None:
            return
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            try:
                proc.kill()
            except ProcessLookupError:
                pass

    def cancel(self, reason: str) -> None:
        if self._cancel_reason is None:
            self._cancel_reason = reason
        self.kill()

    def _read_streams(self) -> None:
        assert self._proc is not None
        assert self._proc.stdout is not None
        assert self._proc.stderr is not None
        stdout_thread = threading.Thread(target=self._read_pipe, args=(self._proc.stdout, self._stdout), daemon=True)
        stderr_thread = threading.Thread(target=self._read_pipe, args=(self._proc.stderr, self._stderr), daemon=True)
        stdout_thread.start()
        stderr_thread.start()
        stdout_thread.join()
        stderr_thread.join()
        self._returncode = self._proc.wait()
        self._done.set()

    @staticmethod
    def _read_pipe(pipe, buf: list[str]) -> None:
        for line in pipe:
            buf.append(line)


@dataclass(slots=True)
class _FakeContainer:
    """Placeholder so ContainerManager-style callers get a consistent object."""
    name: str


class LocalProcessManager:
    """
    Drop-in replacement for ContainerManager.
    All container lifecycle methods are no-ops; commands run directly on the host.
    """

    _PREFIX = "cairn-local-"
    _STARTUP_PREFIX = "cairn-local-startup-"

    def __init__(self, config: ContainerConfig):
        self._config = config

    def close(self) -> None:
        pass

    def container_name(self, project_id: str) -> str:
        sanitized = project_id.replace("/", "-")
        return f"{self._PREFIX}{sanitized}"

    def ensure_running(self, project_id: str) -> str:
        # Nothing to start — commands run on the host directly.
        return self.container_name(project_id)

    def create_startup_container(self) -> str:
        import uuid
        return f"{self._STARTUP_PREFIX}{uuid.uuid4().hex[:12]}"

    def inspect_state(self, name: str) -> str | None:
        return "running"

    def cleanup_completed(self, project_id: str) -> None:
        pass

    def cleanup_stopped(self, project_id: str) -> None:
        pass

    def cleanup_orphan(self, name: str) -> None:
        pass

    def managed_container_names(self) -> list[str]:
        return []

    def needs_completed_cleanup(self, project_id: str) -> bool:
        return False

    def needs_orphan_cleanup(self, name: str) -> bool:
        return False

    def needs_stopped_cleanup(self, project_id: str) -> bool:
        return False

    def remove_container(self, name: str, *, force: bool = True) -> None:
        pass

    def build_exec_process(
        self,
        container_name: str,
        env: dict[str, str],
        command: list[str],
        timeout_seconds: int | None = None,
        kill_after_seconds: int = 5,
        workdir: str | None = None,
    ) -> LocalManagedProcess:
        # On the host we don't wrap with the `timeout` binary (not available on macOS).
        # Instead, LocalManagedProcess.communicate() enforces the timeout natively.
        LOG.debug("local exec command=%s workdir=%s", command, workdir)
        return LocalManagedProcess(command, env, timeout_seconds=timeout_seconds, workdir=workdir)

    def write_text_file(self, container_name: str, path: str, content: str) -> None:
        """Write a text file directly to the host filesystem (local runner equivalent of ContainerManager.write_text_file)."""
        import pathlib
        target = pathlib.Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        LOG.debug("local write_text_file path=%s", path)
