// Unit tests for the competition brain. The first groups are ports of the legacy Python tests
// (tests/unit/test_planner.py, test_state_machine.py, test_submission_gate.py).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deadlineFactor, evOfItem } from '../src/brain/scoring.mjs';
import { plan } from '../src/brain/planner.mjs';
import { ItemStatus as S, transition, canTransition, IllegalTransition } from '../src/brain/state-machine.mjs';
import { gate, reviewConfidence, coverage } from '../src/brain/authority.mjs';
import { MatchBrain } from '../src/brain/match-brain.mjs';
import { scanRepo, impactedFiles } from '../src/brain/repo-scanner.mjs';

const mk = (key, type, status = S.VISIBLE, extra = {}) => ({ key, type, status, title: key, points: 0, history: [], statusSince: 0, ...extra });
const scored = (item, secondsLeft) => ({ item, score: evOfItem(item, secondsLeft) });

// ---- legacy test_planner.py ----
test('deadline factor is zero when expired', () => {
  assert.equal(deadlineFactor(0), 0);
});

test('EV ordering: BUG with more time beats CR with less', () => {
  const a = mk('A', 'BUG'); const b = mk('B', 'CR');
  const { actions } = plan([scored(a, 600), scored(b, 100)]);
  assert.equal(actions[0].itemId, 'A');
});

test('PI first', () => {
  const pi = mk('PI-1', 'PI'); const bug = mk('BUG-1', 'BUG');
  const { actions } = plan([scored(bug, 600), scored(pi, null)]);
  assert.equal(actions[0].action, 'START_PI');
  assert.equal(actions[0].itemId, 'PI-1');
});

// ---- legacy test_state_machine.py ----
test('state machine happy path', () => {
  const item = mk('BUG-01', 'BUG');
  for (const s of [S.STARTED, S.IMPLEMENTING, S.VERIFYING, S.READY_TO_SUBMIT, S.SUBMITTED]) transition(item, s);
  assert.equal(item.status, S.SUBMITTED);
  assert.equal(item.history.length, 5);
});

test('forbidden VISIBLE -> SUBMITTED and STARTED -> SUBMITTED', () => {
  assert.throws(() => transition(mk('X', 'BUG'), S.SUBMITTED), IllegalTransition);
  const started = mk('Y', 'BUG', S.STARTED);
  assert.throws(() => transition(started, S.SUBMITTED), IllegalTransition);
  assert.equal(canTransition(S.VISIBLE, S.VERIFYING), false);
  assert.equal(canTransition(S.SUBMITTED, S.IMPLEMENTING), false);
});

// ---- legacy test_submission_gate.py ----
const goodReview = { correctness: 0.9, regressionRisk: 0.05, maintainability: 0.85, security: 0.95 };

test('gate rejects without evidence', () => {
  const r = gate({ mvs: { total: 1, passed: 1 }, extra: { total: 6, passed: 6 }, review: goodReview, evidenceFiles: [] }, { mvsRequired: 1, evidenceOk: true });
  assert.equal(r.approved, false);
  assert.equal(r.checks.evidence_complete, false);
});

test('gate approves a clean, evidenced, fully passing result', () => {
  const r = gate({ mvs: { total: 2, passed: 2 }, extra: { total: 3, passed: 3 }, review: goodReview, evidenceFiles: ['evidence/a.txt'] }, { mvsRequired: 2, evidenceOk: true });
  assert.equal(r.approved, true, JSON.stringify(r));
  assert.equal(r.coverage, 100);
});

test('gate rejects missing MVS scenarios, low coverage, risky review', () => {
  const base = { extra: { total: 1, passed: 1 }, review: goodReview, evidenceFiles: ['evidence/a.txt'] };
  assert.equal(gate({ ...base, mvs: { total: 1, passed: 1 } }, { mvsRequired: 2, evidenceOk: true }).checks.mvs_pass, false);
  assert.equal(gate({ ...base, mvs: { total: 2, passed: 2 }, extra: { total: 10, passed: 5 } }, { mvsRequired: 2, evidenceOk: true }).checks.coverage_ok, false);
  assert.equal(gate({ ...base, mvs: { total: 2, passed: 2 }, review: { ...goodReview, regressionRisk: 0.3 } }, { mvsRequired: 2, evidenceOk: true }).approved, false);
});

