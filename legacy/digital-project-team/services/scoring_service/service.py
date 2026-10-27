"""Scoring service - computes EV and tracks match score."""

from core.contracts.models import Item, ItemType
from core.scoring.ev_engine import ev_of_item
from core.scoring.priority_engine import pi_score
from core.state_machine.match_state import MatchState


class ScoringService:
    def __init__(self, state: MatchState):
        self.state = state

    def ev(self, item: Item, base_confidence: float = 0.8, complexity: float = 0.5) -> float:
        return ev_of_item(item, base_confidence, complexity)

    def award(self, item: Item, position: int | None = None) -> int:
        if item.item_type == ItemType.PI and position is not None:
            score = pi_score(position)
        else:
            score = item.score or item.priority_base
        item.score = score
        item.accepted = True
        self.state.scoreboard.score += score
        self.state.scoreboard.accepted += 1
        return score