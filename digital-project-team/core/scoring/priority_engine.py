"""Priority engine - base priority per item type (backlog_types.yaml)."""

from core.contracts.models import Item, ItemType

BASE_PRIORITY: dict[ItemType, int] = {
    ItemType.PI: 100,
    ItemType.BUG: 70,
    ItemType.CR: 50,
    ItemType.TASK: 20,
}

PI_SCORE_TABLE: dict[int, int] = {1: 100, 2: 90, 3: 75}


def base_priority(item: Item) -> int:
    return BASE_PRIORITY.get(item.item_type, 0)


def pi_score(position: int) -> int:
    return PI_SCORE_TABLE.get(position, 60)