// MCP Helper session: holds credentials in memory only, talks to mtm-game-server,
// enforces scope guardrails and appends the mandatory progress events.

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GuardedHttp, isLoopbackTestMode, loggableOrigin, normalizeOrigin } from './http-client.mjs';
import { ProgressLog } from './progress-log.mjs';
import * as git from './git.mjs';
import { MatchBrain } from './brain/match-brain.mjs';
import { ItemStatus } from './brain/state-machine.mjs';
import { scanRepo, impactedFiles, summarize } from './brain/repo-scanner.mjs';

const here = dirname(fileURLToPath(import.meta.url));

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const FOLDER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BACKLOG_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const STATUS_RANK = { DISCOVERED: 0, IN_PROGRESS: 1, COMPLETED: 2, BLOCKED: 2, FAILED: 2, SUBMITTED: 3 };

export const MARKERS = {
  PREPARE_GAME_V2: 'PREPARE_GAME',
  START_GAME_V4: 'START_GAME',
  RESUME_PREPARATION_V1: 'RESUME_PREPARATION',
  RESUME_GAME_V1: 'RESUME_GAME',
  MATCH_PAUSED_V1: 'MATCH_PAUSED',
  MATCH_ENDED_V1: 'MATCH_ENDED',
};

class ToolError extends Error {
  constructor(code, message) { super(message ?? code); this.code = code; }
}

