---
name: workflow-bug
description: Bug fix workflow (legacy bug_squad + workflows/bug_fix). Use for BUG items from plan_next.
---

# Bug

Time budget: **10 minutes**. Points come from the server (`points`); BUGs often carry a short deadline, so check it before you start.

1. `start_work`. Keep `minimumVerificationScenarios`: those are the MVS, and the gate requires all of them.
2. **Reproduce first**, with the official runner under `challenge/` if the item ships one, otherwise with a small test or script. Save the failing output as `evidence/reproduction-before.txt`. Spend at most 3 minutes here; if it does not reproduce, read the brief again instead of building tooling.
3. `scan_repo({impactOf:"<file or symbol>"})` lists callers that could regress.
4. **Fix the root cause** with a minimal diff in the existing style. No unrelated cleanup.
5. **Verify** the MVS, the reproduction (it must now pass), one or two edge cases, and the tests of the impacted files. A UI bug is verified against the production build (`pnpm build` + `pnpm start`); a difference that only shows in `pnpm dev` is not part of the bug.
6. Evidence per scenario in `answers/<ID>/evidence/<ID>-TC-xx.txt` (or `.png` for UI), then gate and submit as soon as the MVS pass.
