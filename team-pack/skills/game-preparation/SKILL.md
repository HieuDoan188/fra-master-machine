---
name: game-preparation
description: Preparation phase for an MTM match after PREPARE_GAME_V2 - verify Git, check out the assigned source, prepare the environment, build, log in to the match and report ENVIRONMENT_READY. No backlog work, no push.
---

# Game preparation

The input carries the repository, the account, the paths and the model policy. It has **no bearer key**. Do not start backlog work and do not push in this phase. Every step logs `PREPARATION_STATUS` through `report_progress` as `IN_PROGRESS` at the start and `COMPLETED`, `FAILED` or `BLOCKED` at the end. Report `COMPLETED` only after the step really succeeded.

0. `configure_session({input: <whole PREPARE_GAME_V2 message>})`. The helper validates paths and scope and logs ORCHESTRATOR_STARTED. Keep the returned `checkoutRoot`, `matchRoot` and `repository`. Read `AGENTS.md` in the team workspace if it exists.

1. **GIT_AUTH.** Run `git ls-remote <repository.url> refs/heads/<branch>` using the host's Git credential helper. Never put tokens in the URL. If it asks for authentication, report `BLOCKED` with `{type:"BLOCKER_OPENED", blockerId:"GIT_AUTHENTICATION_REQUIRED", backlogId:null, summary}` and wait for the operator.

2. **REPOSITORY.** Clone into `checkoutRoot` (`git clone --branch <branch> <url> <checkoutRoot>`), or fetch and check out if it already exists. Confirm that `<checkoutRoot>/<folder>` exists, then record `git rev-parse HEAD`.

3. **ENVIRONMENT.** Read `<matchRoot>/README.md` and `<matchRoot>/env-require/README.md` (and `requirements.json`) if present, and do exactly what they say. For the current Solova scenario this means:
   - Node 20+, pnpm, Git, and a local PostgreSQL 15+ on **port 5433**, without Docker.
   - Create `src/.env` from `src/.env.example`: `DATABASE_URL` and `TEST_DATABASE_URL` on 127.0.0.1:5433. Never use a production database. Never commit `.env` (it is gitignored, so check with `git status`).
   - Run `pnpm install --frozen-lockfile`, `pnpm prisma migrate deploy` and `pnpm db:seed` in `src/`.
   - The environment counts as ready only when `env-require/doctor.ps1` prints `Environment status: READY`.
   - Do not modify tests to work around missing database privileges. That is environment setup (see `db-setup.sql`).
   - Do not change `exam-info.json`.

4. **BUILD.** Run the baseline checks: `pnpm typecheck`, `pnpm test` and `pnpm build` (or whatever the source defines). Write down the real pass/fail counts. A failing baseline must be reported as `FAILED` or `BLOCKED`, never as `COMPLETED`.

5. **MATCH_LOGIN.** Call `login_match`. The helper logs in, opens the exact match, checks team, repository, branch and folder against the input, and logs `MATCH_LOGIN`. On `ASSIGNMENT_MISMATCH`, stop and open a blocker.

6. **ENVIRONMENT_READY.** Call `report_progress({event:{type:"ENVIRONMENT_READY"}})`. The helper fills in requestId, repository and the HEAD revision, and refuses if login or build has not passed.

7. Stop and wait. mtm-player validates the log and reports PREPARED to the server. Backlog work starts only when `START_GAME_V4` arrives. There is no operator command for it.
