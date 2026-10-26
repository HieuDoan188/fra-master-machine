# Fra Master Machine — Digital Project Team OS

An autonomous software-vendor team for the **Master The Machine** competition. The system observes a backlog, prioritizes work by expected value, fixes bugs / implements features / responds to product incidents, verifies with real tests, and submits — all without human intervention.

Built as a "software company" layered on top of [OpenHands](https://github.com/All-Hands-AI/OpenHands) as the coding engine.

## Repository layout

```
fra-master-machine/
├── digital-project-team/     # Competition brain (orchestration, agents, simulator)
├── openhands-fork/           # OpenHands fork — the coding engine (LLM agent loop)
└── target-repositories/      # Target repos for experiments (sample-fastapi, fastapi)
```

| Part | Role | Analogy |
|------|------|---------|
| `digital-project-team/` | Decides what to do, when, and whether to submit | CEO + PM + QA + Release Manager |
| `openhands-fork/` | Reads code, understands bugs, writes patches | Developers |
| `target-repositories/` | Where the team "works" (test subjects) | Client projects |

## Architecture

```
Match API / SimulatedPlatform
        │  poll every second
        ▼
┌─────────────────────────────────────────────────────────────┐
│ MatchObserver      → detect new items / PI / deadlines       │
│ PlannerAgent       → EV = score × success × deadline factor  │
│ DirectorAgent      → allocate items to squads                │
│ Squads (bug/cr/task/PI) → execute via coding engine          │
│ CoverageAgent      → ≥90% test coverage required             │
│ ReviewAgent        → confidence ≥85%, regression ≤10%        │
│ SubmissionAuthority→ final gate (5 checks) → submit once     │
└─────────────────────────────────────────────────────────────┘
```

Coordination agents are **pure code** (fast, zero token cost, deterministic); only the coding engine consumes LLM tokens — where creativity is actually needed.

## Key features

- **Fully autonomous loop** — bug appears → fix → verify → submit, with automatic retry (max N attempts) on failed fixes or rejected gates. No human approval anywhere in the loop.
- **State machine enforced** — every item moves through a legal lifecycle (`VISIBLE → STARTED → IMPLEMENTING → VERIFYING → SUBMITTED/FAILED/CLOSED`); illegal transitions are rejected.
- **EV-driven planning** — Product Incidents always win, everything else ranked by expected value across the whole portfolio.
- **Real verification** — patches are applied to a sandbox copy and validated by running actual `pytest` (MVS + extra scenarios).
- **Deterministic simulator** — no randomness; reproducible matches for benchmarking.
- **Resilience** — watchdog revives stuck items, deadline service closes expired items, checkpoints survive crashes.

## Results

| Experiment | Result |
|---|---|
| Unit tests | 16/16 pass |
| Full-match dry run (43 items) | Score 2565 · 43/43 accepted · 0 failed |
| Real bug fix (FastAPI, injected bugs) | 3/3 fixed with real pytest |
| Benchmark — 100 deterministic bugs | **100/100 accepted · 0 failed · 112.7s · 53.2 items/min** |

## Getting started

```bash
cd digital-project-team
pip install -e .

# 1. Unit tests
python3 -m unittest discover -s tests -t .

# 2. Full-match simulation (43 items)
python3 -m scripts.dry_run

# 3. Real-bug experiment on FastAPI (injected bugs, real pytest)
python3 -m scripts.real_bug_test

# 4. 100-bug benchmark
python3 -m scripts.benchmark
```

## Connecting a real coding engine

By default the system runs in **mock mode** (`RealAdapter`) with pre-written patches — used to validate orchestration. To use a real engine (OpenHands or any LLM API):

```bash
export OPENHANDS_MOCK=0
export OPENHANDS_BASE_URL=http://<openhands-server>:3000
```

Then swap the adapter in `simulator/match_runner/runner.py` from `RealAdapter` to `OpenHandsAdapter` (or any adapter implementing `execute_task(task, workspace, session_id)` — the interface is isolated so the brain never changes).

## Documentation

- `digital-project-team/docs/PLAN.md` — full roadmap (Phase 0 → 12) and status
- `digital-project-team/competitions/master_the_machine/rules/` — competition rules, scoring framework, risk register, design principles

## Security

Never commit credentials. `token.json`, `secrets/`, `*.pem`, `*.key` are gitignored.