---
name: game-preparation
description: Preparation phase for an MTM match after PREPARE_GAME_V2 - verify Git, check out the assigned source, prepare the environment, build, log in to the match and report ENVIRONMENT_READY. No backlog work, no push.
---

# Game preparation

The input carries the repository, the account, the paths and the model policy. It has **no bearer key**. Do not start backlog work and do not push in this phase. To save tokens and turns, batch shell work into a few combined commands (clone + HEAD SHA; install + generate + migrate + seed + doctor; typecheck + build + test) and do not read BUILD_STATE.md, DECISIONS.md or source files during preparation. Every step logs `PREPARATION_STATUS` through `report_progress` as `IN_PROGRESS` at the start and `COMPLETED`, `FAILED` or `BLOCKED` at the end. Report `COMPLETED` only after the step really succeeded.

0. `configure_session({input: <whole PREPARE_GAME_V2 message>})`. The helper validates paths and scope and logs ORCHESTRATOR_STARTED. Keep the returned `checkoutRoot`, `matchRoot` and `repository`. Read `AGENTS.md` in the team workspace if it exists.

1. **GIT_AUTH.** Run `git ls-remote <repository.url> refs/heads/<branch>` using the host's Git credential helper. Never put tokens in the URL. If it asks for authentication, report `BLOCKED` with `{type:"BLOCKER_OPENED", blockerId:"GIT_AUTHENTICATION_REQUIRED", backlogId:null, summary}` and wait for the operator.

2. **REPOSITORY.** Clone into `checkoutRoot` (`git clone --branch <branch> <url> <checkoutRoot>`), or fetch and check out if it already exists. Confirm that `<checkoutRoot>/<folder>` exists, then record `git rev-parse HEAD`.

3. **ENVIRONMENT.** Read `<matchRoot>/README.md` and `<matchRoot>/env-require/README.md` (and `requirements.json`) if present, and do exactly what they say. The operator has already installed the machine-level parts (Node, pnpm, PostgreSQL 16 on 127.0.0.1:**5433**, the `freelanceos` role from `db-setup.sql`). Never use Docker or a production database. For the Solova scenario:
   - **Database credentials come from the operator's environment variables**: `MTM_DATABASE_URL`, `MTM_TEST_DATABASE_URL` and `MTM_AUTH_SECRET`. Create `src/.env` from `src/.env.example` and replace only `DATABASE_URL`, `TEST_DATABASE_URL` and `AUTH_SECRET` with those values, without printing them. For example, in PowerShell:
     `$t = Get-Content src/.env.example -Raw; $t = $t -replace '(?m)^DATABASE_URL=.*$', "DATABASE_URL=`"$env:MTM_DATABASE_URL`"" -replace '(?m)^TEST_DATABASE_URL=.*$', "TEST_DATABASE_URL=`"$env:MTM_TEST_DATABASE_URL`"" -replace '(?m)^AUTH_SECRET=.*$', "AUTH_SECRET=`"$env:MTM_AUTH_SECRET`""; Set-Content src/.env $t -NoNewline`
     If any of the three variables is missing, report `BLOCKED` with blocker `DB_CREDENTIALS_MISSING`. Never commit `.env` (it is gitignored; confirm with `git status`). Never read credential files outside the workspace.
   - If nothing listens on 127.0.0.1:5433, report `BLOCKED` with blocker `POSTGRES_DOWN`. The operator starts the database.
   - In `src/`: `pnpm install --frozen-lockfile`, then **`pnpm prisma generate`** (pnpm 10 skips the Prisma postinstall, and the build fails with implicit-`any` errors without it), then `pnpm prisma migrate deploy` and `pnpm db:seed`. Set `PRISMA_HIDE_UPDATE_MESSAGE=1` and ignore Prisma "Update available" notices.
   - Run `env-require/doctor.ps1`; ENVIRONMENT is `COMPLETED` only when it prints `Environment status: READY`.
   - Do not modify tests to work around missing database privileges. That is environment setup (see `db-setup.sql`). Do not change `exam-info.json`.

4. **BUILD.** `pnpm typecheck` and `pnpm build` must pass for `COMPLETED`; if either fails, report `FAILED`. Then run the baseline `pnpm test` and record the real counts. **Pre-existing failing tests do not block readiness.** They are usually the planted defects that later backlog items ask you to fix (for example, the Solova practice repo ships 11/12 passing). Record the failing test names in your notes and in the BUILD summary, for example "Build passed; baseline tests 11/12 (cascade RESTRICT test fails pre-existing)".

5. **MATCH_LOGIN.** Call `login_match`. The helper logs in, opens the exact match, checks team, repository, branch and folder against the input, and logs `MATCH_LOGIN`. On `ASSIGNMENT_MISMATCH`, stop and open a blocker.

6. **ENVIRONMENT_READY.** Call `report_progress({event:{type:"ENVIRONMENT_READY"}})`. The helper fills in requestId, repository and the HEAD revision, and refuses if login or build has not passed.

7. Stop and wait. mtm-player validates the log and reports PREPARED to the server. Backlog work starts only when `START_GAME_V4` arrives. There is no operator command for it.
