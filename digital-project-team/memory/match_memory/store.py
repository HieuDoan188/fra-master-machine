"""Match memory - durable record of the whole match (decisions, incidents, scores)."""

import json
import time
from pathlib import Path


class MatchMemory:
    def __init__(self, store_dir: str = "memory/match_memory", reset: bool = False):
        self.store_dir = Path(store_dir)
        self.store_dir.mkdir(parents=True, exist_ok=True)
        self._path = self.store_dir / "match.json"
        if reset and self._path.exists():
            self._path.unlink()
        self._data = self._load()

    def _load(self) -> dict:
        if self._path.exists():
            return json.loads(self._path.read_text())
        return {"decisions": [], "incidents": [], "submissions": [], "events": [], "started_at": time.time()}

    def _flush(self) -> None:
        self._path.write_text(json.dumps(self._data, indent=2))

    def record_decision(self, item_id: str, decision: str, reason: str) -> None:
        self._data["decisions"].append({"ts": time.time(), "item_id": item_id, "decision": decision, "reason": reason})
        if len(self._data["decisions"]) % 50 == 0:
            self._flush()

    def record_incident(self, incident: dict) -> None:
        self._data["incidents"].append({"ts": time.time(), **incident})
        self._flush()

    def record_submission(self, item_id: str, result: dict) -> None:
        self._data["submissions"].append({"ts": time.time(), "item_id": item_id, **result})
        self._flush()

    def record_event(self, event_type: str, payload: dict) -> None:
        self._data["events"].append({"ts": time.time(), "type": event_type, "payload": payload})

    def stats(self) -> dict:
        return {
            "decisions": len(self._data["decisions"]),
            "incidents": len(self._data["incidents"]),
            "submissions": len(self._data["submissions"]),
            "events": len(self._data["events"]),
        }