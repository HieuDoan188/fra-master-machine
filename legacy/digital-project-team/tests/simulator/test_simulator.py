import unittest

from simulator.backlog_generator.generator import BacklogGenerator, BacklogProfile
from simulator.grader.grader import Grader
from simulator.incident_generator.generator import IncidentGenerator
from simulator.match_runner.platform import SimulatedPlatform
from core.contracts.models import Item, ItemType


class TestBacklogGenerator(unittest.TestCase):
    def test_counts(self):
        profile = BacklogProfile(bugs=20, crs=10, tasks=5, pis=5)
        items = BacklogGenerator().generate(profile)
        self.assertEqual(len(items), 40)
        self.assertEqual(sum(1 for i in items if i.item_type == ItemType.BUG), 20)
        self.assertEqual(sum(1 for i in items if i.item_type == ItemType.TASK), 5)


class TestIncidentGenerator(unittest.TestCase):
    def test_schedules_within_match(self):
        events = IncidentGenerator().schedule(420.0, 3)
        self.assertEqual(len(events), 3)
        for at, item in events:
            self.assertGreaterEqual(at, 420 * 0.2)
            self.assertLessEqual(at, 420 * 0.8)
            self.assertEqual(item.item_type, ItemType.PI)

    def test_deterministic(self):
        a = IncidentGenerator().schedule(420.0, 3)
        b = IncidentGenerator().schedule(420.0, 3)
        self.assertEqual([at for at, _ in a], [at for at, _ in b])


class TestGrader(unittest.TestCase):
    def test_accepts_with_coverage(self):
        item = Item(item_id="BUG-1", item_type=ItemType.BUG, priority_base=70)
        result = Grader().grade(item, {"mvs_passed": True, "coverage": 90})
        self.assertTrue(result["accepted"])
        self.assertEqual(result["score"], 70)

    def test_rejects_low_coverage(self):
        item = Item(item_id="BUG-1", item_type=ItemType.BUG, priority_base=70)
        result = Grader().grade(item, {"mvs_passed": True, "coverage": 50})
        self.assertFalse(result["accepted"])


class TestSimulatedPlatform(unittest.TestCase):
    def test_full_match_flow(self):
        items = [Item(item_id="BUG-1", item_type=ItemType.BUG, priority_base=70)]
        platform = SimulatedPlatform(items)
        platform.start_working("BUG-1")
        result = platform.submit("BUG-1", "patch", {"coverage": 95})
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(platform.result.score, 70)

    def test_no_double_submit(self):
        items = [Item(item_id="BUG-1", item_type=ItemType.BUG, priority_base=70)]
        platform = SimulatedPlatform(items)
        platform.start_working("BUG-1")
        platform.submit("BUG-1", "patch", {"coverage": 95})
        second = platform.submit("BUG-1", "patch", {"coverage": 95})
        self.assertEqual(second["status"], "rejected")


if __name__ == "__main__":
    unittest.main()