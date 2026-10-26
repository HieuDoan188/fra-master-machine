"""OpenHands adapter - the only place DPT talks to the OpenHands backend."""

import os
import time
import uuid
from dataclasses import dataclass, field

import requests


@dataclass
class AdapterConfig:
    base_url: str = os.getenv("OPENHANDS_BASE_URL", "http://localhost:3000")
    api_key: str = os.getenv("OPENHANDS_API_KEY", "")
    timeout_seconds: int = int(os.getenv("OPENHANDS_TIMEOUT_SECONDS", "600"))
    mock: bool = os.getenv("OPENHANDS_MOCK", "1") == "1"


@dataclass
class ExecutionResult:
    success: bool
    output: str = ""
    patch: str = ""
    session_id: str = ""
    duration_seconds: float = 0.0
    events: list = field(default_factory=list)


class OpenHandsAdapter:
    """Thin client over the OpenHands backend HTTP API.

    Keeps the coding engine behind a stable interface so DPT never depends on
    OpenHands internals. In mock mode (default) it simulates execution so the
    competition brain can be developed and tested without a live backend.
    """

    def __init__(self, config: AdapterConfig | None = None):
        self.config = config or AdapterConfig()

    def _headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        return headers

    def _post(self, path: str, payload: dict) -> dict:
        url = f"{self.config.base_url.rstrip('/')}{path}"
        resp = requests.post(url, json=payload, headers=self._headers(), timeout=self.config.timeout_seconds)
        resp.raise_for_status()
        return resp.json()

    def _get(self, path: str) -> dict:
        url = f"{self.config.base_url.rstrip('/')}{path}"
        resp = requests.get(url, headers=self._headers(), timeout=self.config.timeout_seconds)
        resp.raise_for_status()
        return resp.json()

    def health_check(self) -> bool:
        if self.config.mock:
            return True
        try:
            self._get("/api/health")
            return True
        except requests.RequestException:
            return False

    def create_session(self, workspace_path: str) -> str:
        if self.config.mock:
            return f"mock-session-{uuid.uuid4().hex[:8]}"
        data = self._post("/api/sessions", {"workspace_path": workspace_path})
        return data.get("session_id", "")

    def execute_task(self, task: str, workspace_path: str, session_id: str = "") -> ExecutionResult:
        started = time.monotonic()
        if self.config.mock:
            return ExecutionResult(
                success=True,
                output=f"[mock] executed task in {workspace_path}: {task[:80]}",
                patch="",
                session_id=session_id or "mock-session",
                duration_seconds=round(time.monotonic() - started, 2),
            )
        sid = session_id or self.create_session(workspace_path)
        data = self._post(f"/api/sessions/{sid}/actions", {"action": "message", "args": {"content": task}})
        return ExecutionResult(
            success=data.get("success", True),
            output=data.get("observation", ""),
            patch=data.get("patch", ""),
            session_id=sid,
            duration_seconds=round(time.monotonic() - started, 2),
        )

    def run_tests(self, workspace_path: str, session_id: str = "", test_command: str = "pytest") -> ExecutionResult:
        task = f"Run the test suite with `{test_command}` and report pass/fail counts."
        return self.execute_task(task, workspace_path, session_id)

    def create_patch(self, workspace_path: str, session_id: str = "") -> str:
        task = "Produce a unified git diff of all changes made in this workspace."
        result = self.execute_task(task, workspace_path, session_id)
        return result.patch