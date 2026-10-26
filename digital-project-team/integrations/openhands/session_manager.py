"""SessionManager - owns OpenHands session lifecycle."""

from integrations.openhands.client import OpenHandsAdapter


class SessionManager:
    """Creates, pools and closes OpenHands sessions.

    Sessions are expensive; reuse them across tasks on the same workspace.
    """

    def __init__(self, adapter: OpenHandsAdapter):
        self.adapter = adapter
        self._active: dict[str, str] = {}

    def acquire(self, workspace_path: str) -> str:
        for sid, ws in self._active.items():
            if ws == workspace_path:
                return sid
        sid = self.adapter.create_session(workspace_path)
        self._active[sid] = workspace_path
        return sid

    def release(self, session_id: str) -> None:
        self._active.pop(session_id, None)

    def close_all(self) -> None:
        self._active.clear()