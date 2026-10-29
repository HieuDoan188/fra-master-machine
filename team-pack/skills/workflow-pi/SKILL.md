---
name: workflow-pi
description: Product Incident workflow (legacy pi_squad + workflows/product_incident). Use when plan_next returns START_PI/CONTINUE_PI. Restore production behaviour fast - MTTR beats elegance.
---

# Product Incident (PI): overrides everything

Time budget and MTTR target: **8 minutes** (`plan_next.incidents[].overMttrTarget`). Restoring the service is worth more than an elegant fix.

1. **Park the current item.** Tell its worker with `send_message` to stop and report its state, then wait for that report. Do not reset or commit its half-done edits. If the PI will touch the same files, `git stash push -m <parkedID> -- <those paths>`.
2. `start_work` for the PI, then spawn a fresh worker with the PI brief, MVS, KB text and the 8-minute budget.
3. **Investigate.** Reproduce with a failing test or a minimal script. `scan_repo({impactOf:"<module or symptom>"})` lists suspect files. Keep at most 2 or 3 hypotheses; if none is confirmed within 3 minutes, contain the most likely one.
4. **Fix** with the smallest change that restores the behaviour: a guard, a revert of the faulty logic, or a correct default. No refactor.
5. **Validate.** The reproduction becomes a regression test. Run the MVS and the existing tests of the impacted module, with output in `answers/<ID>/evidence/`.
6. **Gate and submit.** Commit only the PI's files by explicit path (`git add -- <paths>`, never `git add -A` while parked edits exist), push, `submit_work`.
7. **Resume.** `git stash pop` if you stashed, then `plan_next` and give the parked item to a fresh worker with the previous worker's report.
