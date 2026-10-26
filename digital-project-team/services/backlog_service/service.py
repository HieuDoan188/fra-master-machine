"""Backlog service - ingests items from the competition API into MatchState."""

from core.contracts.models import Item, ItemType
from core.event_bus.bus import EventBus, EventType
from core.scoring.priority_engine import BASE_PRIORITY
from core.state_machine.match_state import MatchState
from tools.match_api.client import MatchApiClient, MatchItem


class BacklogService:
    def __init__(self, api: MatchApiClient, state: MatchState, bus: EventBus):
        self.api = api
        self.state = state
        self.bus = bus
        self._seen: set[str] = set()

    def poll(self) -> list[Item]:
        raw = self.api.get_items()
        new_items: list[Item] = []
        for mi in raw:
            existing = self.state.get_item(mi.item_id)
            if existing is not None:
                continue
            item = self._to_item(mi)
            self.state.upsert_item(item)
            self._seen.add(mi.item_id)
            self.bus.emit(EventType.ITEM_VISIBLE, {"item_id": mi.item_id, "item_type": mi.item_type})
            new_items.append(item)
            if mi.item_type == ItemType.PI.value:
                self.bus.emit(EventType.PI_CREATED, {"item_id": mi.item_id})
        return new_items

    def _to_item(self, mi: MatchItem) -> Item:
        return Item(
            item_id=mi.item_id,
            item_type=ItemType(mi.item_type),
            title=mi.title,
            deadline_seconds_left=mi.deadline_minutes * 60 if mi.deadline_minutes else None,
            mvs=mi.mvs,
            priority_base=BASE_PRIORITY.get(ItemType(mi.item_type), 0),
        )