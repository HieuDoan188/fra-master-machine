"""Benchmark - 100 deterministic bugs through the full DPT pipeline.

Measures: accuracy, throughput, speed per item, deadline misses, MTTR,
decision overhead.

Usage: python -m scripts.benchmark
"""

import tempfile
import time

from core.contracts.models import Item, ItemType
from core.scoring.priority_engine import BASE_PRIORITY
from integrations.openhands.real_adapter import RealAdapter
from simulator.benchmark_repo import BenchmarkRepoBuilder
from simulator.match_runner.platform import SimulatedPlatform
from simulator.match_runner.runner import MatchRunner

NUM_BUGS = 100
SIMULATED_SECONDS = 840.0


def main() -> None:
    started = time.monotonic()
    work_root = tempfile.mkdtemp(prefix="dpt-bench-")
    repo_path, patches = BenchmarkRepoBuilder(work_root, NUM_BUGS).build()

    items = [
        Item(
            item_id=f"BUG-{i:03d}",
            item_type=ItemType.BUG,
            title=f"bug {i}",
            deadline_seconds_left=SIMULATED_SECONDS - (i - 1) * (SIMULATED_SECONDS * 0.5 / NUM_BUGS),
            priority_base=BASE_PRIORITY[ItemType.BUG],
            mvs=[f"BUG-{i:03d} MVS passes"],
        )
        for i in range(1, NUM_BUGS + 1)
    ]

    platform = SimulatedPlatform(items)
    runner = MatchRunner(platform, repo_path=repo_path, adapter=RealAdapter(patches=patches), parallelism=4)
    result = runner.run(total_seconds=SIMULATED_SECONDS)
    wall = time.monotonic() - started

    platform_stats = result["platform"]
    total = NUM_BUGS
    accepted = platform_stats["accepted"]
    failed = platform_stats["failed"]
    accuracy = accepted / total * 100 if total else 0.0
    throughput = accepted / (wall / 60) if wall else 0.0
    per_item = wall / max(accepted, 1)

    print("\n========== BENCHMARK: 100 BUGS (deterministic, real pytest) ==========")
    print(f"Wall time:            {wall:.1f}s  (simulated {SIMULATED_SECONDS:.0f}s)")
    print(f"Accuracy:             {accuracy:.1f}%  ({accepted}/{total} accepted, {failed} failed)")
    print(f"Throughput:           {throughput:.2f} items/min")
    print(f"Speed per item:       {per_item:.2f}s/item")
    print(f"Decision overhead:    {result['decisions']} decisions recorded")
    print(f"Events emitted:       {result['events']}")
    print(f"Metrics counters:     {result['metrics']['counters']}")
    print(f"Avg timings:          {result['metrics'].get('avg_timings', {})}")
    print("========================================================================")


if __name__ == "__main__":
    main()