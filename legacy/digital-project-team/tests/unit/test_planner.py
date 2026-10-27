import unittest

from core.contracts.models import Item, ItemType
from core.event_bus.bus import EventBus, EventType
from core.scoring.ev_engine import deadline_factor, expected_value
from core.scheduler.portfolio_planner import PortfolioPlanner
from core.state_machine.match_state import MatchState


class TestEvEngine(unittest.TestCase):
    def test_deadline_factor_zero_when_expired(self):
        self.assertEqual(deadline_factor(0), 0.0)

    def test_ev_ordering(self):
        a = Item(item_id="A", item_type=ItemType.BUG, priority_base=70, deadline_seconds_left=600)
        b = Item(item_id="B", item_type=ItemType.CR, priority_base=50, deadline_seconds_left=100)
        planner = PortfolioPlanner()
        actions = planner.plan([a, b])
        self.assertEqual(actions[0].item_id, "A")


class TestPortfolioPlanner(unittest.TestCase):
    def test_pi_first(self):
        pi = Item(item_id="PI-1", item_type=ItemType.PI, priority_base=100)
        bug = Item(item_id="BUG-1", item_type=ItemType.BUG, priority_base=70, deadline_seconds_left=600)
        actions = PortfolioPlanner().plan([bug, pi])
        self.assertEqual(actions[0].action, "START_PI")
        self.assertEqual(actions[0].item_id, "PI-1")


class TestEventBus(unittest.TestCase):
    def test_subscribe_and_history(self):
        bus = EventBus()
        seen = []
        bus.subscribe(EventType.ITEM_VISIBLE, lambda e: seen.append(e.payload["item_id"]))
        bus.emit(EventType.ITEM_VISIBLE, {"item_id": "X"})
        self.assertEqual(seen, ["X"])
        self.assertEqual(len(bus.history()), 1)


if __name__ == "__main__":
    unittest.main()