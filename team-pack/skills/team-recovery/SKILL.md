---
name: team-recovery
description: Resume, pause, end and failure handling for the MTM Team Orchestrator - RESUME_PREPARATION_V1, RESUME_GAME_V1, MATCH_PAUSED_V1, MATCH_ENDED_V1, timeouts and blockers.
---

# Recovery

## Resume (`RESUME_PREPARATION_V1` / `RESUME_GAME_V1`)

A replacement orchestrator gets fresh access and the saved paths. A new *init* is a new round, even when the match code is the same.

1. `configure_session({input})`. The helper reads the existing progress log, rebuilds item states and receipts, and logs `ORCHESTRATOR_RESTARTED`.
2. Reconcile before doing anything:
   - `session_status` shows the known backlog and the submissions that already have receipts. **Never resubmit an item that has a receipt.**
   - In `checkoutRoot`, run `git status`, `git log --oneline -5` and `git fetch origin`. Keep uncommitted work for the item you were on and check whether it was pushed.
   - The brain's state is rebuilt from the log. Items that were verified but not yet submitted come back as VERIFYING, because the gate result is not stored. Run the tests again and call `report_verification` before `submit_work`.
   - `plan_next` reconciles the server view. For an item that is `IN_PROGRESS` in the log, call `start_work` again (it is idempotent: `replay: true`) to get the template back, then continue.
3. Continue with preparation (game-preparation skill) or with the game loop (team-orchestrator skill).

## Pause (`MATCH_PAUSED_V1`)

Call `configure_session({input})` immediately. Stop new API calls, Git operations, workers and polling. Keep source and evidence. Do **not** log ORCHESTRATOR_ENDED. Wait for a resume input. Do not respawn yourself.

## End (`MATCH_ENDED_V1`)

Call `configure_session({input})`. The helper logs `ORCHESTRATOR_ENDED COMPLETED` and drops its credentials. Do not commit, push or submit anything after this. Return the final result JSON (status `SUBMITTED`, `BLOCKED` or `FAILED`, never `COMPLETED`).

## Common failures

| Situation | Action |
|---|---|
| Cookie expired (`SESSION_EXPIRED`) | `refresh_match` logs in again by itself; if that fails, call `login_match` |
| Bearer rejected (401/403 on Start/Submit) | `BLOCKER_OPENED BEARER_REJECTED`, then wait for mtm-player recovery |
| Submit timeout / 5xx / 429 | `submit_work` again with identical arguments (same Idempotency-Key). Respect `retryAfterSec` |
| `UNCERTAIN_SUBMISSION_PENDING` | You changed the body. Resend the original revision and answer |
| `409 BACKLOG_ITEM_CLOSED` / deadline passed | Drop the item and pick the next one |
| Empty backlog | `wait_for_update`. This is not the end of the match |
| Progress append failed | The helper queues and retries. If it keeps failing, `BLOCKER_OPENED PROGRESS_LOG_UNAVAILABLE` |
| Workspace moved | The operator re-runs `install.ps1` and reloads the session |
