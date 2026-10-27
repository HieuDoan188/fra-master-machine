"""In-process publish/subscribe event bus.

Events mirror event_catalog.yaml. Agents never call each other directly;
everything observable flows through this bus.
"""

import threading
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable


class EventType:
    MATCH_STARTED = "MATCH_STARTED"
    MATCH_ENDING = "MATCH_ENDING"
    MATCH_ENDED = "MATCH_ENDED"
    ITEM_VISIBLE = "ITEM_VISIBLE"
    ITEM_STARTED = "ITEM_STARTED"
    ITEM_CLOSED = "ITEM_CLOSED"
    ITEM_SUBMITTED = "ITEM_SUBMITTED"
    ITEM_ACCEPTED = "ITEM_ACCEPTED"
    ITEM_FAILED = "ITEM_FAILED"
    MVS_RECEIVED = "MVS_RECEIVED"
    PI_CREATED = "PI_CREATED"
    DEADLINE_WARNING = "DEADLINE_WARNING"
    AGENT_FAILURE = "AGENT_FAILURE"
    MANUAL_INTERVENTION = "MANUAL_INTERVENTION"
    WORKFLOW_STUCK = "WORKFLOW_STUCK"


@dataclass
class Event:
    type: str
    payload: dict = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict:
        return {"type": self.type, "payload": self.payload, "timestamp": self.timestamp}


Listener = Callable[[Event], None]


class EventBus:
    def __init__(self):
        self._listeners: dict[str, list[Listener]] = defaultdict(list)
        self._history: list[Event] = []
        self._lock = threading.Lock()

    def subscribe(self, event_type: str, listener: Listener) -> None:
        with self._lock:
            self._listeners[event_type].append(listener)

    def subscribe_all(self, listener: Listener) -> None:
        with self._lock:
            for listeners in self._listeners.values():
                listeners.append(listener)

    def emit(self, event_type: str, payload: dict | None = None) -> Event:
        event = Event(type=event_type, payload=payload or {})
        with self._lock:
            self._history.append(event)
            targets = list(self._listeners.get(event_type, []))
        for listener in targets:
            try:
                listener(event)
            except Exception:
                pass
        return event

    def history(self, event_type: str | None = None) -> list[Event]:
        if event_type is None:
            return list(self._history)
        return [e for e in self._history if e.type == event_type]