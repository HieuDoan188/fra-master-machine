"""Item state machine - enforces lifecycle_state_machine.yaml.

VISIBLE -> STARTED -> IMPLEMENTING -> VERIFYING -> READY_TO_SUBMIT -> SUBMITTED
Plus FAILED / CLOSED terminal states.
"""

from core.contracts.models import Item, ItemStatus


class IllegalTransition(Exception):
    pass


TRANSITIONS: dict[ItemStatus, set[ItemStatus]] = {
    ItemStatus.VISIBLE: {ItemStatus.STARTED, ItemStatus.CLOSED},
    ItemStatus.STARTED: {ItemStatus.IMPLEMENTING, ItemStatus.FAILED},
    ItemStatus.IMPLEMENTING: {ItemStatus.VERIFYING, ItemStatus.FAILED},
    ItemStatus.VERIFYING: {ItemStatus.READY_TO_SUBMIT, ItemStatus.IMPLEMENTING, ItemStatus.FAILED},
    ItemStatus.READY_TO_SUBMIT: {ItemStatus.SUBMITTED, ItemStatus.VERIFYING, ItemStatus.FAILED},
    ItemStatus.SUBMITTED: set(),
    ItemStatus.FAILED: set(),
    ItemStatus.CLOSED: set(),
}

FORBIDDEN: list[tuple[ItemStatus, ItemStatus]] = [
    (ItemStatus.VISIBLE, ItemStatus.SUBMITTED),
    (ItemStatus.VISIBLE, ItemStatus.VERIFYING),
    (ItemStatus.STARTED, ItemStatus.SUBMITTED),
]


class ItemStateMachine:
    def can_transition(self, current: ItemStatus, target: ItemStatus) -> bool:
        if (current, target) in FORBIDDEN:
            return False
        return target in TRANSITIONS.get(current, set())

    def transition(self, item: Item, target: ItemStatus) -> Item:
        if not self.can_transition(item.status, target):
            raise IllegalTransition(f"{item.item_id}: {item.status.value} -> {target.value} is illegal")
        item.status = target
        return item