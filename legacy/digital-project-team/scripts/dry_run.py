"""Dry run - full simulated match: 20 BUG + 10 CR + 5 TASK + 5 PI.

Usage: python -m scripts.dry_run
"""

from simulator.backlog_generator.generator import BacklogGenerator, BacklogProfile
from simulator.match_runner.platform import SimulatedPlatform
from simulator.match_runner.runner import MatchRunner


def main() -> None:
    profile = BacklogProfile(bugs=20, crs=10, tasks=5, pis=5)
    items = BacklogGenerator().generate(profile)
    platform = SimulatedPlatform(items)
    runner = MatchRunner(platform, repo_path="/workspace/target-repositories/sample-fastapi")
    result = runner.run(total_seconds=420.0)

    print("\n=== DRY RUN RESULT ===")
    print(f"Wall time: {result['wall_seconds']}s (simulated {result['simulated_seconds']}s)")
    print(f"Score: {result['platform']['score']}")
    print(f"Accepted: {result['platform']['accepted']}  Failed: {result['platform']['failed']}")
    print(f"PI positions: {result['platform']['pi_positions']}")
    print(f"Events emitted: {result['events']}")
    print(f"Decisions recorded: {result['decisions']}")
    print(f"Metrics: {result['metrics']['counters']}")


if __name__ == "__main__":
    main()