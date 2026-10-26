"""Task memory - per-item plan, checkpoint and evidence storage."""

import json
import time
from pathlib import Path


class TaskMemory:
    def __init__(self, store_dir: str = "memory/task_memory"):
        self.store_dir = Path(store_dir)
        self.store_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, item_id: str) -> Path:
        return self.store_dir / f"{item_id}.json"

    def save_plan(self, item_id: str, plan: dict) -> None:
        record = self.load(item_id)
        record["plan"] = plan
        record["updated_at"] = time.time()
        self._path(item_id).write_text(json.dumps(record, indent=2))

    def checkpoint(self, item_id: str, state: dict) -> None:
        record = self.load(item_id)
        record["checkpoint"] = state
        record["updated_at"] = time.time()
        self._path(item_id).write_text(json.dumps(record, indent=2))

    def add_evidence(self, item_id: str, evidence: dict) -> None:
        record = self.load(item_id)
        record.setdefault("evidence", []).append({"ts": time.time(), **evidence})
        record["updated_at"] = time.time()
        self._path(item_id).write_text(json.dumps(record, indent=2))

    def load(self, item_id: str) -> dict:
        path = self._path(item_id)
        if path.exists():
            try:
                return json.loads(path.read_text())
            except (json.JSONDecodeError, OSError):
                return {"item_id": item_id, "plan": {}, "checkpoint": {}, "evidence": [], "created_at": time.time()}
        return {"item_id": item_id, "plan": {}, "checkpoint": {}, "evidence": [], "created_at": time.time()}

    def recover(self, item_id: str) -> dict | None:
        record = self.load(item_id)
        return record.get("checkpoint") or None