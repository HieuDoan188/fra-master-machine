import unittest

from core.contracts.models import Item, ItemType, ItemStatus
from agents.submission.authority import SubmissionAuthority
from services.testing_service.service import TestOutcome


class TestSubmissionGate(unittest.TestCase):
    def setUp(self):
        self.item = Item(item_id="BUG-01", item_type=ItemType.BUG, priority_base=70, status=ItemStatus.VERIFYING)

    def test_rejects_without_evidence(self):
        authority = SubmissionAuthority.__new__(SubmissionAuthority)
        authority.min_coverage = 90.0
        authority.min_confidence = 0.85
        authority.task_memory = _EmptyMemory()  # type: ignore[assignment]
        authority.match_memory = _EmptyMemory()  # type: ignore[assignment]
        outcome = TestOutcome(passed=True, mvs_passed=1, mvs_total=1, extra_passed=6, extra_total=6)
        review = {"confidence": 0.9, "regression_risk": 0.05}
        result = authority.gate(self.item, outcome, review)
        self.assertFalse(result["submitted"])
        self.assertFalse(result["checks"]["evidence_complete"])


class _EmptyMemory:
    def load(self, item_id):
        return {"evidence": []}

    def record_decision(self, *args, **kwargs):
        pass

    def record_submission(self, *args, **kwargs):
        pass


if __name__ == "__main__":
    unittest.main()