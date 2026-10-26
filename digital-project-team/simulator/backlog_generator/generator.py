"""Backlog generator - produces synthetic match workloads.

Example: simulate 20 BUG + 10 CR + 5 TASK + 5 PI for stress tests.
"""

from dataclasses import dataclass, field

from core.contracts.models import Item, ItemType
from core.scoring.priority_engine import BASE_PRIORITY

TITLES = {
    ItemType.BUG: ["Login returns 500 on empty password", "Null pointer in list handler", "Timeout on large upload"],
    ItemType.CR: ["Add pagination to /users", "Rename field createdAt", "Add sorting to search"],
    ItemType.TASK: ["Update README", "Add logging middleware", "Bump dependency version"],
    ItemType.PI: ["Production outage on /checkout", "Database connection exhausted", "Auth service down"],
}


@dataclass
class BacklogProfile:
    bugs: int = 20
    crs: int = 10
    tasks: int = 5
    pis: int = 5
    deadline_max_seconds: float = 720.0


class BacklogGenerator:
    def generate(self, profile: BacklogProfile | None = None) -> list[Item]:
        p = profile or BacklogProfile()
        items: list[Item] = []
        for item_type, count, prefix in [
            (ItemType.BUG, p.bugs, "BUG"),
            (ItemType.CR, p.crs, "CR"),
            (ItemType.TASK, p.tasks, "TASK"),
            (ItemType.PI, p.pis, "PI"),
        ]:
            for idx in range(1, count + 1):
                items.append(
                    Item(
                        item_id=f"{prefix}-{idx:02d}",
                        item_type=item_type,
                        title=TITLES[item_type][idx % len(TITLES[item_type])],
                        deadline_seconds_left=self._deadline(idx, count, p),
                        priority_base=BASE_PRIORITY[item_type],
                        mvs=[f"MVS {prefix}-{idx}: happy path passes"] if item_type != ItemType.TASK else [],
                    )
                )
        return items

    def _deadline(self, idx: int, count: int, p: BacklogProfile) -> float:
        span = p.deadline_max_seconds * 0.5
        return round(p.deadline_max_seconds - span * ((idx - 1) / max(count - 1, 1)), 1)