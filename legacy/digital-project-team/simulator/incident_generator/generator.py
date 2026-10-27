"""Incident generator - injects surprise PIs mid-match for stress testing.

Deterministic: incident times are evenly spaced across the match, no RNG.
"""

from core.contracts.models import Item, ItemType
from core.scoring.priority_engine import BASE_PRIORITY

PI_TITLES = ["Checkout latency spike", "Queue consumer crashed", "Search index corrupted"]


class IncidentGenerator:
    def schedule(self, match_seconds: float, count: int) -> list[tuple[float, Item]]:
        events = []
        for idx in range(count):
            at = round(match_seconds * (0.2 + 0.6 * (idx / max(count, 1))), 1)
            events.append(
                (
                    at,
                    Item(
                        item_id=f"PI-LIVE-{idx + 1}",
                        item_type=ItemType.PI,
                        title=PI_TITLES[idx % len(PI_TITLES)],
                        deadline_seconds_left=None,
                        priority_base=BASE_PRIORITY[ItemType.PI],
                    ),
                )
            )
        return sorted(events, key=lambda e: e[0])