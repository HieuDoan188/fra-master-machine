---
name: workflow-bug
description: Bug fix workflow (legacy bug_squad + workflows/bug_fix). Use for BUG items from plan_next.
---

# Bug — priority 70

Steps: start_working → get MVS → implement → verify → coverage → review → submit (Submission Authority).

1. `start_work`. Keep `minimumVerificationScenarios`: those are the MVS, and the gate requires all of them.
2. **Reproduce first.** Write a test that fails for the reported reason before you touch the code. A bug you cannot reproduce cannot be verified.
3. `scan_repo({impactOf:"<file or symbol>"})` lists callers that could regress.
4. **Fix the root cause** with a minimal diff in the existing style. No unrelated cleanup.
5. **Verify.** Run the MVS tests and the reproduction test (it must now pass). Add extra scenarios for edge cases, because hidden tests exist. Run the regression tests of every impacted file. Keep coverage over all scenarios at 90% or more.
6. **Evidence.** For each scenario, save the command and output to `answers/<ID>/evidence/<ID>-TC-xx.txt`.
7. **Review honestly** (0..1): correctness, regressionRisk, maintainability, security → `report_verification`. If it is rejected, fix and verify again.
8. Submit: commit, push, `submit_work`.
