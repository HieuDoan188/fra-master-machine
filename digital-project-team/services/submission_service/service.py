"""Submission service - the ONLY caller of the submit API."""

from core.event_bus.bus import EventBus, EventType
from core.state_machine.match_state import MatchState
from tools.match_api.client import MatchApiClient


class SubmissionService:
    def __init__(self, api: MatchApiClient, state: MatchState, bus: EventBus):
        self.api = api
        self.state = state
        self.bus = bus

    def submit(self, item_id: str, patch: str, evidence: dict | None = None) -> dict:
        result = self.api.submit(item_id, patch, evidence or {})
        item = self.state.get_item(item_id)
        if item:
            item.submitted = True
            item.evidence = evidence or {}
            if result.get("status") == "accepted":
                item.accepted = True
                item.score = result.get("score", 0)
                self.state.scoreboard.score += item.score
                self.state.scoreboard.accepted += 1
                self.bus.emit(EventType.ITEM_ACCEPTED, {"item_id": item_id, "score": item.score})
            else:
                self.state.scoreboard.failed += 1
                self.bus.emit(EventType.ITEM_FAILED, {"item_id": item_id})
        return result