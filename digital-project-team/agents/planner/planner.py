"""Planner Agent - watches events, computes EV, assigns work to squads.

The most important component: optimizes portfolio return, not task count.
"""

from core.event_bus.bus import EventBus, EventType
from core.scheduler.portfolio_planner import PlannedAction, PortfolioPlanner
from core.state_machine.match_state import MatchState
from memory.match_memory.store import MatchMemory


class PlannerAgent:
    def __init__(self, state: MatchState, bus: EventBus, planner: PortfolioPlanner | None = None, memory: MatchMemory | None = None):
        self.state = state
        self.bus = bus
        self.planner = planner or PortfolioPlanner()
        self.memory = memory or MatchMemory()
        self.last_plan: list[PlannedAction] = []
        self._dirty = True
        bus.subscribe(EventType.ITEM_VISIBLE, lambda e: self.mark_dirty())
        bus.subscribe(EventType.PI_CREATED, lambda e: self.mark_dirty())
        bus.subscribe(EventType.ITEM_SUBMITTED, lambda e: self.mark_dirty())
        bus.subscribe(EventType.ITEM_FAILED, lambda e: self.mark_dirty())

    def mark_dirty(self) -> None:
        self._dirty = True

    def replan(self, force: bool = False) -> list[PlannedAction]:
        if not force and not self._dirty:
            return self.last_plan
        actions = self.planner.plan(self.state.active_items())
        self.last_plan = actions
        self._dirty = False
        return actions

    def next_action(self) -> PlannedAction | None:
        self.replan(force=True)
        return self.last_plan[0] if self.last_plan else None