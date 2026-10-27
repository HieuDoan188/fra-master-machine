// Portfolio planner, ported from legacy core/scheduler/portfolio_planner.py.
// Maximizes total match score, not task count: PI always wins, the rest ranked by EV within
// squad capacity. Extensions: READY_TO_SUBMIT items are submitted first (cheap, locks points),
// and infeasible items (not enough time left) are skipped with a reason.

import { RULES, typeRules } from './rules.mjs';
import { ItemStatus as S, ACTIVE } from './state-machine.mjs';

// Squads become Codex subagent profiles + a workflow skill per backlog type.
export const SQUADS = Object.freeze({
  PI: { squad: 'pi_squad', profile: 'team_feature_worker', workflow: 'workflow-pi' },
  BUG: { squad: 'bug_squad', profile: 'team_feature_worker', workflow: 'workflow-bug' },
  CR: { squad: 'cr_squad', profile: 'team_feature_worker', workflow: 'workflow-cr' },
  TASK: { squad: 'task_squad', profile: 'team_feature_worker', workflow: 'workflow-task' },
});

const squadFor = (type) => SQUADS[type] ?? SQUADS.TASK;

// scored: [{ item, score: evOfItem(...) }]
export function plan(scored, { squadCapacity = RULES.planner.squadCapacity } = {}) {
  const actions = [];
  const skipped = [];
  const act = (s, action, reason) => actions.push({
    itemId: s.item.key, type: s.item.type, title: s.item.title, status: s.item.status, action,
    ev: s.score.ev, secondsLeft: s.score.secondsLeft, reason, ...squadFor(s.item.type),
  });
  const byEv = (a, b) => b.score.ev - a.score.ev;

  // 1. Lock in finished work.
  for (const s of scored.filter((x) => x.item.status === S.READY_TO_SUBMIT).sort(byEv)) {
    act(s, 'SUBMIT', 'verified and gated; submit before the deadline');
  }

  // 2. Product Incidents override everything.
  const pis = scored.filter((x) => x.item.type === 'PI' && [S.VISIBLE, ...ACTIVE].includes(x.item.status) && x.item.status !== S.READY_TO_SUBMIT);
  for (const s of pis.sort(byEv)) {
    if (s.item.status === S.VISIBLE && !s.score.feasible) { skipped.push({ itemId: s.item.key, reason: 'not enough time left' }); continue; }
    act(s, s.item.status === S.VISIBLE ? 'START_PI' : 'CONTINUE_PI', 'PI overrides all');
  }

  // 3. Everything else by EV within capacity; in-progress work keeps its slot.
  const others = scored.filter((x) => x.item.type !== 'PI' && [S.VISIBLE, S.STARTED, S.IMPLEMENTING, S.VERIFYING].includes(x.item.status));
  const inProgress = others.filter((x) => x.item.status !== S.VISIBLE).sort(byEv);
  const visible = others.filter((x) => x.item.status === S.VISIBLE).sort(byEv);
  let assigned = 0;
  for (const s of inProgress) {
    act(s, 'CONTINUE', 'in progress');
    assigned++;
  }
  for (const s of visible) {
    if (!s.score.feasible) { skipped.push({ itemId: s.item.key, reason: 'not enough time left' }); continue; }
    if (assigned >= squadCapacity) { skipped.push({ itemId: s.item.key, reason: 'squad capacity reached' }); continue; }
    act(s, 'START_WORKING', 'highest EV');
    assigned++;
  }
  return { actions, skipped };
}

export function estimatedMinutes(type) {
  return typeRules(type).estMinutes;
}
