"""Match runner - wires every component into a full simulated match."""

import time

from agents.coverage.coverage import CoverageAgent
from agents.director.director import DirectorAgent
from agents.observer.observer import MatchObserver
from agents.pi_squad.commander import PiCommander
from agents.planner.planner import PlannerAgent
from agents.review.review import ReviewAgent
from agents.submission.authority import SubmissionAuthority
from agents.task_squad.base_squad import BaseSquad
from agents.task_squad.squad import TaskSquad
from agents.bug_squad.squad import BugSquad
from agents.cr_squad.squad import CrSquad
from core.event_bus.bus import EventBus, EventType
from core.lifecycle.controller import LifecycleController
from core.state_machine.match_state import MatchState
from integrations.openhands.task_runner import TaskRunner
from memory.match_memory.store import MatchMemory
from memory.task_memory.store import TaskMemory
from observability.alerts.manager import AlertManager
from observability.health_checks.checker import HealthChecker
from observability.metrics.collector import Metrics
from observability.watchdog import Watchdog
from services.backlog_service.service import BacklogService
from services.deadline_service.service import DeadlineService
from services.incident_service.service import IncidentService
from services.scoring_service.service import ScoringService
from services.submission_service.service import SubmissionService
from services.testing_service.service import TestingService
from simulator.incident_generator.generator import IncidentGenerator
from simulator.match_runner.platform import SimulatedPlatform
from tools.match_api.client import MatchApiClient, MatchApiConfig, MatchItem


class SimulatedMatchApi(MatchApiClient):
    """MatchApiClient backed by the SimulatedPlatform instead of HTTP."""

    def __init__(self, platform: SimulatedPlatform):
        super().__init__(MatchApiConfig(mock=True))
        self.platform = platform

    def get_items(self) -> list[MatchItem]:
        return [
            MatchItem(item_id=i.item_id, item_type=i.item_type.value, title=i.title, deadline_minutes=(i.deadline_seconds_left or 999) / 60)
            for i in self.platform.list_items()
        ]

    def get_scoreboard(self) -> dict:
        return self.platform.scoreboard()

    def get_mvs(self, item_id: str) -> list[str]:
        return self.platform.get_mvs(item_id)

    def start_working(self, item_id: str) -> dict:
        return self.platform.start_working(item_id)

    def submit(self, item_id: str, patch: str, evidence: dict | None = None) -> dict:
        return self.platform.submit(item_id, patch, evidence)


