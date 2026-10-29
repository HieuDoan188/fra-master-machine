---
name: workflow-cr
description: Change Request workflow (legacy cr_squad + workflows/change_request). Use for CR items from plan_next.
---

# Change Request

Time budget: **15 minutes**. Points come from the server (`points`); CRs are often the largest item, so start them early rather than late.

1. `start_work`. Turn the brief into acceptance criteria yourself (one line each) and put them in the worker prompt. Spawn `team_repo_scout` only when the affected area is unclear.
2. **Scope it.** Implement exactly what the acceptance criteria ask, no more. If the brief is ambiguous, pick the reading the existing UX conventions support and note it in `changeSummary`.
3. **Schema changes.** Never edit old migrations. Create the new one with `pnpm prisma migrate dev --create-only --name <id>`. It must not prompt: if it asks to reset the database or fails on drift, write `prisma/schema/migrations/<yyyymmddhhmmss>_<id>/migration.sql` by hand instead. Then run `pnpm prisma migrate deploy` and `pnpm prisma generate`, and run the seed again if it is affected. The tests migrate the test database themselves (`tests/global-setup.ts`).
4. **Tests.** One test per acceptance criterion, plus the MVS, plus the existing tests of the touched routers and services. Keep `pnpm typecheck` green.
5. Evidence, gate, submit as soon as the MVS and acceptance tests pass.
