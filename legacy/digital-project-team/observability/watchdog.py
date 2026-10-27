"""Watchdog - revives dead agents from their last checkpoint."""

from agents.task_squad.base_squad import BaseSquad
from core.contracts.models import ItemStatus
from core.lifecycle.controller import LifecycleController
from core.state_machine.match_state import MatchState
from memory.task_memory.store import TaskMemory
from observability.health_checks.checker import HealthChecker

STUCK_STATUSES = (ItemStatus.IMPLEMENTING, ItemStatus.VERIFYING, ItemStatus.READY_TO_SUBMIT)


class Watchdog:
    def __init__(
        self,
        state: MatchState,
        health: HealthChecker,
        task_memory: TaskMemory | None = None,
        lifecycle: LifecycleController | None = None,
        stuck_ticks: int = 5,
    ):
        self.state = state
        self.health = health
        self.task_memory = task_memory or TaskMemory()
        self.lifecycle = lifecycle
        self.stuck_ticks = stuck_ticks
        self.squads: dict[str, BaseSquad] = {}
        self._seen_ticks: dict[str, int] = {}

    def register_squad(self, name: str, squad: BaseSquad) -> None:
        self.squads[name] = squad

    def revive(self) -> list[str]:
        revived = []
        for item in self.state.active_items():
            if item.status in STUCK_STATUSES:
                self._seen_ticks[item.item_id] = self._seen_ticks.get(item.item_id, 0) + 1
                if self._seen_ticks[item.item_id] >= self.stuck_ticks:
                    self._seen_ticks[item.item_id] = 0
                    if self.lifecycle is not None:
                        try:
                            self.lifecycle.rework(item)
                        except Exception:
                            self.lifecycle.start(item)
                    self.health.heartbeat(item.squad or "unknown")
                    revived.append(item.item_id)
            else:
                self._seen_ticks.pop(item.item_id, None)
        return revived