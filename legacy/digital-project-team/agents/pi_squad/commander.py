"""PI Squad - recovers production functionality as fast as possible.

MTTR beats code elegance. Containment -> Recovery -> Verification.
"""

import time

from core.contracts.models import Item, ItemStatus
from core.event_bus.bus import EventBus
from core.lifecycle.controller import LifecycleController
from core.state_machine.match_state import MatchState
from integrations.openhands.task_runner import TaskRunner, TaskSpec
from memory.match_memory.store import MatchMemory
from memory.task_memory.store import TaskMemory
from services.incident_service.service import IncidentService


class PiCommander:
    def __init__(
        self,
        state: MatchState,
        bus: EventBus,
        lifecycle: LifecycleController,
        incidents: IncidentService,
        runner: TaskRunner | None = None,
        task_memory: TaskMemory | None = None,
        match_memory: MatchMemory | None = None,
    ):
        self.state = state
        self.bus = bus
        self.lifecycle = lifecycle
        self.incidents = incidents
        self.runner = runner or TaskRunner()
        self.task_memory = task_memory or TaskMemory()
        self.match_memory = match_memory or MatchMemory()

    def handle(self, item: Item) -> dict:
        opened = time.monotonic()
        self.incidents.register(item.item_id)
        if item.status == ItemStatus.VISIBLE:
            self.lifecycle.start(item)
        if item.status == ItemStatus.STARTED:
            self.lifecycle.implement(item)

        hypotheses = self.investigate(item)
        root_cause = self.root_cause(hypotheses)
        fix = self.apply_fix(item, root_cause)
        verdict = self.validate(item, fix)

        mttr = round(time.monotonic() - opened, 2)
        self.incidents.resolve(item.item_id, mttr)
        self.match_memory.record_incident(
            {"item_id": item.item_id, "root_cause": root_cause, "mttr": mttr, "verdict": verdict}
        )
        return {"item_id": item.item_id, "root_cause": root_cause, "mttr": mttr, "verdict": verdict}

    def investigate(self, item: Item) -> list[str]:
        return [f"hypothesis-1: {item.title or item.item_id} fails on happy path", "hypothesis-2: input validation missing"]

    def root_cause(self, hypotheses: list[str]) -> str:
        return hypotheses[0].split(": ", 1)[1]

    def apply_fix(self, item: Item, root_cause: str) -> dict:
        spec = TaskSpec(
            item_id=item.item_id,
            description=f"PI fix: {root_cause}. Restore production functionality.",
            repo_path=self._repo_path(),
            mvs=item.mvs,
        )
        result = self.runner.run(spec)
        self.task_memory.checkpoint(item.item_id, {"fix": result.output, "root_cause": root_cause})
        return {"patched": result.success, "output": result.output}

    def validate(self, item: Item, fix: dict) -> str:
        self.lifecycle.verify(item)
        return "VALIDATED" if fix.get("patched") else "REJECTED"

    def _repo_path(self) -> str:
        return self.state.__dict__.get("repo_path", "/tmp/repo")