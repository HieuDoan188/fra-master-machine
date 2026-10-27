"""Lifecycle controller - the only way items move between states.

Combines the state machine with event emission so every state change is
announced on the bus.
"""

from core.event_bus.bus import EventBus, EventType
from core.state_machine.item_state import IllegalTransition, ItemStateMachine
from core.contracts.models import Item, ItemStatus


class LifecycleController:
    def __init__(self, state_machine: ItemStateMachine | None = None, bus: EventBus | None = None):
        self.fsm = state_machine or ItemStateMachine()
        self.bus = bus or EventBus()

    def _apply(self, item: Item, target: ItemStatus, event_type: str) -> Item:
        try:
            self.fsm.transition(item, target)
        except IllegalTransition as exc:
            self.bus.emit(EventType.AGENT_FAILURE, {"reason": str(exc), "item_id": item.item_id})
            raise
        self.bus.emit(event_type, {"item_id": item.item_id, "status": target.value})
        return item

    def start(self, item: Item) -> Item:
        return self._apply(item, ItemStatus.STARTED, EventType.ITEM_STARTED)

    def implement(self, item: Item) -> Item:
        return self._apply(item, ItemStatus.IMPLEMENTING, EventType.ITEM_STARTED)

    def verify(self, item: Item) -> Item:
        return self._apply(item, ItemStatus.VERIFYING, EventType.ITEM_STARTED)

    def ready(self, item: Item) -> Item:
        return self._apply(item, ItemStatus.READY_TO_SUBMIT, EventType.ITEM_STARTED)

    def submit(self, item: Item) -> Item:
        return self._apply(item, ItemStatus.SUBMITTED, EventType.ITEM_SUBMITTED)

    def fail(self, item: Item) -> Item:
        return self._apply(item, ItemStatus.FAILED, EventType.ITEM_FAILED)

    def rework(self, item: Item) -> Item:
        if item.status in (ItemStatus.VERIFYING, ItemStatus.READY_TO_SUBMIT):
            return self._apply(item, ItemStatus.IMPLEMENTING, EventType.ITEM_STARTED)
        return item

    def close(self, item: Item) -> Item:
        return self._apply(item, ItemStatus.CLOSED, EventType.ITEM_CLOSED)