class MatchRunner:
    def __init__(self, platform: SimulatedPlatform, repo_path: str = "/tmp/repo", adapter=None, parallelism: int = 1, max_retries: int = 3):
        self.platform = platform
        self.parallelism = parallelism
        self.max_retries = max_retries
        self.state = MatchState()
        self.state.__dict__["repo_path"] = repo_path
        self.bus = EventBus()
        self.metrics = Metrics()
        self.match_memory = MatchMemory(reset=True)
        self.task_memory = TaskMemory()
        self.lifecycle = LifecycleController(bus=self.bus)
        self.incidents = IncidentService(self.state, self.bus)
        self.api = SimulatedMatchApi(platform)
        self.adapter = adapter

        self.backlog = BacklogService(self.api, self.state, self.bus)
        self.deadline = DeadlineService(self.state, self.bus, lifecycle=self.lifecycle)
        self.observer = MatchObserver(self.api, self.state, self.bus, self.backlog, self.deadline, poll_interval=1.0)

        self.scoring = ScoringService(self.state)
        self.planner = PlannerAgent(self.state, self.bus, memory=self.match_memory)
        self.director = DirectorAgent(self.state, self.bus)
        self.testing = TestingService(adapter=self.adapter) if self.adapter else TestingService()
        self.coverage = CoverageAgent()
        self.reviewer = ReviewAgent()
        self.submissions = SubmissionService(self.api, self.state, self.bus)
        self.authority = SubmissionAuthority(self.submissions, self.testing, self.lifecycle, self.task_memory, self.match_memory)

        self.squads: dict[str, BaseSquad] = {
            "task_squad": TaskSquad(self.state, self.bus, self.lifecycle, runner=self._runner(), task_memory=self.task_memory, match_memory=self.match_memory),
            "bug_squad": BugSquad(self.state, self.bus, self.lifecycle, runner=self._runner(), task_memory=self.task_memory, match_memory=self.match_memory),
            "cr_squad": CrSquad(self.state, self.bus, self.lifecycle, runner=self._runner(), task_memory=self.task_memory, match_memory=self.match_memory),
        }
        self.pi_commander = PiCommander(
            self.state, self.bus, self.lifecycle, self.incidents, runner=self._runner(), task_memory=self.task_memory, match_memory=self.match_memory
        )

        self.health = HealthChecker(self.state, self.metrics)
        self.alerts = AlertManager(self.bus)
        self.watchdog = Watchdog(self.state, self.health, self.task_memory, lifecycle=self.lifecycle)
        for name, squad in self.squads.items():
            self.watchdog.register_squad(name, squad)

        self.incident_gen = IncidentGenerator()

    def _runner(self) -> TaskRunner:
        if self.adapter is not None:
            return TaskRunner(adapter=self.adapter)
        return TaskRunner()

    def run(self, total_seconds: float = 420.0) -> dict:
        started = time.monotonic()
        self.observer.start()
        incidents = self.incident_gen.schedule(total_seconds, 3)
        incident_queue = list(incidents)

        elapsed = 0.0
        step = 1.0
        while elapsed < total_seconds:
            elapsed += step
            self.observer.tick(step)
            for at, item in list(incident_queue):
                if elapsed >= at:
                    self.platform.items[item.item_id] = item
                    self.state.upsert_item(item)
                    self.bus.emit(EventType.PI_CREATED, {"item_id": item.item_id})
                    incident_queue.remove((at, item))

            self.process_work(elapsed)
            problems = self.health.check()
            self.alerts.evaluate(problems)
            self.watchdog.revive()
            self.metrics.set("elapsed", elapsed)
            if not self.state.active_items() and not incident_queue:
                self.metrics.inc("early_finish")
                break

        self.observer.stop()
        self.metrics.inc("match_completed")
        return self.summary(started)

    def process_work(self, elapsed: float) -> None:
        actions = self.planner.replan()
        sdlc_jobs = []
        for action in actions:
            item = self.state.get_item(action.item_id)
            if item is None or item.status.value not in ("VISIBLE", "STARTED", "IMPLEMENTING"):
                continue
            self.match_memory.record_decision(action.item_id, action.action, action.reason)
            if action.action == "START_PI":
                self.handle_pi(item)
            elif action.action in ("START_WORKING", "CONTINUE"):
                sdlc_jobs.append((item, action.squad))
        if sdlc_jobs:
            self._run_sdlc_parallel(sdlc_jobs)

    def _run_sdlc_parallel(self, jobs: list[tuple]) -> None:
        if self.parallelism <= 1 or len(jobs) <= 1:
            for item, squad in jobs:
                self.handle_sdlc(item, squad)
            return
        from concurrent.futures import ThreadPoolExecutor

        def run_one(job):
            item, squad = job
            adapter = self._fresh_adapter()
            self.handle_sdlc(item, squad, adapter=adapter)

        with ThreadPoolExecutor(max_workers=self.parallelism) as pool:
            futures = [pool.submit(run_one, job) for job in jobs]
            for fut in futures:
                fut.result()

    def _fresh_adapter(self):
        if self.adapter is None:
            return None
        return type(self.adapter)(patches=getattr(self.adapter, "patches", None))

    def handle_pi(self, item) -> None:
        t0 = time.monotonic()
        self.api.start_working(item.item_id)
        item.mvs = self.api.get_mvs(item.item_id)
        attempts = self._attempts(item.item_id)
        while attempts < self.max_retries:
            attempts += 1
            self._set_attempts(item.item_id, attempts)
            result = self.pi_commander.handle(item)
            if result.get("verdict") != "VALIDATED":
                self.lifecycle.rework(item)
                continue
            gate = self.finalize(item, pi=True)
            if gate.get("submitted"):
                break
            self.lifecycle.rework(item)
        if item.status.value not in ("SUBMITTED", "FAILED", "CLOSED"):
            self.lifecycle.fail(item)
        self.metrics.time("pi_item", time.monotonic() - t0)

    def handle_sdlc(self, item, squad_name: str, adapter=None) -> None:
        t0 = time.monotonic()
        self.api.start_working(item.item_id)
        item.mvs = self.api.get_mvs(item.item_id)
        squad = self.squads.get(squad_name)
        if squad is None:
            return
        attempts = self._attempts(item.item_id)
        while attempts < self.max_retries:
            attempts += 1
            self._set_attempts(item.item_id, attempts)
            if adapter is not None:
                squad = self._clone_squad(squad_name, adapter)
            squad.handle(item)
            gate = self.finalize(item, adapter=adapter)
            if gate.get("submitted"):
                break
            self.lifecycle.rework(item)
        if item.status.value not in ("SUBMITTED", "FAILED", "CLOSED"):
            self.lifecycle.fail(item)
        self.metrics.time("sdlc_item", time.monotonic() - t0)

    def _attempts(self, item_id: str) -> int:
        return self.task_memory.load(item_id).get("attempts", 0)

    def _set_attempts(self, item_id: str, value: int) -> None:
        record = self.task_memory.load(item_id)
        record["attempts"] = value
        self.task_memory.checkpoint(item_id, {"attempts": value})

    def _clone_squad(self, squad_name: str, adapter) -> BaseSquad:
        cls = type(self.squads[squad_name])
        return cls(
            self.state,
            self.bus,
            self.lifecycle,
            runner=TaskRunner(adapter=adapter),
            task_memory=self.task_memory,
            match_memory=self.match_memory,
        )

    def finalize(self, item, pi: bool = False, adapter=None) -> dict:
        if item.status.value in ("SUBMITTED", "FAILED", "CLOSED"):
            return {"submitted": False}
        scenarios = self.coverage.generate_scenarios(item)
        testing = TestingService(adapter=adapter) if adapter is not None else self.testing
        outcome = testing.run(item.item_id, item.mvs, scenarios)
        coverage = self.coverage.estimate_coverage(item, outcome.passed, scenarios)
        review = self.reviewer.review(item)
        self.task_memory.add_evidence(
            item.item_id,
            {"coverage": coverage, "mvs": outcome.mvs_passed, "review": review.get("confidence")},
        )
        authority = self.authority
        if adapter is not None:
            authority = SubmissionAuthority(
                self.submissions, testing, self.lifecycle, self.task_memory, self.match_memory
            )
        gate = authority.gate(item, outcome, review)
        if gate.get("submitted"):
            self.metrics.inc("submissions")
            if gate.get("result", {}).get("status") == "accepted":
                self.metrics.inc("accepted")
            else:
                self.metrics.inc("failed")
        return gate

    def summary(self, started: float) -> dict:
        return {
            "wall_seconds": round(time.monotonic() - started, 1),
            "simulated_seconds": round(self.state.elapsed_seconds, 1),
            "platform": {
                "score": self.platform.result.score,
                "accepted": self.platform.result.accepted,
                "failed": self.platform.result.failed,
                "pi_positions": self.platform.result.pi_positions,
            },
            "state_score": self.state.scoreboard.score,
            "metrics": self.metrics.snapshot(),
            "events": len(self.bus.history()),
            "decisions": self.match_memory.stats()["decisions"],
        }