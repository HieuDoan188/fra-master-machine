"""Health checks - detects agent death, stuck workflows, pending submissions."""

import time

from core.state_machine.match_state import MatchState
from observability.metrics.collector import Metrics

STUCK_THRESHOLD_SECONDS = 120


class HealthChecker:
    def __init__(self, state: MatchState, metrics: Metrics):
        self.state = state
        self.metrics = metrics
        self._heartbeat: dict[str, float] = {}

    def heartbeat(self, agent_name: str) -> None:
        self._heartbeat[agent_name] = time.time()

    def check(self) -> list[str]:
        problems = []
        now = time.time()
        for agent, last in self._heartbeat.items():
            if now - last > STUCK_THRESHOLD_SECONDS:
                problems.append(f"agent_dead:{agent}")
                self.metrics.inc("agent_deaths")
        for item in self.state.active_items():
            if item.status.value in ("STARTED", "IMPLEMENTING", "VERIFYING"):
                problems.append(f"workflow_stuck:{item.item_id}")
        self.metrics.set("problems", len(problems))
        return problems