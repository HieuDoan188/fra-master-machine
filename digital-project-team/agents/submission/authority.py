"""Submission Authority - the final gate. Only this agent submits.

Submission is irreversible. Required: MVS pass, coverage >= 90%,
regression risk <= 10%, confidence >= 85%, evidence complete.
"""

from core.contracts.models import Item, ItemStatus
from core.event_bus.bus import EventBus, EventType
from core.lifecycle.controller import LifecycleController
from memory.match_memory.store import MatchMemory
from memory.task_memory.store import TaskMemory
from services.submission_service.service import SubmissionService
from services.testing_service.service import TestOutcome, TestingService


class SubmissionAuthority:
    def __init__(
        self,
        submission_service: SubmissionService,
        testing_service: TestingService,
        lifecycle: LifecycleController,
        task_memory: TaskMemory | None = None,
        match_memory: MatchMemory | None = None,
        min_coverage: float = 90.0,
        min_confidence: float = 0.85,
    ):
        self.submissions = submission_service
        self.testing = testing_service
        self.lifecycle = lifecycle
        self.task_memory = task_memory or TaskMemory()
        self.match_memory = match_memory or MatchMemory()
        self.min_coverage = min_coverage
        self.min_confidence = min_confidence

    def gate(self, item: Item, outcome: TestOutcome, review: dict, patch: str = "") -> dict:
        checks = {
            "mvs_pass": outcome.passed,
            "coverage_ok": outcome.coverage >= self.min_coverage,
            "confidence_ok": review.get("confidence", 0) >= self.min_confidence,
            "regression_ok": review.get("regression_risk", 1.0) <= 0.10,
            "evidence_complete": bool(self.task_memory.load(item.item_id).get("evidence")),
        }
        passed = all(checks.values())
        if not passed:
            self.match_memory.record_decision(item.item_id, "SUBMISSION_REJECTED", str(checks))
            return {"submitted": False, "checks": checks}

        self.lifecycle.ready(item)
        self.lifecycle.submit(item)
        result = self.submissions.submit(item.item_id, patch, {"coverage": outcome.coverage, "review": review})
        self.match_memory.record_submission(item.item_id, result)
        return {"submitted": True, "checks": checks, "result": result}