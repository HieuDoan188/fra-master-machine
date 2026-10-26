"""WorkspaceManager - prepares isolated workspaces for OpenHands runs."""

import os
import shutil
import tempfile


class WorkspaceManager:
    """Copies a target repo into a per-item sandbox so squads never collide.

    Real matches run inside containers; this manager keeps the contract and
    defaults to a temp-dir copy so local development stays safe.
    """

    def __init__(self, base_dir: str | None = None):
        self.base_dir = base_dir or os.getenv("DPT_WORKSPACE_ROOT", "")

    def prepare(self, repo_path: str, item_id: str) -> str:
        if not os.path.isdir(repo_path):
            raise FileNotFoundError(f"repo not found: {repo_path}")
        if self.base_dir:
            os.makedirs(self.base_dir, exist_ok=True)
            workspace = os.path.join(self.base_dir, item_id)
        else:
            workspace = tempfile.mkdtemp(prefix=f"dpt-{item_id}-")
        if os.path.exists(workspace) and os.path.isdir(workspace) and os.listdir(workspace):
            shutil.rmtree(workspace)
        shutil.copytree(repo_path, workspace, dirs_exist_ok=True, ignore=shutil.ignore_patterns(".git", "__pycache__"))
        return workspace

    def cleanup(self, workspace_path: str) -> None:
        if self.base_dir and workspace_path.startswith(self.base_dir):
            shutil.rmtree(workspace_path, ignore_errors=True)