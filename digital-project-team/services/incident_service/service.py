"""Incident service - tracks Product Incidents end to end."""

import time

from core.event_bus.bus import EventBus, EventType
from core.state_machine.match_state import MatchState


class IncidentService:
    def __init__(self, state: MatchState, bus: EventBus):
        self.state = state
        self.bus = bus
        self._open: dict[str, dict] = {}

    def register(self, item_id: str) -> None:
        self._open[item_id] = {"item_id": item_id, "opened_at": time.time(), "mttr": None}
        self.bus.emit(EventType.PI_CREATED, {"item_id": item_id})

    def resolve(self, item_id: str, mttr_seconds: float) -> None:
        if item_id in self._open:
            self._open[item_id]["mttr"] = mttr_seconds
            self._open[item_id]["resolved_at"] = time.time()

    def open_incidents(self) -> list[dict]:
        return [v for v in self._open.values() if v.get("mttr") is None]

    def avg_mttr(self) -> float:
        resolved = [v["mttr"] for v in self._open.values() if v.get("mttr") is not None]
        return sum(resolved) / len(resolved) if resolved else 0.0