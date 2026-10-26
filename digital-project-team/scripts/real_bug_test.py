"""Real bug test - injects real bugs into FastAPI and runs the pipeline.

The system must actually fix the bugs (apply patch + real pytest pass)
for the submission to be accepted.

Usage: python -m scripts.real_bug_test
"""

import tempfile

from core.contracts.models import Item, ItemType
from core.scoring.priority_engine import BASE_PRIORITY
from integrations.openhands.real_adapter import RealAdapter
from simulator.bug_injector import BUG_DEFS, BugInjector
from simulator.match_runner.platform import SimulatedPlatform
from simulator.match_runner.runner import MatchRunner

SOURCE_REPO = "/workspace/target-repositories/fastapi"


def main() -> None:
    work_root = tempfile.mkdtemp(prefix="dpt-real-")
    buggy_repo = BugInjector(SOURCE_REPO, work_root).inject()
    print(f"Buggy repo: {buggy_repo}")

    items = []
    for bug_id, spec in BUG_DEFS.items():
        items.append(
            Item(
                item_id=bug_id,
                item_type=ItemType.BUG,
                title=spec["title"],
                description=spec["title"],
                deadline_seconds_left=900.0,
                priority_base=BASE_PRIORITY[ItemType.BUG],
                mvs=spec["mvs"],
            )
        )

    platform = SimulatedPlatform(items)
    runner = MatchRunner(platform, repo_path=buggy_repo, adapter=RealAdapter())
    result = runner.run(total_seconds=120.0)

    print("\n=== REAL BUG TEST RESULT ===")
    print(f"Score: {result['platform']['score']}")
    print(f"Accepted: {result['platform']['accepted']}  Failed: {result['platform']['failed']}")
    print(f"Submissions: {result['metrics']['counters'].get('submissions', 0)}")
    print(f"Accepted counter: {result['metrics']['counters'].get('accepted', 0)}")
    print(f"Failed counter: {result['metrics']['counters'].get('failed', 0)}")
    print(f"Events: {result['events']}")


if __name__ == "__main__":
    main()