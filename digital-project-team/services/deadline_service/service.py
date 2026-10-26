"""Deadline service - tracks item deadlines and emits warnings."""

from core.event_bus.bus import EventBus, EventType
from core.lifecycle.controller import LifecycleController
from core.state_machine.match_state import MatchState

WARNING_THRESHOLD_SECONDS = 300


class DeadlineService:
    def __init__(self, state: MatchState, bus: EventBus, lifecycle: LifecycleController | None = None):
        self.state = state
        self.bus = bus
        self.lifecycle = lifecycle
        self._warned: set[str] = set()

    def tick(self, dt_seconds: float) -> None:
        for item in self.state.active_items():
            if item.deadline_seconds_left is None:
                continue
            item.deadline_seconds_left -= dt_seconds
            if item.deadline_seconds_left <= WARNING_THRESHOLD_SECONDS and item.item_id not in self._warned:
                self._warned.add(item.item_id)
                self.bus.emit(
                    EventType.DEADLINE_WARNING,
                    {"item_id": item.item_id, "seconds_left": round(item.deadline_seconds_left, 1)},
                )
            if item.deadline_seconds_left <= 0 and item.status.value not in ("SUBMITTED", "FAILED", "CLOSED"):
                self.bus.emit(EventType.ITEM_CLOSED, {"item_id": item.item_id, "reason": "deadline"})
                if self.lifecycle is not None:
                    self.lifecycle.close(item)