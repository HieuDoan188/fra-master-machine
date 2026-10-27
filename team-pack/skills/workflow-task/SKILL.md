---
name: workflow-task
description: Task workflow (legacy task_squad + workflows/task_execution). Use for TASK items from plan_next.
---

# Task — priority 20

Steps: start_working → implement → verify → submit.

1. `start_work`. Read `startInstruction` and the template fields. Tasks are often the cheapest points, so finish them quickly.
2. Implement directly (no subagent needed unless the task is large).
3. **Even without MVS the gate needs scenarios**: coverage is computed over MVS plus extra scenarios, so write at least one or two real checks (a test, or a script with its output).
4. Evidence, honest review, `report_verification`, then commit, push, `submit_work`.
