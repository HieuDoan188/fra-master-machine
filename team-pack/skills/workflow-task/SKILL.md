---
name: workflow-task
description: Task workflow (legacy task_squad + workflows/task_execution). Use for TASK items from plan_next.
---

# Task

Time budget: **10 minutes**. Points come from the server (`points`); a TASK can be worth as much as a CR, so do not treat it as filler.

1. `start_work`. Read `startInstruction`, the template fields and any official runner (`challenge/<ID>-run-checks.mjs` or similar). The runner defines "done".
2. Implement the smallest change the brief asks for (for example a dependency upgrade: patched versions only, no major upgrades unless the advisory requires one).
3. Run the official runner. **When it passes and the MVS are covered, gate and submit.** Extra smoke checks (login, build) are worth doing only if the brief or the MVS name them.
4. Even without MVS the gate needs scenarios: coverage is computed over MVS plus extra scenarios, so keep one or two real checks with their output as evidence.