test('review confidence matches legacy ReviewAgent formula', () => {
  // 0.4*0.9 + 0.3*0.92 + 0.2*0.85 + 0.1*0.95 = 0.901
  assert.equal(reviewConfidence({ correctness: 0.9, regressionRisk: 0.08, maintainability: 0.85, security: 0.95 }), 0.9);
  assert.equal(coverage({ mvs: { total: 1, passed: 1 }, extra: { total: 6, passed: 6 } }), 100);
});

// ---- extensions ----
test('READY_TO_SUBMIT is planned first, infeasible items are skipped, capacity respected', () => {
  const ready = mk('T-READY', 'TASK', S.READY_TO_SUBMIT);
  const late = mk('CR-LATE', 'CR');
  const many = ['B1', 'B2', 'B3', 'B4'].map((k) => mk(k, 'BUG'));
  const { actions, skipped } = plan([scored(late, 60), scored(ready, 900), ...many.map((m) => scored(m, 1500))]);
  assert.equal(actions[0].action, 'SUBMIT');
  assert.ok(skipped.some((s) => s.itemId === 'CR-LATE' && /time/.test(s.reason)));
  assert.equal(actions.filter((a) => a.action === 'START_WORKING').length, 3);
  assert.ok(skipped.some((s) => /capacity/.test(s.reason)));
});

test('real points override type base priority', () => {
  const task = mk('T', 'TASK', S.VISIBLE, { points: 200 });
  const bug = mk('B', 'BUG', S.VISIBLE, { points: 10 });
  const { actions } = plan([scored(bug, 1200), scored(task, 1200)]);
  assert.equal(actions[0].itemId, 'T');
});

test('brain: deadlines from server fields, PI incident + MTTR, watchdog, preemption data', () => {
  let now = 1_000_000;
  const brain = new MatchBrain(() => now);
  brain.sync({
    match: { status: 'IN_PROGRESS', elapsedSec: 600, remainingSec: 1800 },
    backlog: [
      { key: 'BUG-1', backlogType: 'BUG', points: 30, status: 'OPEN', deadlineMinutes: 12, revealedElapsedSec: 0 },
      { key: 'TASK-1', backlogType: 'TASK', points: 10, status: 'OPEN', deadlineMinutes: null, revealedElapsedSec: 0 },
    ],
  });
  assert.equal(brain.secondsLeft(brain.get('BUG-1')), 120); // 12*60 - 600
  assert.equal(brain.secondsLeft(brain.get('TASK-1')), 1800); // match remaining
  const d = brain.deadlines();
  assert.deepEqual(d.warnings.map((w) => w.itemId), ['BUG-1']);
  assert.equal(brain.deadlines().warnings.length, 0, 'warn once');

  now += 130_000; // clock advances locally; BUG-1 expires
  assert.deepEqual(brain.deadlines().expired, ['BUG-1']);
  assert.equal(brain.get('BUG-1').status, S.CLOSED);

  const { incidentsOpened } = brain.sync({ match: { status: 'IN_PROGRESS', elapsedSec: 730, remainingSec: 1670 }, backlog: [{ key: 'PI-1', backlogType: 'PI', points: 100, status: 'OPEN', deadlineMinutes: 10, revealedElapsedSec: 730 }] });
  assert.deepEqual(incidentsOpened, ['PI-1']);
  brain.started('TASK-1', 0);
  const p = brain.plan();
  assert.equal(p.actions[0].itemId, 'PI-1');
  assert.ok(p.actions.some((a) => a.itemId === 'TASK-1' && a.action === 'CONTINUE'));

  now += 700_000; // TASK-1 sits in IMPLEMENTING past the watchdog threshold
  assert.deepEqual(brain.stuck().map((s) => s.itemId), ['TASK-1']);

  brain.started('PI-1', 1);
  brain.verify('PI-1', { mvs: { total: 1, passed: 1 }, extra: { total: 1, passed: 1 }, review: goodReview, evidenceFiles: ['evidence/x'] }, { evidenceOk: true });
  assert.equal(brain.get('PI-1').status, S.READY_TO_SUBMIT);
  brain.submitted('PI-1');
  const inc = brain.incidents().find((i) => i.itemId === 'PI-1');
  assert.equal(inc.open, false);
  assert.equal(inc.mttrSec, 700);
});

