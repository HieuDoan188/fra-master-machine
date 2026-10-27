// Competition brain: one source of truth for item state, deadlines, incidents and planning.
// Composes legacy MatchState + DeadlineService + IncidentService + Watchdog + PortfolioPlanner.
// Pure code, no tokens: the LLM asks it what to do next and whether it may submit.

import { RULES, typeRules } from './rules.mjs';
import { ItemStatus as S, ACTIVE, TERMINAL, transition, rework } from './state-machine.mjs';
import { evOfItem } from './scoring.mjs';
import { plan } from './planner.mjs';
import { gate } from './authority.mjs';

export class MatchBrain {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.items = new Map();
    this.clock = { elapsedSec: null, remainingSec: null, status: null, observedAt: null };
    this.warned = new Set();
  }

  // ---------- state from the server ----------

  upsert(key, fields = {}) {
    let item = this.items.get(key);
    if (!item) {
      item = { key, type: 'TASK', title: key, points: 0, deadlineMinutes: null, revealedElapsedSec: null, serverStatus: null, status: S.VISIBLE, statusSince: this.now(), history: [], mvsRequired: 0, verification: null, gate: null, incident: null };
      this.items.set(key, item);
    }
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) item[k] = v;
    return item;
  }

  sync(projection) {
    const m = projection?.match ?? {};
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    this.clock = { elapsedSec: num(m.elapsedSec), remainingSec: num(m.remainingSec), status: m.status ?? null, observedAt: this.now() };
    const opened = [];
    for (const b of projection?.backlog ?? []) {
      if (!b?.key) continue;
      const isNew = !this.items.has(b.key);
      const item = this.upsert(b.key, {
        type: ['TASK', 'CR', 'BUG', 'PI'].includes(b.backlogType) ? b.backlogType : undefined,
        title: b.title ?? undefined,
        points: num(b.points) ?? undefined,
        deadlineMinutes: num(b.deadlineMinutes),
        revealedElapsedSec: num(b.revealedElapsedSec),
        serverStatus: b.status ?? null,
      });
      if (item.type === 'PI' && !item.incident) {
        item.incident = { openedAt: this.now(), resolvedAt: null, mttrSec: null }; // legacy IncidentService.register
        if (isNew) opened.push(item.key);
      }
      if (b.status === 'CLOSED' && !TERMINAL.includes(item.status)) transition(item, S.CLOSED, this.now());
    }
    return { incidentsOpened: opened };
  }

  // Live match clock: the server value plus time since we observed it (only while IN_PROGRESS).
  elapsedNow() {
    const c = this.clock;
    if (c.elapsedSec == null) return null;
    return c.status === 'IN_PROGRESS' ? c.elapsedSec + Math.floor((this.now() - c.observedAt) / 1000) : c.elapsedSec;
  }

  matchRemainingNow() {
    const c = this.clock;
    if (c.remainingSec == null) return null;
    return c.status === 'IN_PROGRESS' ? Math.max(0, c.remainingSec - Math.floor((this.now() - c.observedAt) / 1000)) : c.remainingSec;
  }

  // Same formula as the game server: deadlineMinutes*60 - (elapsed - revealedElapsedSec), capped by match end.
  secondsLeft(item) {
    const matchLeft = this.matchRemainingNow();
    let left = null;
    const elapsed = this.elapsedNow();
    if (item.deadlineMinutes != null && item.revealedElapsedSec != null && elapsed != null) {
      left = item.deadlineMinutes * 60 - Math.max(0, elapsed - item.revealedElapsedSec);
    }
    if (matchLeft != null) left = left == null ? matchLeft : Math.min(left, matchLeft);
    return left;
  }

  totalSec() {
    const e = this.clock.elapsedSec, r = this.clock.remainingSec;
    return e != null && r != null && e + r > 0 ? e + r : RULES.match.durationSec;
  }

  // ---------- lifecycle (called by the helper's tools) ----------

  get(key) {
    return this.items.get(key) ?? this.upsert(key);
  }

  started(key, mvsRequired) {
    const item = this.get(key);
    if (item.status === S.VISIBLE) transition(item, S.STARTED, this.now());
    if (item.status === S.STARTED) transition(item, S.IMPLEMENTING, this.now());
    item.mvsRequired = Math.max(item.mvsRequired, mvsRequired ?? 0);
    return item;
  }

  verify(key, verification, { evidenceOk }) {
    const item = this.get(key);
    if (![S.IMPLEMENTING, S.VERIFYING, S.READY_TO_SUBMIT].includes(item.status)) {
      const err = new Error(`${key} is ${item.status}; verify needs IMPLEMENTING/VERIFYING`);
      err.code = 'ILLEGAL_TRANSITION';
      throw err;
    }
    if (item.status !== S.VERIFYING) transition(item, S.VERIFYING, this.now());
    item.verification = verification;
    item.gate = gate(verification, { mvsRequired: item.mvsRequired, evidenceOk });
    if (item.gate.approved) transition(item, S.READY_TO_SUBMIT, this.now());
    else rework(item, this.now());
    return item;
  }

  // Self-calibration: median of actual/estimated work time over submitted items (clamped 0.5..3).
  speed() {
    const ratios = [...this.items.values()].map((i) => i.speedRatio).filter((r) => r != null).sort((a, b) => a - b);
    if (!ratios.length) return 1;
    const mid = ratios[Math.floor(ratios.length / 2)];
    return Math.max(0.5, Math.min(3, mid));
  }

  submitted(key) {
    const item = this.get(key);
    const started = item.history.find((h) => h.to === S.STARTED && !h.restored);
    if (started) item.speedRatio = (this.now() - started.at) / 1000 / (typeRules(item.type).estMinutes * 60);
    transition(item, S.SUBMITTED, this.now());
    if (item.incident && !item.incident.resolvedAt) {
      item.incident.resolvedAt = this.now(); // legacy IncidentService.resolve
      item.incident.mttrSec = Math.round((item.incident.resolvedAt - item.incident.openedAt) / 1000);
    }
    return item;
  }

  fail(key) {
    return transition(this.get(key), S.FAILED, this.now());
  }

  reworkItem(key) {
    return rework(this.get(key), this.now());
  }

  // Restore after a replacement orchestrator starts: map logged BACKLOG_STATUS to brain state.
  // A gate result is not persisted, so verified-but-unsubmitted work must be re-verified.
  restore(key, loggedStatus, title) {
    const item = this.upsert(key, { title });
    const target = { IN_PROGRESS: S.IMPLEMENTING, COMPLETED: S.VERIFYING, SUBMITTED: S.SUBMITTED, FAILED: S.FAILED }[loggedStatus];
    if (target && item.status === S.VISIBLE) {
      item.history.push({ from: item.status, to: target, at: this.now(), restored: true });
      item.status = target;
      item.statusSince = this.now();
    }
    return item;
  }

  // ---------- watchers ----------

  // legacy DeadlineService.tick: warn once under the threshold; close what expired.
  deadlines() {
    const warnings = [];
    const expired = [];
    for (const item of this.items.values()) {
      if (TERMINAL.includes(item.status)) continue;
      const left = this.secondsLeft(item);
      if (left == null || item.deadlineMinutes == null) continue;
      if (left <= 0) {
        transition(item, S.CLOSED, this.now());
        expired.push(item.key);
      } else if (left <= RULES.deadline.warningSec && !this.warned.has(item.key)) {
        this.warned.add(item.key);
        warnings.push({ itemId: item.key, secondsLeft: left, status: item.status });
      }
    }
    return { warnings, expired };
  }

  // legacy Watchdog.revive: active items that have not moved for too long.
  stuck() {
    const out = [];
    for (const item of this.items.values()) {
      if (!ACTIVE.includes(item.status)) continue;
      const ageSec = Math.round((this.now() - item.statusSince) / 1000);
      if (ageSec >= RULES.watchdog.stuckSec) {
        out.push({ itemId: item.key, status: item.status, ageSec, recommendation: item.status === S.READY_TO_SUBMIT ? 'submit now' : item.status === S.VERIFYING ? 'finish verification or rework' : 'narrow the scope, or fail the item and move on' });
      }
    }
    return out;
  }

  incidents() {
    return [...this.items.values()].filter((i) => i.incident).map((i) => {
      const ageSec = Math.round(((i.incident.resolvedAt ?? this.now()) - i.incident.openedAt) / 1000);
      return { itemId: i.key, status: i.status, open: !i.incident.resolvedAt, ageSec, mttrSec: i.incident.mttrSec, overMttrTarget: ageSec > RULES.incident.mttrTargetSec };
    });
  }

  plan() {
    const total = this.totalSec();
    const speed = this.speed();
    const scored = [...this.items.values()].map((item) => ({ item, score: evOfItem(item, this.secondsLeft(item), total, speed) }));
    return { ...plan(scored), speed: Math.round(speed * 100) / 100 };
  }

  snapshot() {
    return [...this.items.values()].map((i) => ({
      key: i.key, type: i.type, points: i.points, status: i.status, secondsLeft: this.secondsLeft(i),
      estMinutes: typeRules(i.type).estMinutes, mvsRequired: i.mvsRequired, gate: i.gate,
    }));
  }
}
