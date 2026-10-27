import unittest

from core.contracts.models import Item, ItemStatus, ItemType
from core.event_bus.bus import EventBus, EventType
from core.lifecycle.controller import LifecycleController
from core.state_machine.item_state import IllegalTransition


class TestStateMachine(unittest.TestCase):
    def setUp(self):
        self.bus = EventBus()
        self.lifecycle = LifecycleController(bus=self.bus)
        self.item = Item(item_id="BUG-01", item_type=ItemType.BUG, priority_base=70)

    def test_happy_path(self):
        self.lifecycle.start(self.item)
        self.assertEqual(self.item.status, ItemStatus.STARTED)
        self.lifecycle.implement(self.item)
        self.lifecycle.verify(self.item)
        self.lifecycle.ready(self.item)
        self.lifecycle.submit(self.item)
        self.assertEqual(self.item.status, ItemStatus.SUBMITTED)

    def test_forbidden_visible_to_submitted(self):
        with self.assertRaises(IllegalTransition):
            self.lifecycle.submit(self.item)

    def test_forbidden_started_to_submitted(self):
        self.lifecycle.start(self.item)
        with self.assertRaises(IllegalTransition):
            self.lifecycle.submit(self.item)

    def test_events_emitted(self):
        self.lifecycle.start(self.item)
        self.assertTrue(any(e.type == EventType.ITEM_STARTED for e in self.bus.history()))


if __name__ == "__main__":
    unittest.main()