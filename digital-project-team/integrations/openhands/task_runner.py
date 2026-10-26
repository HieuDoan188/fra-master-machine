"""TaskRunner - drives a single SDLC task through the OpenHands adapter."""

from dataclasses import dataclass, field

from integrations.openhands.client import ExecutionResult, OpenHandsAdapter
from integrations.openhands.session_manager import SessionManager
from integrations.openhands.workspace_manager import WorkspaceManager


@dataclass
class TaskSpec:
    item_id: str
    description: str
    repo_path: str
    mvs: list = field(default_factory=list)
    test_command: str = "pytest"


class TaskRunner:
    """Runs one task end-to-end: prepare workspace -> execute -> collect result."""

    def __init__(self, adapter: OpenHandsAdapter | None = None, session_manager: SessionManager | None = None):
        self.adapter = adapter or OpenHandsAdapter()
        self.sessions = session_manager or SessionManager(self.adapter)
        self.workspaces = WorkspaceManager()

    def run(self, spec: TaskSpec) -> ExecutionResult:
        workspace = self.workspaces.prepare(spec.repo_path, spec.item_id)
        session_id = self.sessions.acquire(workspace)
        try:
            prompt = self._build_prompt(spec)
            return self.adapter.execute_task(prompt, workspace, session_id)
        finally:
            self.sessions.release(session_id)

    def _build_prompt(self, spec: TaskSpec) -> str:
        parts = [
            f"Item: {spec.item_id}",
            f"Description: {spec.description}",
        ]
        if spec.mvs:
            parts.append("MVS:")
            for i, m in enumerate(spec.mvs, 1):
                parts.append(f"  {i}. {m}")
        parts.append("Follow repository conventions. Minimize changes. Do not rewrite architecture.")
        return "\n".join(parts)