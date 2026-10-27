"""RealAdapter - actually applies fixes and runs pytest for real.

Swaps the mock executor for a real one: applies the fix patch to the
workspace copy, runs the repo's pytest suite, and reports real results.
"""

import subprocess
import time

from integrations.openhands.client import AdapterConfig, ExecutionResult, OpenHandsAdapter
from simulator.fix_patches import FIX_PATCHES


class RealAdapter(OpenHandsAdapter):
    def __init__(self, patches: dict | None = None):
        super().__init__(AdapterConfig(mock=False))
        self.patches = patches or FIX_PATCHES
        self.last_workspace = ""
        self._pytest_cache: dict[str, tuple[bool, str]] = {}

    def create_session(self, workspace_path: str) -> str:
        return "real-local-session"

    def invalidate_cache(self) -> None:
        self._pytest_cache.clear()

    def execute_task(self, task: str, workspace_path: str, session_id: str = "") -> ExecutionResult:
        started = time.monotonic()
        self.last_workspace = workspace_path
        item_id = self._extract_item_id(task)
        patch = self.patches.get(item_id)
        if patch is None:
            return ExecutionResult(success=False, output=f"no patch for {item_id}", session_id=session_id)
        applied = self._apply_patch(workspace_path, patch)
        if not applied:
            return ExecutionResult(success=False, output=f"patch apply failed for {item_id}", session_id=session_id)
        passed, output = self._run_pytest(workspace_path, item_id)
        return ExecutionResult(
            success=passed,
            output=output,
            patch=str(patch),
            session_id=session_id,
            duration_seconds=round(time.monotonic() - started, 2),
        )

    def _extract_item_id(self, task: str) -> str:
        for line in task.splitlines():
            if line.startswith("Item:"):
                return line.split(":", 1)[1].strip()
        return ""

    def _apply_patch(self, workspace_path: str, patch: dict) -> bool:
        target = f"{workspace_path}/{patch['file']}"
        try:
            text = open(target).read()
        except OSError:
            return False
        if patch["old"] not in text:
            return False
        open(target, "w").write(text.replace(patch["old"], patch["new"]))
        return True

    def _run_pytest(self, workspace_path: str, item_id: str = "") -> tuple[bool, str]:
        cache_key = f"{workspace_path}:{item_id}"
        if cache_key in self._pytest_cache:
            return self._pytest_cache[cache_key]
        test_file = f"tests/test_{item_id.lower()}.py" if item_id else "tests"
        proc = subprocess.run(
            ["python3", "-m", "pytest", "-q", "--tb=short", "-c", "/dev/null", test_file],
            cwd=workspace_path,
            capture_output=True,
            text=True,
            timeout=300,
        )
        output = proc.stdout.strip() or proc.stderr.strip()
        result = (proc.returncode == 0, output[-2000:])
        self._pytest_cache[cache_key] = result
        return result