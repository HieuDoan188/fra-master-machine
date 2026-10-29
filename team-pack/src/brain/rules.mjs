// Competition rules and tuning knobs, ported from legacy
// competitions/master_the_machine/rules/{backlog_types,scoring_framework,match_rules}.yaml.
// Confirmed against the live game server bundle: backlog types TASK/CR/BUG/PI and a
// 50-point computer-access penalty. Effort estimates are guesses — tune them with test/simulate.mjs.

export const RULES = Object.freeze({
  match: { durationSec: 40 * 60 },
  itemTypes: {
    // priorityBase: legacy backlog_types.yaml. baseConfidence/complexity feed success probability.
    // estMinutes: expected wall time for our team to finish one item of this type.
    PI: { priorityBase: 100, preemptive: true, baseConfidence: 0.85, complexity: 0.5, estMinutes: 8, workflow: 'workflow-pi' },
    BUG: { priorityBase: 70, preemptive: false, baseConfidence: 0.85, complexity: 0.4, estMinutes: 8, workflow: 'workflow-bug' },
    CR: { priorityBase: 50, preemptive: false, baseConfidence: 0.8, complexity: 0.6, estMinutes: 12, workflow: 'workflow-cr' },
    TASK: { priorityBase: 20, preemptive: false, baseConfidence: 0.9, complexity: 0.3, estMinutes: 6, workflow: 'workflow-task' },
  },
  // submitMarginSec: time reserved for answer + commit + push + submit after the work itself.
  // squadCapacity 1: finish and submit one item end-to-end before starting the next (one Codex session,
  // one database, one app port, shared token quota). PI still preempts. Raise only with separate worktrees.
  planner: { squadCapacity: 1, minDeadlineFactor: 0.05, submitMarginSec: 30 },
  submission: {
    // legacy agents/submission/authority.py + agents/review/review.py
    minCoverage: 90,
    minConfidence: 0.85,
    maxRegressionRisk: 0.1,
    minCorrectness: 0.8,
    maxSubmissionsPerItem: 1,
  },
  deadline: { warningSec: 300 }, // legacy deadline_service WARNING_THRESHOLD_SECONDS
  incident: { mttrTargetSec: 480 }, // legacy workflows/product_incident mttr_target_seconds
  watchdog: { stuckSec: 600 }, // an item in IMPLEMENTING/VERIFYING/READY this long is stuck
  penalties: { humanIntervention: -50 },
});

export function typeRules(type) {
  return RULES.itemTypes[type] ?? RULES.itemTypes.TASK;
}
