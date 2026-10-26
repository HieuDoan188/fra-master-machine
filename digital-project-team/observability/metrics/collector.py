"""Metrics collector - counters and gauges for the whole match."""

import threading
import time
from collections import Counter


class Metrics:
    def __init__(self):
        self._lock = threading.Lock()
        self.counters: Counter = Counter()
        self.gauges: dict[str, float] = {}
        self.timings: dict[str, list[float]] = {}
        self.started_at = time.time()

    def inc(self, name: str, value: int = 1) -> None:
        with self._lock:
            self.counters[name] += value

    def set(self, name: str, value: float) -> None:
        with self._lock:
            self.gauges[name] = value

    def time(self, name: str, seconds: float) -> None:
        with self._lock:
            self.timings.setdefault(name, []).append(seconds)

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "counters": dict(self.counters),
                "gauges": dict(self.gauges),
                "avg_timings": {k: round(sum(v) / len(v), 3) for k, v in self.timings.items() if v},
                "uptime_seconds": round(time.time() - self.started_at, 1),
            }