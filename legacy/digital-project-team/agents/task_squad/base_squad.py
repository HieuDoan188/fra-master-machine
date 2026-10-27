"""Base squad - shared execution flow for all SDLC squads."""

from core.contracts.models import Item, ItemStatus
from core.event_bus.bus import EventBus, EventType
from core.lifecycle.controller import LifecycleController
from core.state_machine.match_state import MatchState
from integrations.openhands.task_runner import TaskRunner, TaskSpec
from memory.match_memory.store import MatchMemory
from memory.task_memory.store import TaskMemory


class BaseSquad:
    squad_name = "base"

    def __init__(
        self,
        state: MatchState,
        bus: EventBus,
        lifecycle: LifecycleController,
        runner: TaskRunner | None = None,
        task_memory: TaskMemory | None = None,
        match_memory: MatchMemory | None = None,
    ):
        self.state = state
        self.bus = bus
        self.lifecycle = lifecycle
        self.runner = runner or TaskRunner()
        self.task_memory = task_memory or TaskMemory()
        self.match_memory = match_memory or MatchMemory()

    def handle(self, item: Item) -> dict:
        if item.status == ItemStatus.VISIBLE:
            self.lifecycle.start(item)
        if item.status == ItemStatus.STARTED:
            self.lifecycle.implement(item)
        self.task_memory.save_plan(item.item_id, {"squad": self.squad_name, "description": item.description})

        spec = TaskSpec(
            item_id=item.item_id,
            description=item.description or item.title,
            repo_path=self._repo_path(),
            mvs=item.mvs,
        )
        result = self.runner.run(spec)
        self.task_memory.checkpoint(item.item_id, {"execution": result.output})

        self.lifecycle.verify(item)
        self.bus.emit(EventType.ITEM_STARTED, {"item_id": item.item_id, "stage": "verified", "squad": self.squad_name})
        return {"item_id": item.item_id, "squad": self.squad_name, "success": result.success, "output": result.output}

    def _repo_path(self) -> str:
        return self.state.__dict__.get("repo_path", "/tmp/repo")