test('brain: rejected verification goes back to IMPLEMENTING; restore after resume needs re-verify', () => {
  const brain = new MatchBrain();
  brain.started('CR-1', 2);
  brain.verify('CR-1', { mvs: { total: 2, passed: 1 }, extra: { total: 0, passed: 0 }, review: goodReview, evidenceFiles: ['evidence/a'] }, { evidenceOk: true });
  assert.equal(brain.get('CR-1').status, S.IMPLEMENTING);
  const restored = new MatchBrain();
  restored.restore('CR-1', 'COMPLETED', 'x');
  assert.equal(restored.get('CR-1').status, S.VERIFYING);
  restored.restore('BUG-9', 'SUBMITTED', 'y');
  assert.equal(restored.get('BUG-9').status, S.SUBMITTED);
});

test('repo scanner: stack detection and impact query', () => {
  const root = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    mkdirSync(join(root, 'src', 'src', 'server'), { recursive: true });
    mkdirSync(join(root, 'src', 'tests'), { recursive: true });
    writeFileSync(join(root, 'src', 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' }, dependencies: { next: '15', '@prisma/client': '6' }, devDependencies: { vitest: '3' } }));
    writeFileSync(join(root, 'src', 'pnpm-lock.yaml'), '');
    writeFileSync(join(root, 'src', 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '~/*': ['./src/*'] } } }));
    writeFileSync(join(root, 'src', 'src', 'server', 'money.ts'), 'export const f = 1;\n');
    writeFileSync(join(root, 'src', 'src', 'server', 'invoice.ts'), "import { f } from './money';\n");
    writeFileSync(join(root, 'src', 'tests', 'invoice.test.ts'), "import '~/server/invoice';\n");
    const k = scanRepo(root);
    assert.equal(k.projects[0].buildSystem, 'pnpm');
    assert.equal(k.projects[0].testSystem, 'vitest');
    assert.deepEqual(k.projects[0].frameworks.sort(), ['Next.js', 'Prisma']);
    const impact = impactedFiles(k, 'money');
    assert.ok(impact.direct.includes('src/src/server/money.ts'));
    assert.ok(impact.direct.includes('src/src/server/invoice.ts'));
    assert.ok(impact.transitive.includes('src/tests/invoice.test.ts'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('brain self-calibrates speed from real durations and tightens feasibility', () => {
  let now = 0;
  const brain = new MatchBrain(() => now);
  brain.sync({ match: { status: 'IN_PROGRESS', elapsedSec: 0, remainingSec: 2400 }, backlog: [
    { key: 'T1', backlogType: 'TASK', points: 10, status: 'OPEN', deadlineMinutes: null, revealedElapsedSec: 0 },
    { key: 'B1', backlogType: 'BUG', points: 30, status: 'OPEN', deadlineMinutes: 12, revealedElapsedSec: 0 },
  ] });
  brain.started('T1', 0);
  now = 12 * 60 * 1000; // TASK estimated 6 min, took 12 → speed 2
  brain.verify('T1', { mvs: { total: 1, passed: 1 }, extra: { total: 1, passed: 1 }, review: goodReview, evidenceFiles: ['evidence/x'] }, { evidenceOk: true });
  brain.submitted('T1');
  brain.sync({ match: { status: 'IN_PROGRESS', elapsedSec: 0, remainingSec: 2400 }, backlog: [] }); // reset clock: B1 has 12 min left
  const p = brain.plan();
  assert.equal(p.speed, 2);
  assert.ok(p.skipped.some((s) => s.itemId === 'B1'), 'BUG needs 16 min at speed 2 but only 12 left');
});
