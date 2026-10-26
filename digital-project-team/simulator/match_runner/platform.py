"""Simulated competition platform - the game master in mock mode."""

from dataclasses import dataclass, field

from core.contracts.models import Item, ItemType
from core.scoring.priority_engine import pi_score
from simulator.grader.grader import Grader


@dataclass
class SimulationResult:
    score: int = 0
    accepted: int = 0
    failed: int = 0
    pi_positions: dict = field(default_factory=dict)
    log: list = field(default_factory=list)


class SimulatedPlatform:
    """Acts as the competition API: owns items, grades submissions, keeps score."""

    def __init__(self, items: list[Item], grader: Grader | None = None):
        self.items = {i.item_id: i for i in items}
        self.grader = grader or Grader()
        self.result = SimulationResult()
        self._pi_order: list[str] = []
        self._submitted: set[str] = set()

    def list_items(self) -> list[Item]:
        return list(self.items.values())

    def start_working(self, item_id: str) -> dict:
        item = self.items.get(item_id)
        if item is None:
            return {"status": "error"}
        if item.item_type == ItemType.PI and item_id not in self._pi_order:
            self._pi_order.append(item_id)
        return {"item_id": item_id, "status": "started"}

    def get_mvs(self, item_id: str) -> list[str]:
        return self.items.get(item_id, Item(item_id=item_id, item_type=ItemType.TASK)).mvs

    def submit(self, item_id: str, patch: str, evidence: dict | None = None) -> dict:
        if item_id in self._submitted:
            return {"item_id": item_id, "status": "rejected", "reason": "already submitted"}
        self._submitted.add(item_id)
        item = self.items[item_id]
        position = None
        if item.item_type == ItemType.PI:
            position = self._pi_order.index(item_id) + 1
        grade = self.grader.grade(item, {"mvs_passed": True, "coverage": (evidence or {}).get("coverage", 0)}, position)
        if grade["accepted"]:
            self.result.score += grade["score"]
            self.result.accepted += 1
            if item.item_type == ItemType.PI:
                self.result.pi_positions[item_id] = position
        else:
            self.result.failed += 1
        self.result.log.append(f"{item_id} -> {'accepted' if grade['accepted'] else 'failed'} ({grade['score']} pts)")
        return {"item_id": item_id, "status": "accepted" if grade["accepted"] else "failed", "score": grade["score"]}

    def scoreboard(self) -> dict:
        return {"team": {"rank": 1, "score": self.result.score, "accepted": self.result.accepted, "failed": self.result.failed}}