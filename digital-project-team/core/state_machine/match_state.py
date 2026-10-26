"""MatchState - the blackboard every agent reads.

Single source of truth for items, deadlines and scoreboard.
"""

import threading

from core.contracts.models import Item, MatchSnapshot, ScoreboardEntry


class MatchState:
    def __init__(self):
        self._lock = threading.RLock()
        self._items: dict[str, Item] = {}
        self.scoreboard = ScoreboardEntry()
        self.elapsed_seconds: float = 0.0
        self.remaining_seconds: float = 3600.0
        self.match_started: bool = False

    def upsert_item(self, item: Item) -> None:
        with self._lock:
            self._items[item.item_id] = item

    def get_item(self, item_id: str) -> Item | None:
        with self._lock:
            return self._items.get(item_id)

    def all_items(self) -> list[Item]:
        with self._lock:
            return list(self._items.values())

    def items_by_status(self, status) -> list[Item]:
        return [i for i in self.all_items() if i.status == status]

    def active_items(self) -> list[Item]:
        return [i for i in self.all_items() if i.status not in ("SUBMITTED", "FAILED", "CLOSED")]

    def snapshot(self) -> MatchSnapshot:
        with self._lock:
            return MatchSnapshot(
                items=list(self._items.values()),
                scoreboard=self.scoreboard,
                elapsed_seconds=self.elapsed_seconds,
                remaining_seconds=self.remaining_seconds,
            )