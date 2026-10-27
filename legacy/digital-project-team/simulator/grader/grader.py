"""Grader - simulates the hidden grader of the real competition.

Accepts a submission only if MVS AND hidden tests pass.
"""

from core.contracts.models import Item, ItemType
from core.scoring.priority_engine import pi_score


class Grader:
    def __init__(self, hidden_test_pass_rate: float = 0.9):
        self.hidden_test_pass_rate = hidden_test_pass_rate

    def grade(self, item: Item, submission: dict, pi_position: int | None = None) -> dict:
        mvs_ok = bool(submission.get("mvs_passed"))
        hidden_ok = self._hidden_tests_pass(submission)
        accepted = mvs_ok and hidden_ok
        if item.item_type == ItemType.PI and pi_position is not None:
            score = pi_score(pi_position) if accepted else 0
        else:
            score = item.priority_base if accepted else 0
        return {"accepted": accepted, "score": score, "hidden_tests": hidden_ok}

    def _hidden_tests_pass(self, submission: dict) -> bool:
        coverage = submission.get("coverage", 0)
        return coverage >= 80.0