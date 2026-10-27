"""Alert rules - turns health problems into bus events."""

from core.event_bus.bus import EventBus, EventType


class AlertManager:
    def __init__(self, bus: EventBus):
        self.bus = bus

    def evaluate(self, problems: list[str]) -> None:
        for problem in problems:
            self.bus.emit(EventType.AGENT_FAILURE, {"problem": problem})