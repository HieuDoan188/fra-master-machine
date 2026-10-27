// Expected Value engine, ported from legacy core/scoring/{ev_engine,priority_engine}.py.
//   EV = score x success_rate x deadline_factor
// Extension: `feasible` — an item whose remaining time is shorter than our estimated effort
// is still scored but flagged, so the planner can skip work we cannot finish.

import { RULES, typeRules } from './rules.mjs';

export function deadlineFactor(secondsLeft, totalSeconds = RULES.match.durationSec) {
  if (secondsLeft <= 0) return 0;
  return Math.min(1, Math.max(RULES.planner.minDeadlineFactor, secondsLeft / totalSeconds));
}

export function successProbability(baseConfidence, complexity = 0.5) {
  return Math.max(0, Math.min(1, baseConfidence * (1 - 0.5 * complexity)));
}

export function expectedValue(score, successRate, secondsLeft, totalSeconds = RULES.match.durationSec) {
  return Math.round(score * successRate * deadlineFactor(secondsLeft, totalSeconds) * 100) / 100;
}

export function basePriority(type) {
  return typeRules(type).priorityBase;
}

// Real points from the server when published, otherwise the type's base priority.
export function itemScore(item) {
  return item.points > 0 ? item.points : basePriority(item.type);
}

// item: { type, points }; secondsLeft: null = unknown deadline (treated as the whole match).
// speed: observed actual/estimated duration ratio (1 = estimates are right).
export function evOfItem(item, secondsLeft, totalSeconds = RULES.match.durationSec, speed = 1) {
  const t = typeRules(item.type);
  const secs = secondsLeft ?? totalSeconds;
  const success = successProbability(t.baseConfidence, t.complexity);
  const ev = expectedValue(itemScore(item), success, secs, totalSeconds);
  const needSec = Math.round(t.estMinutes * 60 * speed);
  const feasible = secs >= needSec + RULES.planner.submitMarginSec;
  return { ev, success: Math.round(success * 1000) / 1000, deadlineFactor: deadlineFactor(secs, totalSeconds), secondsLeft: secondsLeft ?? null, needSec, feasible };
}
