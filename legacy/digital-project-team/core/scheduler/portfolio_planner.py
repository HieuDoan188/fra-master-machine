"""Portfolio planner - maximizes total match score, not task count.

PI always wins. Remaining items ranked by EV, respecting squad capacity.
"""

from dataclasses import dataclass

from core.contracts.models import Item, ItemType
from core.scoring.ev_engine import ev_of_item


@dataclass
class PlannedAction:
    item_id: str
    item_type: str
    action: str
    ev: float
    squad: str
    reason: str = ""


class PortfolioPlanner:
    def __init__(self, squad_capacity: int = 3):
        self.squad_capacity = squad_capacity

    def plan(self, items: list[Item]) -> list[PlannedAction]:
        actions: list[PlannedAction] = []
        pis = [i for i in items if i.item_type == ItemType.PI and i.status.value not in ("SUBMITTED", "FAILED", "CLOSED")]
        others = [
            i
            for i in items
            if i.item_type != ItemType.PI and i.status.value in ("VISIBLE", "STARTED", "IMPLEMENTING")
        ]

        for pi in sorted(pis, key=lambda i: ev_of_item(i), reverse=True):
            actions.append(
                PlannedAction(pi.item_id, pi.item_type.value, "START_PI", ev_of_item(pi), "pi_squad", "PI overrides all")
            )

        ranked = sorted(others, key=lambda i: ev_of_item(i), reverse=True)
        assigned = 0
        for item in ranked:
            if assigned >= self.squad_capacity:
                break
            if item.status.value == "VISIBLE":
                actions.append(
                    PlannedAction(
                        item.item_id,
                        item.item_type.value,
                        "START_WORKING",
                        ev_of_item(item),
                        self._squad_for(item),
                        "highest EV",
                    )
                )
            else:
                actions.append(
                    PlannedAction(
                        item.item_id,
                        item.item_type.value,
                        "CONTINUE",
                        ev_of_item(item),
                        self._squad_for(item),
                        "in progress",
                    )
                )
            assigned += 1
        return actions

    def _squad_for(self, item: Item) -> str:
        return {
            ItemType.BUG: "bug_squad",
            ItemType.CR: "cr_squad",
            ItemType.TASK: "task_squad",
            ItemType.PI: "pi_squad",
        }.get(item.item_type, "task_squad")