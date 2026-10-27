// Deterministic match simulator (port of legacy simulator/ + scripts/benchmark.py).
// Replays a 40-minute match with briefs released at minutes 0, 14 and 29, drives the real
// MatchBrain with a fake clock, and compares the EV planner with naive FIFO.
// Backlog content is fictitious — edit SCENARIO to mirror what you see in practice matches.
//   node test/simulate.mjs [--capacity 2] [--speed 1.0] [--seed 7]

import { MatchBrain } from '../src/brain/match-brain.mjs';
import { RULES, typeRules } from '../src/brain/rules.mjs';
import { successProbability } from '../src/brain/scoring.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const CAPACITY = Number(args.capacity ?? 2);
const SPEED = Number(args.speed ?? 1); // >1 = slower than estMinutes
const SEED = Number(args.seed ?? 7);
const STEP = 30;
const DURATION = RULES.match.durationSec;

// [revealMinute, key, type, points, deadlineMinutes]
export const SCENARIO = [
  [0, 'TASK-01', 'TASK', 10, 20], [0, 'BUG-01', 'BUG', 30, 20], [0, 'CR-01', 'CR', 40, 25],
  [14, 'BUG-02', 'BUG', 30, 15], [14, 'PI-01', 'PI', 100, 10], [14, 'TASK-02', 'TASK', 10, 20],
  [29, 'PI-02', 'PI', 100, 9], [29, 'CR-02', 'CR', 40, 10], [29, 'BUG-03', 'BUG', 30, 10],
];

// Deterministic pseudo-random in [0,1) per item.
function rand(key) {
  let h = SEED;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ((h * 2654435761) >>> 0) / 2 ** 32;
}

function simulate(strategy) {
  let nowMs = 0;
  const brain = new MatchBrain(() => nowMs);
  const work = new Map(); // key -> remaining work seconds (started items, active or parked)
  let active = []; // keys being worked on this tick (<= CAPACITY)
  const result = { strategy, score: 0, submitted: [], failed: [], missed: [] };
  const order = [];

  for (let t = 0; t <= DURATION; t += STEP) {
    nowMs = t * 1000;
    const visible = SCENARIO.filter(([m]) => m * 60 <= t);
    for (const [, key] of visible) if (!order.includes(key)) order.push(key);
    brain.sync({
      match: { status: 'IN_PROGRESS', elapsedSec: t, remainingSec: DURATION - t },
      backlog: visible.map(([m, key, type, points, dl]) => ({ key, backlogType: type, points, deadlineMinutes: dl, revealedElapsedSec: m * 60, status: 'OPEN' })),
    });
    brain.deadlines();

    // Progress active work by one step; finish what is done.
    for (const key of active) if (work.has(key)) work.set(key, work.get(key) - STEP);
    for (const [key, remaining] of [...work]) {
      if (remaining > 0) continue;
      work.delete(key);
      const item = brain.get(key);
      if (item.status !== 'IMPLEMENTING') continue; // closed meanwhile
      const t2 = typeRules(item.type);
      const ok = rand(key) < successProbability(t2.baseConfidence, t2.complexity) + 0.25; // verification catches some failures early
      if (ok) {
        brain.verify(key, { mvs: { total: 1, passed: 1 }, extra: { total: 1, passed: 1 }, review: { correctness: 0.9, regressionRisk: 0.05, maintainability: 0.85, security: 0.95 }, evidenceFiles: ['evidence/x'] }, { evidenceOk: true });
        brain.submitted(key);
        result.score += item.points;
        result.submitted.push(`${key}@${Math.round(t / 60)}m`);
      } else {
        brain.fail(key);
        result.failed.push(key);
      }
    }

    for (const key of [...work.keys()]) if (brain.get(key).status !== 'IMPLEMENTING') work.delete(key); // closed by deadline

    const start = (key) => {
      const item = brain.started(key, 1);
      work.set(key, Math.round(typeRules(item.type).estMinutes * 60 * SPEED));
    };
    if (strategy === 'brain') {
      // Follow the plan: PI preempts (parks) lower-priority work; parked work resumes later.
      const wanted = brain.plan().actions
        .filter((a) => ['START_PI', 'CONTINUE_PI', 'CONTINUE', 'START_WORKING'].includes(a.action))
        .map((a) => a.itemId)
        .slice(0, CAPACITY);
      for (const key of wanted) if (!work.has(key)) start(key);
      active = wanted;
    } else {
      // FIFO: keep going on what was started, fill free slots in reveal order, never preempt.
      active = [...work.keys()].slice(0, CAPACITY);
      for (const key of order) {
        if (active.length >= CAPACITY) break;
        if (brain.get(key).status === 'VISIBLE') { start(key); active.push(key); }
      }
    }
  }
  for (const [, key] of SCENARIO) {
    const s = brain.get(key).status;
    if (s === 'CLOSED' || s === 'VISIBLE' || s === 'IMPLEMENTING') result.missed.push(`${key}:${s}`);
  }
  return result;
}

const total = SCENARIO.reduce((s, x) => s + x[3], 0);
console.log(`Simulated match: ${DURATION / 60} min, capacity ${CAPACITY}, speed x${SPEED}, max ${total} pts\n`);
for (const strategy of ['brain', 'fifo']) {
  const r = simulate(strategy);
  console.log(`${strategy.padEnd(6)} score ${String(r.score).padStart(4)}  submitted ${r.submitted.join(' ')}`);
  if (r.failed.length) console.log(`       failed  ${r.failed.join(' ')}`);
  if (r.missed.length) console.log(`       missed  ${r.missed.join(' ')}`);
}
