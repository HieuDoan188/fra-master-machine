"""Director Agent - CEO of the match.

Never writes code. Plans, prioritizes, allocates, escalates.
"""

from core.event_bus.bus import EventBus, EventType
from core.scheduler.portfolio_planner import PlannedAction
from core.state_machine.match_state import MatchState


class DirectorAgent:
    def __init__(self, state: MatchState, bus: EventBus):
        self.state = state
        self.bus = bus
        self.squad_load: dict[str, int] = {}

    def allocate(self, action: PlannedAction) -> str:
        squad = action.squad
        self.squad_load[squad] = self.squad_load.get(squad, 0) + 1
        self.bus.emit(
            EventType.ITEM_STARTED,
            {"item_id": action.item_id, "squad": squad, "action": action.action},
        )
        return squad

    def escalate(self, reason: str, payload: dict | None = None) -> None:
        self.bus.emit(EventType.AGENT_FAILURE, {"reason": reason, **(payload or {})})

    def status(self) -> dict:
        return {
            "squad_load": self.squad_load,
            "active_items": len(self.state.active_items()),
            "score": self.state.scoreboard.score,
        }