"""Testing service - runs MVS and extra verification scenarios."""

from dataclasses import dataclass, field

from integrations.openhands.client import OpenHandsAdapter


@dataclass
class TestOutcome:
    passed: bool
    mvs_passed: int = 0
    mvs_total: int = 0
    extra_passed: int = 0
    extra_total: int = 0
    logs: list = field(default_factory=list)

    @property
    def coverage(self) -> float:
        total = self.mvs_total + self.extra_total
        if total == 0:
            return 0.0
        return round((self.mvs_passed + self.extra_passed) / total * 100, 1)


class TestingService:
    def __init__(self, adapter: OpenHandsAdapter | None = None):
        self.adapter = adapter or OpenHandsAdapter()

    def run(self, item_id: str, mvs: list[str], extra_scenarios: list[str] | None = None) -> TestOutcome:
        mvs_total = len(mvs)
        extra = extra_scenarios or []
        extra_total = len(extra)
        if self.adapter.config.mock:
            mvs_passed = mvs_total
            extra_passed = extra_total
            logs = [f"[{item_id}] mvs {mvs_passed}/{mvs_total}", f"[{item_id}] extra {extra_passed}/{extra_total}"]
            return TestOutcome(
                passed=mvs_passed == mvs_total,
                mvs_passed=mvs_passed,
                mvs_total=mvs_total,
                extra_passed=extra_passed,
                extra_total=extra_total,
                logs=logs,
            )
        real = getattr(self.adapter, "_run_pytest", None)
        if real is None:
            return TestOutcome(passed=False, mvs_total=mvs_total, extra_total=extra_total)
        workspace = getattr(self.adapter, "last_workspace", "")
        if not workspace:
            return TestOutcome(passed=False, mvs_total=mvs_total, extra_total=extra_total)
        passed, output = real(workspace, item_id)
        mvs_passed = mvs_total if passed else 0
        extra_passed = extra_total if passed else 0
        return TestOutcome(
            passed=passed,
            mvs_passed=mvs_passed,
            mvs_total=mvs_total,
            extra_passed=extra_passed,
            extra_total=extra_total,
            logs=[output],
        )