function fail(code, message) { throw new ToolError(code, message); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Extract the first balanced JSON object that follows `marker` in free text.
export function extractJsonAfter(text, marker) {
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const start = text.indexOf('{', at + marker.length);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  return null;
}

export function parseLifecycleInput(text) {
  for (const [marker, type] of Object.entries(MARKERS)) {
    if (!text.includes(marker)) continue;
    const descriptor = extractJsonAfter(text, marker);
    if (!descriptor) fail('INPUT_PARSE_FAILED', `No JSON after ${marker}`);
    if (descriptor.type !== type) fail('INPUT_TYPE_MISMATCH', `${marker} carries type ${descriptor.type}`);
    const modelPolicy = text.includes('MTM_MODEL_POLICY_V1') ? extractJsonAfter(text, 'MTM_MODEL_POLICY_V1') : null;
    return { descriptor, modelPolicy };
  }
  fail('INPUT_MARKER_NOT_FOUND', 'No known lifecycle marker in input');
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

function normRepoUrl(u) {
  return String(u ?? '').trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

function samePath(a, b) {
  const na = resolve(a), nb = resolve(b);
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

// Refuse symlinks/junctions anywhere between `root` and `target`.
function assertNoLinks(root, target) {
  const rel = relative(root, target);
  let cur = root;
  for (const part of ['', ...rel.split(sep).filter(Boolean)]) {
    cur = part ? join(cur, part) : cur;
    if (!existsSync(cur)) break;
    if (lstatSync(cur).isSymbolicLink()) fail('PATH_LINK_FORBIDDEN', `Link in path: ${cur}`);
  }
}

function summaryText(s, fallback) {
  const t = String(s ?? '').replace(/[\r\n\u0000]+/g, ' ').trim();
  return (t || fallback).slice(0, 240);
}

function titleText(t, fallback) {
  const s = String(t ?? '').replace(/[\r\n\u0000]+/g, ' ').trim();
  return (s || fallback).slice(0, 160);
}

// Installed layout: <TeamWorkspace>/team-sdlc-pack/runtime/src/runtime-session.mjs
function derivedTeamWorkspace() {
  const runtime = resolve(here, '..');
  const pack = resolve(runtime, '..');
  if (basename(runtime) === 'runtime' && basename(pack) === 'team-sdlc-pack') return resolve(pack, '..');
  return null;
}

export class RuntimeSession {
  constructor() {
    this.http = new GuardedHttp();
    this.log = new ProgressLog();
    this.phase = 'NEW'; // NEW | PREPARATION | GAME | PAUSED | ENDED
    this.descriptor = null;
    this.modelPolicy = null;
    this.account = null; // { username, password } memory only
    this.bearer = null; // memory only
    this.repository = null;
    this.paths = null; // { teamWorkspace, checkoutRoot, matchRoot, progressLogFile }
    this.matchId = null;
    this.matchUuid = null;
    this.gameOrigin = null;
    this.apiOrigin = null;
    this.operations = null; // { START_WORK, SUBMIT } path templates
    this.projection = null;
    this.signature = null;
    this.items = new Map(); // key -> { title, status (logged), revisionNo }
    this.submissions = new Map(); // key -> { clientSubmissionId, bodyText, state, receiptId, revision }
    this.matchLoginPassed = false;
    this.buildCompleted = false;
    this.started = false;
    this.backlogSynced = false;
    this.brain = new MatchBrain();
    this.repoKnowledge = null;
    this.lock = Promise.resolve();
  }

  // Serialize tool calls: no overlapping polling or API calls.
  run(fn) {
    const next = this.lock.then(fn, fn);
    this.lock = next.catch(() => {});
    return next;
  }

  // ---------- configuration ----------

  configure({ descriptor, modelPolicy, input }) {
    if (input) ({ descriptor, modelPolicy } = parseLifecycleInput(String(input)));
    if (!descriptor || typeof descriptor !== 'object') fail('DESCRIPTOR_REQUIRED');
    const d = descriptor;
    if (d.schemaVersion !== 1) fail('SCHEMA_VERSION_UNSUPPORTED');
    if (!ID_RE.test(d.playerSessionId ?? '')) fail('INVALID_SESSION_ID');
    if (!FOLDER_RE.test(d.matchId ?? '')) fail('INVALID_MATCH_ID');
    if (this.matchId && d.matchId !== this.matchId) fail('MATCH_MISMATCH', 'Descriptor is for another match');

    if (d.type === 'MATCH_PAUSED' || d.type === 'MATCH_ENDED') return this.control(d);

    const handlers = {
      PREPARE_GAME: () => this.configurePrepare(d, false),
      RESUME_PREPARATION: () => this.configurePrepare(d, true),
      START_GAME: () => this.configureGame(d, false),
      RESUME_GAME: () => this.configureGame(d, true),
    };
    if (!handlers[d.type]) fail('UNKNOWN_DESCRIPTOR_TYPE', String(d.type));
    if (modelPolicy) this.modelPolicy = modelPolicy;
    return handlers[d.type]();
  }

  resolvePaths(d) {
    const derived = derivedTeamWorkspace();
    let tw = d.teamWorkspace ? resolve(d.teamWorkspace) : derived;
    if (!tw) fail('TEAM_WORKSPACE_UNKNOWN', 'Run the installed helper or supply teamWorkspace');
    if (derived && !samePath(derived, tw)) fail('TEAM_WORKSPACE_MISMATCH', 'teamWorkspace differs from the installed pack location');
    for (const k of ['checkoutRoot', 'matchRoot']) {
      if (!d[k] || !isAbsolute(d[k])) fail('PATH_REQUIRED', `${k} must be absolute`);
    }
    const checkoutRoot = resolve(d.checkoutRoot);
    const matchRoot = resolve(d.matchRoot);
    if (!isInside(join(tw, 'matches'), checkoutRoot)) fail('PATH_OUTSIDE_WORKSPACE', 'checkoutRoot must be under <TeamWorkspace>/matches');
    const folder = d.repository?.folder ?? this.repository?.folder ?? basename(matchRoot);
    if (!samePath(matchRoot, join(checkoutRoot, folder))) fail('MATCH_ROOT_MISMATCH', 'matchRoot must equal checkoutRoot/repository.folder');
    const logsDir = join(tw, 'team-sdlc-pack', 'logs');
    const progressLogFile = d.progressLogFile ? resolve(d.progressLogFile) : join(logsDir, `${d.matchId}.progress.ndjson`);
    if (!isInside(logsDir, progressLogFile) || !progressLogFile.endsWith('.progress.ndjson')) fail('PROGRESS_LOG_PATH_INVALID');
    assertNoLinks(tw, checkoutRoot);
    return { teamWorkspace: tw, checkoutRoot, matchRoot, progressLogFile };
  }

  bindCommon(d) {
    const paths = this.resolvePaths(d);
    this.paths = paths;
    this.matchId = d.matchId;
    this.descriptor = { ...d, password: undefined, apiKeySecret: undefined };
    this.log.bind(paths.progressLogFile, d.playerSessionId);
    if (d.repository) {
      const r = d.repository;
      if (!/^https:\/\/[^@]+$/.test(r.url ?? '') || !r.branch || !FOLDER_RE.test(r.folder ?? '')) fail('INVALID_REPOSITORY');
      this.repository = { url: r.url, branch: r.branch, folder: r.folder };
    }
    if (d.username && d.password) {
      this.account = { username: String(d.username), password: String(d.password) };
      this.http.registerSecret(d.password);
    }
    const matchOrigins = d.allowedMatchOrigins ?? [];
    if (matchOrigins.length) this.http.allow(matchOrigins);
    const pageUrl = d.matchPageUrl ?? d.gameMasterUrl;
    if (pageUrl) {
      const origin = normalizeOrigin(pageUrl);
      const allowed = [...matchOrigins, ...(d.allowedApiOrigins ?? [])].map(normalizeOrigin);
      if (!allowed.includes(origin)) fail('ORIGIN_NOT_ALLOWED', 'matchPageUrl origin is not in the allowed origins');
      this.gameOrigin = origin;
    }
  }

  reconcileFromLog() {
    for (const e of this.log.readExisting()) {
      if (e.type === 'ORCHESTRATOR_STARTED' && e.playerSessionId === this.log.playerSessionId) this.started = true;
      if (e.type === 'GAME_START_STATUS' && e.status === 'COMPLETED') this.backlogSynced = true;
      if (e.type === 'BACKLOG_STATUS' && e.backlogId) {
        const prev = this.items.get(e.backlogId);
        if (!prev || (STATUS_RANK[e.status] ?? 0) >= (STATUS_RANK[prev.status] ?? 0)) {
          this.items.set(e.backlogId, { title: e.title, status: e.status, revisionNo: prev?.revisionNo ?? null });
        }
        if (e.status === 'SUBMITTED' && e.receiptId) {
          this.submissions.set(e.backlogId, { state: 'ACCEPTED', receiptId: e.receiptId, revision: e.revision });
        }
      }
    }
    for (const [key, v] of this.items) this.brain.restore(key, v.status, v.title);
  }

  emit(body) {
    const r = this.log.append(body);
    if (!r.ok) this.lastLogError = r.errors;
    return r;
  }

  configurePrepare(d, resume) {
    if (!d.username || !d.password) fail('ACCOUNT_REQUIRED');
    const auth = d.hostAuthorization;
    if (!resume) {
      if (auth?.type !== 'MTM_PREPARATION_HOST_AUTHORIZATION') fail('HOST_AUTHORIZATION_INVALID');
      if (auth.matchId !== d.matchId || auth.playerSessionId !== d.playerSessionId) fail('HOST_AUTHORIZATION_SCOPE_MISMATCH');
      if (normRepoUrl(auth.repository?.url) !== normRepoUrl(d.repository?.url)) fail('HOST_AUTHORIZATION_SCOPE_MISMATCH');
    }
    this.bindCommon(d);
    this.phase = 'PREPARATION';
    this.reconcileFromLog();
    if (resume) {
      this.emit({ type: 'ORCHESTRATOR_RESTARTED', attempt: d.restartAttempt ?? 1, phase: 'PREPARATION', reason: ID_RE.test(d.reason ?? '') ? d.reason : 'OPERATOR_RESUME', summary: 'Replacement orchestrator reconciling preparation state.' });
    } else if (!this.started) {
      this.emit({ type: 'ORCHESTRATOR_STARTED', summary: 'Orchestrator started.' });
    }
    this.started = true;
    return this.safeStatus();
  }

  configureGame(d, resume) {
    const auth = d.hostAuthorization;
    if (auth?.type !== 'MTM_HOST_AUTHORIZATION') fail('HOST_AUTHORIZATION_INVALID');
    if (auth.matchId !== d.matchId || auth.playerSessionId !== d.playerSessionId) fail('HOST_AUTHORIZATION_SCOPE_MISMATCH');
    const secret = d.apiKeySecret;
    if (typeof secret !== 'string' || !secret) fail('API_KEY_REQUIRED');
    if (Buffer.byteLength(secret, 'utf8') !== d.apiKeyLength) fail('API_KEY_LENGTH_MISMATCH');
    if (createHash('sha256').update(secret, 'utf8').digest('hex') !== String(d.apiKeySha256).toLowerCase()) fail('API_KEY_HASH_MISMATCH');
    if (d.environmentRevision != null && !SHA_RE.test(d.environmentRevision)) fail('ENVIRONMENT_REVISION_INVALID');
    if (d.gitPolicy?.forcePush || d.gitPolicy?.mutateRemote) fail('GIT_POLICY_UNEXPECTED', 'Pack never force-pushes or mutates remotes');

    const ops = {};
    for (const op of auth.apiOperations ?? []) {
      if (op.method !== 'POST' || !/^\/api\/v1\/matches\/\{matchUuid\}\/[a-z/]+$/.test(op.pathTemplate ?? '')) fail('API_OPERATION_INVALID', op.operation);
      ops[op.operation] = op.pathTemplate;
    }
    if (!ops.START_WORK || !ops.SUBMIT) fail('API_OPERATION_MISSING');

    const apiOrigins = (auth.allowedOrigins ?? d.allowedApiOrigins ?? []).map(normalizeOrigin);
    const apiOrigin = normalizeOrigin(d.gameMasterApiUrl);
    if (!apiOrigins.includes(apiOrigin)) fail('ORIGIN_NOT_ALLOWED', 'gameMasterApiUrl origin is not allowed');

    const freshProcess = this.phase === 'NEW';
    this.bindCommon(d);
    this.http.allow(apiOrigins);
    this.http.registerSecret(secret);
    this.bearer = secret; // replaces any previous bearer client
    this.apiOrigin = apiOrigin;
    this.operations = ops;
    this.environmentRevision = d.environmentRevision ?? null;
    this.phase = 'GAME';
    this.reconcileFromLog();
    if (resume) {
      this.emit({ type: 'ORCHESTRATOR_RESTARTED', attempt: d.restartAttempt ?? 1, phase: 'GAME', reason: ID_RE.test(d.reason ?? '') ? d.reason : 'OPERATOR_RESUME', summary: 'Replacement orchestrator reconciled logs before continuing.' });
    } else if (freshProcess && !this.started) {
      this.emit({ type: 'ORCHESTRATOR_STARTED', summary: 'Orchestrator started for active game.' });
    }
    this.started = true;
    return this.safeStatus();
  }

  control(d) {
    if (d.type === 'MATCH_PAUSED') {
      this.phase = 'PAUSED';
      return { ok: true, phase: 'PAUSED', instruction: 'Stop all API, Git, worker and polling activity. Keep source and evidence. Wait for mtm-player to resume; do not log ORCHESTRATOR_ENDED.' };
    }
    if (this.phase !== 'ENDED') {
      this.phase = 'ENDED';
      if (this.log.file) this.emit({ type: 'ORCHESTRATOR_ENDED', status: 'COMPLETED', summary: 'The match has ended; all activity has stopped.' });
    }
    this.bearer = null;
    this.account = null;
    return { ok: true, phase: 'ENDED', instruction: 'Match over. Stop everything; do not submit or push further work.' };
  }

  safeStatus() {
    return {
      ok: true,
      phase: this.phase,
      matchId: this.matchId,
      matchUuid: this.matchUuid,
      repository: this.repository,
      checkoutRoot: this.paths?.checkoutRoot,
      matchRoot: this.paths?.matchRoot,
      progressLogFile: this.paths?.progressLogFile,
      hasAccount: Boolean(this.account),
      hasBearer: Boolean(this.bearer),
      matchLogin: this.matchLoginPassed ? 'PASS' : 'NOT_DONE',
      allowedModels: this.modelPolicy?.allowedModels ?? null,
      orchestratorModel: this.modelPolicy?.orchestratorModel ?? null,
      knownBacklog: [...this.items].map(([key, v]) => ({ key, status: v.status })),
      submissions: [...this.submissions].map(([key, v]) => ({ key, state: v.state, receiptId: v.receiptId ?? null })),
      brain: this.brain.snapshot(),
      logError: this.lastLogError ?? null,
    };
  }

  requireActive(...phases) {
    if (this.phase === 'PAUSED') fail('MATCH_PAUSED', 'Paused by mtm-player; wait for resume.');
    if (this.phase === 'ENDED') fail('MATCH_ENDED', 'Match ended; no further activity.');
    if (!phases.includes(this.phase)) fail('WRONG_PHASE', `Requires ${phases.join('/')}, current ${this.phase}`);
  }

  // ---------- game-server calls (each logged REQUESTED → SUCCEEDED/FAILED) ----------

  async apiCall(operation, backlogId, method, url, opts) {
    const u = new URL(url);
    const base = { type: 'GAME_MASTER_API', operation, backlogId: backlogId ?? null, method, origin: loggableOrigin(u.origin), path: u.pathname };
    this.emit({ ...base, phase: 'REQUESTED', httpStatus: null, requestId: null, summary: 'Calling mtm-game-server.' });
    const res = await this.http.request(method, url, opts);
    const requestId = ID_RE.test(res.requestId ?? '') && String(res.requestId).length <= 128 ? res.requestId : null;
    const code = res.body?.error?.code ?? res.error ?? null;
    this.emit({
      ...base,
      phase: res.ok ? 'SUCCEEDED' : 'FAILED',
      httpStatus: res.status ?? null,
      requestId,
      summary: res.ok ? 'Received the mtm-game-server result.' : summaryText(`mtm-game-server call failed: ${code ?? res.status}`, 'mtm-game-server call failed.'),
    });
    return res;
  }

  async login() {
    this.requireActive('PREPARATION', 'GAME');
    if (!this.account) fail('ACCOUNT_UNAVAILABLE', 'No account in helper memory; mtm-player must resend credentials.');
    if (!this.gameOrigin) fail('GAME_ORIGIN_UNKNOWN');
    const prep = this.phase === 'PREPARATION';
    if (prep) this.emit({ type: 'PREPARATION_STATUS', stage: 'MATCH_LOGIN', status: 'IN_PROGRESS', summary: 'Logging in to mtm-game-server.' });
    this.http.clearCookies(this.gameOrigin);
    const res = await this.apiCall('LOGIN', null, 'POST', `${this.gameOrigin}/api/v1/auth/login`, { json: { username: this.account.username, password: this.account.password }, withCookies: false });
    if (!res.ok || !this.http.hasCookies(this.gameOrigin)) {
      if (prep) this.emit({ type: 'PREPARATION_STATUS', stage: 'MATCH_LOGIN', status: 'FAILED', summary: summaryText(`Login failed (${res.status ?? res.error}).`, 'Login failed.') });
      return { ok: false, error: 'LOGIN_FAILED', httpStatus: res.status ?? null, message: this.http.redact(res.body?.error?.message ?? res.error ?? '') };
    }
    const view = await this.refreshInternal({ verify: true });
    if (!view.ok) {
      if (prep) this.emit({ type: 'PREPARATION_STATUS', stage: 'MATCH_LOGIN', status: 'FAILED', summary: summaryText(view.error, 'Match verification failed.') });
      return view;
    }
    this.matchLoginPassed = true;
    if (prep) this.emit({ type: 'PREPARATION_STATUS', stage: 'MATCH_LOGIN', status: 'COMPLETED', summary: 'Logged in and verified the assigned match, team and repository.' });
    return { ok: true, matchLogin: 'PASS', role: res.body?.user?.role ?? null, match: view.match, team: view.team, repo: view.repo, backlogCount: view.backlog.length };
  }

  async refreshInternal({ verify }) {
    const url = `${this.gameOrigin}/api/v1/match/${encodeURIComponent(this.matchId)}`;
    const res = await this.apiCall('REFRESH_MATCH', null, 'GET', url, {});
    if (res.status === 401) return { ok: false, error: 'SESSION_EXPIRED', instruction: 'Call login_match, then refresh again.' };
    if (!res.ok || !res.body) return { ok: false, error: res.body?.error?.code ?? res.error ?? 'REFRESH_FAILED', httpStatus: res.status ?? null };
    const p = res.body;
    const problems = [];
    const teamId = this.descriptor?.teamId;
    if (teamId && p.team?.code && String(p.team.code).toLowerCase() !== String(teamId).toLowerCase()) problems.push('team code differs from teamId');
    if (this.repository && p.repo) {
      if (normRepoUrl(p.repo.url) !== normRepoUrl(this.repository.url)) problems.push('repository url differs');
      if (p.repo.branch && p.repo.branch !== this.repository.branch) problems.push('branch differs');
      if (p.repo.folder && p.repo.folder !== this.repository.folder) problems.push('folder differs');
    }
    const uuid = p.match?.id;
    if (uuid && UUID_RE.test(uuid)) {
      if (this.matchUuid && this.matchUuid !== uuid) problems.push('match UUID changed');
      this.matchUuid = uuid;
    } else if (verify) problems.push('match UUID not present in match view');
    if (verify && problems.length) return { ok: false, error: `ASSIGNMENT_MISMATCH: ${problems.join('; ')}` };
    if (!this.repository && p.repo?.url && /^https:\/\/[^@]+$/.test(p.repo.url)) this.repository = { url: p.repo.url, branch: p.repo.branch, folder: p.repo.folder };
    this.projection = p;
    // Queue new incidents until refresh() hands them out: a re-login inside refresh also syncs.
    this.pendingIncidents = [...(this.pendingIncidents ?? []), ...this.brain.sync(p).incidentsOpened];
    return { ok: true, ...this.publicView(p), warnings: problems };
  }

  publicView(p) {
    const backlog = (p.backlog ?? []).map((b) => {
      const out = {};
      for (const [k, v] of Object.entries(b)) if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
      return out;
    });
    return {
      match: { id: p.match?.id ?? null, status: p.match?.status ?? null, currentSequence: p.match?.currentSequence ?? null, elapsedSec: p.match?.elapsedSec ?? null, remainingSec: p.match?.remainingSec ?? null },
      team: p.team ? { code: p.team.code, name: p.team.name } : null,
      repo: p.repo ? { url: p.repo.url, branch: p.repo.branch, folder: p.repo.folder } : null,
      backlog,
      projectContext: p.projectContext ?? null,
      waiting: p.waiting ?? null,
      latestStatus: p.latestStatus ?? null,
      poll: { activeMs: p.api?.pollActiveMs ?? null, idleMs: p.api?.pollIdleMs ?? null },
    };
  }

  signatureOf(p) {
    return canonical({ s: p.match?.status, b: (p.backlog ?? []).map((b) => [b.key, b.status, b.revisionNo]) });
  }

  discover(view) {
    if (this.phase !== 'GAME') return [];
    const fresh = [];
    for (const b of view.backlog) {
      if (!b.key || !ID_RE.test(b.key)) continue;
      const known = this.items.get(b.key);
      if (known) {
        if (b.revisionNo != null && known.revisionNo != null && b.revisionNo > known.revisionNo) fresh.push({ key: b.key, revised: true });
        known.revisionNo = b.revisionNo ?? known.revisionNo;
        continue;
      }
      const title = titleText(b.title, b.key);
      this.items.set(b.key, { title, status: 'DISCOVERED', revisionNo: b.revisionNo ?? null });
      this.emit({ type: 'BACKLOG_STATUS', backlogId: b.key, title, status: 'DISCOVERED', summary: 'Backlog item discovered.', revision: null, receiptId: null });
      fresh.push({ key: b.key, revised: false });
    }
    return fresh;
  }

  async refresh() {
    this.requireActive('PREPARATION', 'GAME');
    const firstSync = this.phase === 'GAME' && !this.backlogSynced;
    if (firstSync) this.emit({ type: 'GAME_START_STATUS', stage: 'BACKLOG_SYNC', status: 'IN_PROGRESS', summary: 'Retrieving the current backlog.' });
    let view = await this.refreshInternal({ verify: false });
    if (!view.ok && view.error === 'SESSION_EXPIRED' && this.account) {
      const relog = await this.login();
      if (relog.ok) view = await this.refreshInternal({ verify: false });
    }
    if (!view.ok) {
      if (firstSync) this.emit({ type: 'GAME_START_STATUS', stage: 'BACKLOG_SYNC', status: 'BLOCKED', summary: summaryText(`Backlog sync failed: ${view.error}`, 'Backlog sync failed.') });
      return view;
    }
    const changes = this.discover(view);
    if (firstSync) {
      this.backlogSynced = true;
      this.emit({ type: 'GAME_START_STATUS', stage: 'BACKLOG_SYNC', status: 'COMPLETED', summary: 'Retrieved the current backlog.' });
    }
    this.signature = this.signatureOf(this.projection);
    const incidentsOpened = this.pendingIncidents ?? [];
    this.pendingIncidents = [];
    return { ...view, changes, incidentsOpened, itemStates: Object.fromEntries([...this.items].map(([k, v]) => [k, v.status])) };
  }

  async waitForUpdate({ timeoutMs = 55_000 } = {}) {
    this.requireActive('GAME');
    const deadline = Date.now() + Math.min(Math.max(Number(timeoutMs) || 0, 1_000), 55_000);
    const before = this.signature;
    let delay = 0;
    while (Date.now() + delay < deadline) {
      if (delay) await sleep(delay);
      if (this.phase !== 'GAME') return { ok: true, changed: false, control: this.phase };
      const view = await this.refresh();
      const deadlines = view.ok ? this.brain.deadlines() : { warnings: [], expired: [] };
      const urgent = view.ok && (view.incidentsOpened.length || deadlines.warnings.length || deadlines.expired.length);
      if (view.ok && (this.signature !== before || view.changes.length || urgent)) {
        return { ok: true, changed: true, ...view, deadlines, instruction: 'Call plan_next to re-plan.' };
      }
      const active = Number(this.projection?.api?.pollActiveMs) || 5_000;
      delay = view.ok ? Math.min(Math.max(active, 5_000), 30_000) : 10_000;
    }
    return { ok: true, changed: false, timedOut: true, phase: this.phase };
  }

  // ---------- Start Work ----------

  opUrl(op) {
    if (!this.matchUuid) fail('MATCH_UUID_UNKNOWN', 'Call refresh_match first.');
    return `${this.apiOrigin}${this.operations[op].replace('{matchUuid}', encodeURIComponent(this.matchUuid))}`;
  }

  safeMatchPath(rel) {
    if (typeof rel !== 'string' || !rel || isAbsolute(rel) || rel.includes('\\') || rel.split('/').some((s) => s === '..' || s === '')) return null;
    const abs = resolve(this.paths.matchRoot, rel);
    return isInside(this.paths.matchRoot, abs) ? abs : null;
  }

  writeIfAbsent(abs, content) {
    assertNoLinks(this.paths.matchRoot, abs);
    if (existsSync(abs)) return false;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
    return true;
  }

  async startWork({ backlogItemKey }) {
    this.requireActive('GAME');
    if (!BACKLOG_KEY_RE.test(backlogItemKey ?? '')) fail('INVALID_BACKLOG_KEY');
    if (!this.bearer) fail('BEARER_UNAVAILABLE');
    const res = await this.apiCall('START_WORK', backlogItemKey, 'POST', this.opUrl('START_WORK'), {
      json: { backlogItemKey },
      headers: { Authorization: `Bearer ${this.bearer}` },
      withCookies: false,
    });
    if (!res.ok) {
      return { ok: false, error: res.body?.error?.code ?? res.error ?? 'START_FAILED', httpStatus: res.status ?? null, message: this.http.redact(res.body?.error?.message ?? ''), requestId: res.requestId ?? null };
    }
    const b = res.body ?? {};
    const backlogId = b.backlogId ?? backlogItemKey;
    const answerDir = join(this.paths.matchRoot, 'answers', backlogItemKey);
    const evidenceDir = join(answerDir, 'evidence');
    assertNoLinks(this.paths.matchRoot, answerDir);
    mkdirSync(evidenceDir, { recursive: true });

    const written = [];
    let templateText = null;
    for (const [rel, content] of Object.entries(b.files ?? {})) {
      if (typeof content !== 'string') continue;
      if (rel.endsWith(`${backlogItemKey}-submit.json`)) templateText = content;
      const abs = rel.startsWith('challenge/') ? this.safeMatchPath(rel) : null;
      if (abs && this.writeIfAbsent(abs, content)) written.push(rel);
    }
    if (templateText == null && b.submitTemplate) templateText = JSON.stringify(b.submitTemplate, null, 2) + '\n';
    const submitPath = join(answerDir, 'submit.json');
    const materialized = templateText != null && this.writeIfAbsent(submitPath, templateText.endsWith('\n') ? templateText : templateText + '\n');

    const item = this.items.get(backlogItemKey) ?? { title: titleText(null, backlogItemKey), status: 'DISCOVERED', revisionNo: null };
    this.items.set(backlogItemKey, item);
    const scenarios = Array.isArray(b.minimumVerificationScenarios) ? b.minimumVerificationScenarios.length : 0;
    if ((STATUS_RANK[item.status] ?? 0) < STATUS_RANK.IN_PROGRESS) {
      item.status = 'IN_PROGRESS';
      this.emit({ type: 'BACKLOG_STATUS', backlogId: backlogItemKey, title: item.title, status: 'IN_PROGRESS', summary: 'Start Work accepted.', revision: null, receiptId: null });
      this.emit({ type: 'BACKLOG_TESTS', backlogId: backlogItemKey, status: 'NOT_RUN', required: scenarios, executed: 0, passed: 0, failed: 0, skipped: 0, summary: 'Tests have not run.' });
    }
    const brainItem = this.brain.started(backlogItemKey, scenarios);
    return {
      ok: true,
      replay: Boolean(b.replay),
      backlogId,
      backlogType: b.backlogType ?? null,
      startInstruction: b.startInstruction ?? null,
      submitTemplate: b.submitTemplate ?? null,
      minimumVerificationScenarios: b.minimumVerificationScenarios ?? null,
      files: Object.keys(b.files ?? {}),
      writtenFiles: written,
      answerFile: submitPath,
      answerFileMaterialized: materialized,
      evidenceDir,
      brainStatus: brainItem.status,
      workflow: `.agents/skills/workflow-${(brainItem.type ?? 'TASK').toLowerCase()}/SKILL.md`,
      rules: 'Evidence goes only in answers/<ID>/evidence/ and is referenced as evidence/<file>. Run report_verification (Submission Authority gate) before committing the final answer; then commit source, tests, evidence and answers/<ID>/submit.json together, push, and submit_work with the full SHA.',
    };
  }

  // ---------- Submit ----------

  async verifyRevision(key, rev, answer) {
    const { checkoutRoot } = this.paths;
    const folder = this.repository?.folder;
    if (!folder) fail('REPOSITORY_UNKNOWN');
    const full = await git.resolveRevision(checkoutRoot, rev);
    if (full !== rev) fail('REVISION_NOT_FOUND', 'gitRevision must be the full SHA of a local commit');
    if (!(await git.isPushed(checkoutRoot, rev, this.repository.branch))) fail('REVISION_NOT_PUSHED', `Push to origin/${this.repository.branch} first (no force-push)`);
    const answerPath = `${folder}/answers/${key}/submit.json`;
    const committed = await git.readFileAtRevision(checkoutRoot, rev, answerPath);
    if (committed == null) fail('ANSWER_NOT_COMMITTED', `${answerPath} is missing at ${rev}`);
    let committedJson;
    try { committedJson = JSON.parse(committed); } catch { fail('ANSWER_NOT_JSON', `${answerPath} is not valid JSON`); }
    if (canonical(committedJson) !== canonical(answer)) fail('ANSWER_MISMATCH', 'answer must equal the committed answers/<ID>/submit.json');
    const refs = [];
    const walk = (v) => {
      if (typeof v === 'string') {
        if (/^(answers\/|challenge\/evidence\/|\/)/.test(v) || v.includes('\\')) fail('EVIDENCE_PATH_INVALID', `Use evidence/<file>, not ${v}`);
        if (v.startsWith('evidence/')) refs.push(v);
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(answer);
    for (const ref of refs) {
      if (ref.split('/').includes('..')) fail('EVIDENCE_PATH_INVALID', ref);
      if (!(await git.fileExistsAtRevision(checkoutRoot, rev, `${folder}/answers/${key}/${ref}`))) fail('EVIDENCE_NOT_COMMITTED', `${ref} missing at ${rev}`);
    }
    return { evidenceFiles: refs };
  }

  async submitWork({ clientSubmissionId, backlogItemKey, gitRevision, answer, artifactUrls }) {
    this.requireActive('GAME');
    const key = backlogItemKey;
    if (!BACKLOG_KEY_RE.test(key ?? '')) fail('INVALID_BACKLOG_KEY');
    if (!SHA_RE.test(gitRevision ?? '')) fail('INVALID_GIT_REVISION', 'Full 40/64-char lowercase SHA required');
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) fail('ANSWER_REQUIRED');
    if ('gitRevision' in answer) fail('ANSWER_HAS_GIT_REVISION', 'gitRevision belongs at the request root, not inside answer');
    if (!this.bearer) fail('BEARER_UNAVAILABLE');
    if ((STATUS_RANK[this.items.get(key)?.status] ?? -1) < STATUS_RANK.IN_PROGRESS) fail('BACKLOG_NOT_STARTED', 'Call start_work first');

    const prev = this.submissions.get(key);
    if (prev?.state === 'ACCEPTED') return { ok: true, alreadyAccepted: true, receiptId: prev.receiptId, revision: prev.revision };

    const urls = artifactUrls ?? undefined;
    if (urls && (!Array.isArray(urls) || urls.length > 20 || urls.some((u) => !/^https:\/\//.test(u) || u.length > 2048))) fail('ARTIFACT_URLS_INVALID');

    let id, bodyText;
    if (prev?.state === 'UNCERTAIN') {
      // Outcome unknown: resend exactly the same request with the same Idempotency-Key.
      id = prev.clientSubmissionId;
      const candidate = JSON.stringify({ clientSubmissionId: id, backlogItemKey: key, gitRevision, answer, ...(urls ? { artifactUrls: urls } : {}) });
      if (candidate !== prev.bodyText) fail('UNCERTAIN_SUBMISSION_PENDING', 'Previous submit outcome is unknown; retry with the identical gitRevision/answer');
      bodyText = prev.bodyText;
    } else {
      // Submission Authority: submission is irreversible, so the gate must have approved this item.
      const brainItem = this.brain.get(key);
      if (brainItem.status !== ItemStatus.READY_TO_SUBMIT) {
        return { ok: false, error: 'GATE_NOT_PASSED', brainStatus: brainItem.status, checks: brainItem.gate?.checks ?? null, instruction: 'Run report_verification with real results; submit only after the gate approves.' };
      }
      const evidence = await this.verifyRevision(key, gitRevision, answer);
      id = clientSubmissionId && UUID_RE.test(clientSubmissionId) ? clientSubmissionId : randomUUID();
      bodyText = JSON.stringify({ clientSubmissionId: id, backlogItemKey: key, gitRevision, answer, ...(urls ? { artifactUrls: urls } : {}) });
      if (Buffer.byteLength(bodyText) > 524_288) fail('PAYLOAD_TOO_LARGE');
      this.lastEvidence = evidence;
    }
    this.submissions.set(key, { clientSubmissionId: id, bodyText, state: 'UNCERTAIN', revision: gitRevision });

    const res = await this.apiCall('SUBMIT', key, 'POST', this.opUrl('SUBMIT'), {
      json: JSON.parse(bodyText),
      headers: { Authorization: `Bearer ${this.bearer}`, 'Idempotency-Key': id },
      withCookies: false,
      timeoutMs: 30_000,
    });
    const code = res.body?.error?.code ?? null;
    if (res.network || (res.status != null && res.status >= 500)) {
      return { ok: false, outcome: 'UNCERTAIN', error: res.error ?? `HTTP_${res.status}`, clientSubmissionId: id, instruction: 'Call submit_work again with identical arguments; the same Idempotency-Key is reused.' };
    }
    if (res.status === 429) {
      return { ok: false, outcome: 'UNCERTAIN', error: 'RATE_LIMITED', retryAfterSec: Number(res.retryAfter) || 10, clientSubmissionId: id };
    }
    if (!res.ok) {
      if (code === 'ALREADY_SUBMITTED') {
        this.submissions.set(key, { ...this.submissions.get(key), state: 'ALREADY_SUBMITTED' });
        return { ok: false, outcome: 'ALREADY_SUBMITTED', error: code, instruction: 'Server already holds a submission for this item. Do not resubmit.' };
      }
      this.submissions.set(key, { ...this.submissions.get(key), state: 'REJECTED' });
      return { ok: false, outcome: 'REJECTED', error: code ?? `HTTP_${res.status}`, httpStatus: res.status, message: this.http.redact(res.body?.error?.message ?? ''), details: res.body?.error?.details ?? null };
    }
    const b = res.body ?? {};
    const receiptId = b.receiptId ?? b.receipt?.id ?? b.receipt?.receiptId ?? b.submission?.receiptId ?? b.submissionId ?? b.submission?.id ?? b.id ?? null;
    if (!receiptId || !ID_RE.test(String(receiptId)) || String(receiptId).length > 128) {
      this.emit({ type: 'BLOCKER_OPENED', blockerId: 'SUBMIT_RECEIPT_MISSING', backlogId: key, summary: 'Submit returned 2xx without a usable receipt id.' });
      return { ok: false, outcome: 'UNCERTAIN', error: 'RECEIPT_MISSING', clientSubmissionId: id };
    }
    this.submissions.set(key, { ...this.submissions.get(key), state: 'ACCEPTED', receiptId: String(receiptId) });
    if (this.brain.get(key).status !== ItemStatus.SUBMITTED) this.brain.submitted(key);
    const item = this.items.get(key);
    item.status = 'SUBMITTED';
    this.emit({ type: 'BACKLOG_STATUS', backlogId: key, title: item.title, status: 'SUBMITTED', summary: 'Submission received by mtm-game-server.', revision: gitRevision, receiptId: String(receiptId) });
    return { ok: true, outcome: 'ACCEPTED', receiptId: String(receiptId), status: b.status ?? null, scoreStatus: b.scoreStatus ?? null, idempotentReplay: res.idempotentReplay, clientSubmissionId: id };
  }

  // ---------- competition brain ----------

  // Observer + DeadlineService + IncidentService + Watchdog + PortfolioPlanner in one call.
  async planNext() {
    this.requireActive('GAME');
    const view = await this.refresh();
    if (!view.ok) return view;
    const deadlines = this.brain.deadlines();
    const { actions, skipped, speed } = this.brain.plan();
    const pi = actions.find((a) => a.action === 'START_PI' || a.action === 'CONTINUE_PI');
    const working = actions.filter((a) => a.action === 'CONTINUE' && a.type !== 'PI');
    return {
      ok: true,
      match: view.match,
      next: actions[0] ?? null,
      actions,
      skipped,
      speed,
      preempt: pi && working.length ? { incident: pi.itemId, park: working.map((w) => w.itemId), instruction: 'PI overrides all: park current work (keep it uncommitted or on a local branch), handle the PI, then resume.' } : null,
      deadlines,
      incidents: this.brain.incidents(),
      stuck: this.brain.stuck(),
      newItems: view.changes,
    };
  }

  // Testing service + Review + Submission Authority gate. Logs BACKLOG_TESTS with the real counts.
  async reportVerification({ backlogItemKey, mvs, extra, skipped = 0, review, evidenceFiles = [] }) {
    this.requireActive('GAME');
    const key = backlogItemKey;
    if (!BACKLOG_KEY_RE.test(key ?? '')) fail('INVALID_BACKLOG_KEY');
    const count = (v) => (Number.isInteger(v) && v >= 0 ? v : fail('TEST_COUNTS_REQUIRED', 'counts must be non-negative integers'));
    const m = { total: count(mvs?.total ?? 0), passed: count(mvs?.passed ?? 0) };
    const x = { total: count(extra?.total ?? 0), passed: count(extra?.passed ?? 0) };
    if (m.passed > m.total || x.passed > x.total) fail('TEST_COUNTS_INCONSISTENT');
    if (!review || typeof review !== 'object') fail('REVIEW_REQUIRED', 'Self-review scores are required: correctness, regressionRisk, maintainability, security (0..1)');

    const evidenceDir = join(this.paths.matchRoot, 'answers', key, 'evidence');
    const missing = [];
    for (const f of evidenceFiles) {
      if (typeof f !== 'string' || !/^evidence\/[^\\]+$/.test(f) || f.split('/').includes('..')) fail('EVIDENCE_PATH_INVALID', `Use evidence/<file>, not ${f}`);
      if (!existsSync(join(evidenceDir, f.slice('evidence/'.length)))) missing.push(f);
    }

    const before = this.brain.get(key).status;
    const item = this.brain.verify(key, { mvs: m, extra: x, review, evidenceFiles }, { evidenceOk: missing.length === 0 });
    const executed = m.total + x.total;
    const passed = m.passed + x.passed;
    const required = Math.max(item.mvsRequired, m.total);
    const testsPassed = executed > 0 && passed === executed && m.total >= item.mvsRequired;
    this.emit({ type: 'BACKLOG_TESTS', backlogId: key, status: testsPassed ? 'PASSED' : 'FAILED', required, executed, passed, failed: executed - passed, skipped: count(skipped), summary: summaryText(`MVS ${m.passed}/${m.total}, extra ${x.passed}/${x.total}, coverage ${item.gate.coverage}%.`, 'Tests reported.') });
    if (item.gate.approved) {
      const logged = this.items.get(key);
      if (logged && (STATUS_RANK[logged.status] ?? 0) < STATUS_RANK.COMPLETED) {
        logged.status = 'COMPLETED';
        this.emit({ type: 'BACKLOG_STATUS', backlogId: key, title: logged.title, status: 'COMPLETED', summary: 'Verified and approved by the Submission Authority gate.', revision: null, receiptId: null });
      }
    }
    return {
      ok: true,
      approved: item.gate.approved,
      checks: item.gate.checks,
      confidence: item.gate.confidence,
      coverage: item.gate.coverage,
      missingEvidence: missing,
      from: before,
      brainStatus: item.status,
      instruction: item.gate.approved
        ? 'Approved. Fill answers/<ID>/submit.json, commit everything together, push, then submit_work.'
        : 'Rejected: item went back to IMPLEMENTING. Fix the failing checks (more scenarios, fixes, evidence) and verify again.',
    };
  }

  updateItem({ backlogItemKey, action, reason }) {
    this.requireActive('GAME');
    const key = backlogItemKey;
    if (!BACKLOG_KEY_RE.test(key ?? '')) fail('INVALID_BACKLOG_KEY');
    if (action === 'rework') return { ok: true, brainStatus: this.brain.reworkItem(key).status };
    if (action === 'fail') {
      const item = this.brain.fail(key);
      const logged = this.items.get(key);
      if (logged && logged.status !== 'SUBMITTED') {
        logged.status = 'FAILED';
        this.emit({ type: 'BACKLOG_STATUS', backlogId: key, title: logged.title, status: 'FAILED', summary: summaryText(reason, 'Abandoned by the orchestrator.'), revision: null, receiptId: null });
      }
      return { ok: true, brainStatus: item.status };
    }
    fail('INVALID_ACTION', 'action must be rework or fail');
  }

  // Repository intelligence over the assigned match folder (read-only).
  scanRepository({ impactOf, refresh = false } = {}) {
    if (!this.paths?.matchRoot || !existsSync(this.paths.matchRoot)) fail('MATCH_ROOT_MISSING', 'Check out the assigned source first');
    if (!this.repoKnowledge || refresh) this.repoKnowledge = scanRepo(this.paths.matchRoot);
    const out = { ok: true, ...summarize(this.repoKnowledge) };
    if (impactOf) out.impact = impactedFiles(this.repoKnowledge, String(impactOf));
    return out;
  }

  // ---------- progress events from the orchestrator ----------

  async reportProgress({ event }) {
    if (!event || typeof event !== 'object') fail('EVENT_REQUIRED');
    if (this.phase === 'ENDED' && event.type !== 'ORCHESTRATOR_ENDED') fail('MATCH_ENDED');
    const e = { ...event };
    delete e.schemaVersion;
    delete e.playerSessionId;
    const helperOwned = ['ORCHESTRATOR_STARTED', 'ORCHESTRATOR_RESTARTED', 'GAME_MASTER_API', 'GAME_START_STATUS'];
    if (helperOwned.includes(e.type)) fail('EVENT_OWNED_BY_HELPER', `${e.type} is written by the helper automatically`);

    switch (e.type) {
      case 'PREPARATION_STATUS':
        if (e.stage === 'PREPARE_COMPLETE') fail('EVENT_OWNED_BY_PLAYER', 'mtm-player owns PREPARE_COMPLETE');
        if (e.stage === 'MATCH_LOGIN') fail('EVENT_OWNED_BY_HELPER', 'login_match writes MATCH_LOGIN');
        if (e.stage === 'BUILD') this.buildCompleted = e.status === 'COMPLETED';
        e.summary = summaryText(e.summary, `${e.stage} ${e.status}`);
        break;
      case 'ENVIRONMENT_READY': {
        if (!this.matchLoginPassed) fail('NOT_READY', 'login_match has not passed');
        if (!this.buildCompleted) fail('NOT_READY', 'Report PREPARATION_STATUS BUILD COMPLETED after a real build first');
        const head = await git.headRevision(this.paths.checkoutRoot);
        const revision = e.revision ?? head;
        if (!SHA_RE.test(revision ?? '') || revision !== head) fail('REVISION_MISMATCH', 'revision must be the checked-out HEAD');
        const r = this.repository;
        Object.assign(e, { requestId: this.descriptor.requestId, repository: { url: r.url, branch: r.branch, folder: r.folder }, revision, build: 'PASS', matchLogin: 'PASS' });
        break;
      }
      case 'BACKLOG_STATUS': {
        if (e.status === 'SUBMITTED') fail('EVENT_OWNED_BY_HELPER', 'submit_work logs SUBMITTED with the official receipt');
        if (e.status === 'COMPLETED') fail('EVENT_OWNED_BY_HELPER', 'report_verification logs COMPLETED when the gate approves');
        if (e.status === 'FAILED') fail('USE_UPDATE_ITEM', 'Use update_item {action:"fail"} so the brain state follows');
        const item = this.items.get(e.backlogId);
        if (e.status === 'IN_PROGRESS' && (!item || STATUS_RANK[item.status] < 1)) fail('BACKLOG_NOT_STARTED', 'start_work logs IN_PROGRESS');
        if (item && (STATUS_RANK[e.status] ?? 0) < (STATUS_RANK[item.status] ?? 0)) return { ok: true, skipped: 'status would regress' };
        e.title = titleText(e.title ?? item?.title, e.backlogId);
        e.summary = summaryText(e.summary, 'Work status updated.');
        e.revision = e.revision ?? null;
        e.receiptId = null;
        if (item) item.status = e.status;
        else this.items.set(e.backlogId, { title: e.title, status: e.status, revisionNo: null });
        break;
      }
      case 'BACKLOG_TESTS': {
        if (e.status === 'PASSED' || e.status === 'FAILED') fail('USE_REPORT_VERIFICATION', 'Final test results go through report_verification (Submission Authority)');
        const n = (k) => Number.isInteger(e[k]) ? e[k] : fail('TEST_COUNTS_REQUIRED', `${k} must be an integer`);
        const [required, executed, passed, failed, skipped] = ['required', 'executed', 'passed', 'failed', 'skipped'].map(n);
        if (passed + failed > executed) fail('TEST_COUNTS_INCONSISTENT');
        if (e.status === 'PASSED' && (failed > 0 || executed === 0 || passed < required)) fail('TEST_COUNTS_INCONSISTENT', 'PASSED needs executed>0, failed=0, passed>=required');
        if (e.status === 'FAILED' && failed === 0 && passed >= required && executed > 0) fail('TEST_COUNTS_INCONSISTENT', 'FAILED needs a failure or missing required tests');
        if (e.status === 'NOT_RUN' && executed !== 0) fail('TEST_COUNTS_INCONSISTENT');
        e.summary = summaryText(e.summary, `Tests ${e.status}.`);
        break;
      }
      case 'ORCHESTRATOR_ENDED':
        if (e.status === 'COMPLETED') fail('EVENT_OWNED_BY_HELPER', 'COMPLETED is logged when mtm-player ends the match');
        e.summary = summaryText(e.summary, 'Orchestrator stopped.');
        break;
      default:
        if ('summary' in e || ['BLOCKER_OPENED', 'BLOCKER_RESOLVED', 'TOOL_ACTIVITY', 'NETWORK_ACTIVITY', 'MODEL_USAGE'].includes(e.type)) {
          e.summary = summaryText(e.summary, e.type);
        }
        if (e.type === 'BLOCKER_OPENED' && !('backlogId' in e)) e.backlogId = null;
    }
    const r = this.emit(e);
    if (!r.ok) return { ok: false, error: 'EVENT_REJECTED', errors: r.errors };
    return { ok: true };
  }
}
