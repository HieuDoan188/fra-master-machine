"""Parallel processor - runs independent verification steps concurrently."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable


class ParallelProcessor:
    def __init__(self, max_workers: int = 4):
        self.max_workers = max_workers

    def run(self, tasks: list[tuple[str, Callable]]) -> dict[str, object]:
        results: dict[str, object] = {}
        with ThreadPoolExecutor(max_workers=self.max_workers) as pool:
            futures = {pool.submit(fn): name for name, fn in tasks}
            for future in as_completed(futures):
                name = futures[future]
                try:
                    results[name] = future.result()
                except Exception as exc:
                    results[name] = {"error": str(exc)}
        return results