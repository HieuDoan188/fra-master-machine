---
name: workflow-cr
description: Change Request workflow (legacy cr_squad + workflows/change_request). Use for CR items from plan_next.
---

# Change Request — priority 50

Steps: start_working → implement → verify → review → submit.

1. `start_work`, then spawn `team_repo_scout` for acceptance criteria and the affected areas: UI, API (tRPC routers), schema (Prisma), tests.
2. **Scope it.** Implement exactly what the acceptance criteria ask, no more. If the brief is ambiguous, pick the reading the existing UX conventions support and note it in `changeSummary`.
3. **Schema changes.** Add a Prisma migration (`pnpm prisma migrate dev --name <id>` against the local dev DB), never edit old migrations, and run the seed again if it is affected.
4. **Tests.** One test per acceptance criterion, plus the MVS, plus regression for the touched routers and services. Keep `pnpm typecheck` green.
5. Evidence files, an honest review, then `report_verification`, rework until approved, then commit, push, `submit_work`.
