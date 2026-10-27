---
name: workflow-pi
description: Product Incident workflow (legacy pi_squad + workflows/product_incident). Use when plan_next returns START_PI/CONTINUE_PI. Restore production behaviour fast - MTTR beats elegance.
---

# Product Incident (PI) — priority 100, overrides everything

MTTR target: **8 minutes** (`plan_next.incidents[].overMttrTarget`). Restoring the service is worth more than an elegant fix.

1. **Register & preempt.** If `plan_next.preempt` is set, park the current item. Leave its edits uncommitted, or `git stash push -m <ID>`, but never commit half-done work to the branch. Then call `start_work` for the PI.
2. **Investigate (investigator).** Reproduce the incident first, with a failing test or a minimal script. Use `scan_repo({impactOf:"<module or symptom>"})` to list suspect files. Write down at most 2 or 3 hypotheses.
3. **Root cause.** Confirm one hypothesis with evidence (log line, failing assertion). If none holds within ~3 minutes, take the most likely one and contain it.
4. **Commander fix.** Make the smallest change that restores the behaviour: a guard, a revert of the faulty logic, or a correct default. Do not refactor.
5. **Validator.** Turn the reproduction into a regression test. Run the MVS scenarios plus the existing tests of the impacted module. Save the output to `answers/<ID>/evidence/`.
6. **Gate.** `report_verification` with real counts and an honest review. Rework until it approves.
7. **Submit.** Fill submit.json, commit everything together, push, `submit_work`. Then unpark the previous item (`git stash pop`) and call `plan_next`.
