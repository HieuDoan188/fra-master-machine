"""Match Observer - polls the competition API and feeds the world model.

The FIRST agent to exist. Detects new items, PI, deadlines, scoreboard.
"""

import time

from core.event_bus.bus import EventBus, EventType
from core.contracts.models import ScoreboardEntry
from core.state_machine.match_state import MatchState
from services.backlog_service.service import BacklogService
from services.deadline_service.service import DeadlineService
from tools.match_api.client import MatchApiClient


class MatchObserver:
    def __init__(
        self,
        api: MatchApiClient,
        state: MatchState,
        bus: EventBus,
        backlog: BacklogService,
        deadline: DeadlineService,
        poll_interval: float = 2.0,
    ):
        self.api = api
        self.state = state
        self.bus = bus
        self.backlog = backlog
        self.deadline = deadline
        self.poll_interval = poll_interval
        self.running = False

    def start(self) -> None:
        self.running = True
        self.bus.emit(EventType.MATCH_STARTED, {})

    def tick(self, dt_seconds: float = 1.0) -> dict:
        new_items = self.backlog.poll()
        self.deadline.tick(dt_seconds)
        self.state.elapsed_seconds += dt_seconds
        self.state.scoreboard = self._merge_scoreboard()
        return {"new_items": len(new_items), "elapsed": self.state.elapsed_seconds}

    def stop(self) -> None:
        self.running = False
        self.bus.emit(EventType.MATCH_ENDED, {})

    def _merge_scoreboard(self) -> ScoreboardEntry:
        raw = self.api.get_scoreboard()
        team = raw.get("team", {})
        sb = self.state.scoreboard
        sb.rank = team.get("rank", sb.rank)
        sb.accepted = team.get("accepted", sb.accepted)
        sb.failed = team.get("failed", sb.failed)
        return sb

    def run_forever(self, total_seconds: float) -> None:
        self.start()
        elapsed = 0.0
        while elapsed < total_seconds and self.running:
            self.tick(self.poll_interval)
            elapsed += self.poll_interval
            if total_seconds - elapsed <= 60:
                self.bus.emit(EventType.MATCH_ENDING, {"seconds_left": round(total_seconds - elapsed)})
            time.sleep(0.01)
        self.stop()