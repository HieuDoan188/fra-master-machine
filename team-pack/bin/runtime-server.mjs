#!/usr/bin/env node
// MCP Helper for the MTM team pack. Newline-delimited JSON-RPC 2.0 over stdin/stdout.
// stdout carries JSON-RPC only; tool results are safe JSON inside a text content block.

import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RuntimeSession } from '../src/runtime-session.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
const session = new RuntimeSession();

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOLS = [
  {
    name: 'configure_session',
    description: 'Load an mtm-player lifecycle input (PREPARE_GAME_V2, START_GAME_V4, RESUME_*_V1, MATCH_PAUSED_V1, MATCH_ENDED_V1). Prefer passing the raw input text in `input`; credentials stay in helper memory and are never echoed. Writes ORCHESTRATOR_STARTED / ORCHESTRATOR_RESTARTED / ORCHESTRATOR_ENDED automatically.',
    inputSchema: obj({
      input: { type: 'string', description: 'Raw lifecycle message text including the marker line(s) and MTM_MODEL_POLICY_V1 suffix.' },
      descriptor: { type: 'object', description: 'Already-parsed descriptor JSON (alternative to input).' },
      modelPolicy: { type: 'object', description: 'Parsed MTM_MODEL_POLICY_V1 object, if any.' },
    }),
  },
  {
    name: 'login_match',
    description: 'Log in to mtm-game-server with the account from mtm-player, open the exact match and verify team/repository/branch/folder. Logs GAME_MASTER_API and (during preparation) PREPARATION_STATUS MATCH_LOGIN.',
    inputSchema: obj({}),
  },
  {
    name: 'refresh_match',
    description: 'Read the current match view (status, backlog, project context). During the game, logs BACKLOG_SYNC on first call and DISCOVERED for each new item. Re-authenticates on expired cookie.',
    inputSchema: obj({}),
  },
  {
    name: 'start_work',
    description: 'POST Start Work for one backlog item before editing source. Materializes answers/<ID>/submit.json from the server template and creates answers/<ID>/evidence/. Logs IN_PROGRESS and BACKLOG_TESTS NOT_RUN.',
    inputSchema: obj({ backlogItemKey: { type: 'string', description: 'Backlog ID, e.g. TASK-01' } }, ['backlogItemKey']),
  },
  {
    name: 'submit_work',
    description: 'Submit a backlog item. Verifies the full SHA is pushed to the assigned branch and contains answers/<ID>/submit.json equal to `answer` plus every referenced evidence/<file>. Reuses the Idempotency-Key on uncertain outcomes. Logs SUBMITTED only with an official receipt.',
    inputSchema: obj({
      clientSubmissionId: { type: 'string', description: 'Optional UUID; generated if omitted. Kept unchanged on retries.' },
      backlogItemKey: { type: 'string' },
      gitRevision: { type: 'string', description: 'Full 40/64-char commit SHA already pushed.' },
      answer: { type: 'object', description: 'Exact JSON committed at answers/<ID>/submit.json.' },
      artifactUrls: { type: 'array', items: { type: 'string' } },
    }, ['backlogItemKey', 'gitRevision', 'answer']),
  },
  {
    name: 'report_progress',
    description: 'Append a progress event (without schemaVersion/playerSessionId). Use for PREPARATION_STATUS (GIT_AUTH/REPOSITORY/ENVIRONMENT/BUILD), ENVIRONMENT_READY ({type, revision}), BACKLOG_TESTS with real counts, BACKLOG_STATUS COMPLETED/BLOCKED/FAILED, BLOCKER_OPENED/RESOLVED. Helper-owned events are rejected.',
    inputSchema: obj({ event: { type: 'object' } }, ['event']),
  },
  {
    name: 'wait_for_update',
    description: 'Bounded serial polling of the match view, done inside the helper at zero token cost. Up to 55s normally; up to 600s when every visible item is already SUBMITTED/CLOSED/FAILED (waiting for the next brief wave). Returns within ~5s of a new/revised item, a new PI, a deadline warning, a match status change, or pause/end.',
    inputSchema: obj({ timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000 } }),
  },
  {
    name: 'plan_next',
    description: 'Competition brain: refresh the match, then return the EV-ranked plan (PI first, READY_TO_SUBMIT first, capacity-limited), PI preemption, deadline warnings/expiries, open incidents with MTTR, and stuck items. Call it whenever you choose what to do next.',
    inputSchema: obj({}),
  },
  {
    name: 'report_verification',
    description: 'Submission Authority gate. Report real test results and a self-review; the helper logs BACKLOG_TESTS and approves (READY_TO_SUBMIT) or sends the item back to IMPLEMENTING. submit_work refuses items the gate has not approved. Gate: all MVS passed, coverage>=90% over MVS+extra scenarios, review confidence>=0.85, regressionRisk<=0.10, correctness>=0.8, evidence files present.',
    inputSchema: obj({
      backlogItemKey: { type: 'string' },
      mvs: obj({ total: { type: 'integer', minimum: 0 }, passed: { type: 'integer', minimum: 0 } }, ['total', 'passed']),
      extra: obj({ total: { type: 'integer', minimum: 0 }, passed: { type: 'integer', minimum: 0 } }, ['total', 'passed']),
      skipped: { type: 'integer', minimum: 0 },
      review: obj({
        correctness: { type: 'number', minimum: 0, maximum: 1 },
        regressionRisk: { type: 'number', minimum: 0, maximum: 1 },
        maintainability: { type: 'number', minimum: 0, maximum: 1 },
        security: { type: 'number', minimum: 0, maximum: 1 },
        notes: { type: 'string' },
      }, ['correctness', 'regressionRisk', 'maintainability', 'security']),
      evidenceFiles: { type: 'array', items: { type: 'string' }, description: 'evidence/<file> paths under answers/<ID>/' },
    }, ['backlogItemKey', 'mvs', 'extra', 'review', 'evidenceFiles']),
  },
  {
    name: 'update_item',
    description: 'Move an item in the brain state machine: rework (back to IMPLEMENTING) or fail (abandon; logs BACKLOG_STATUS FAILED).',
    inputSchema: obj({ backlogItemKey: { type: 'string' }, action: { type: 'string', enum: ['rework', 'fail'] }, reason: { type: 'string' } }, ['backlogItemKey', 'action']),
  },
  {
    name: 'scan_repo',
    description: 'Repository intelligence for the assigned match folder: projects, stack, build/test commands, folders, test files, and optional impact query (files affected by changing a path or symbol).',
    inputSchema: obj({ impactOf: { type: 'string' }, refresh: { type: 'boolean' } }),
  },
  {
    name: 'company_tool',
    description: 'Company knowledge for the assigned match (Game Master match MCP, team key stays in helper memory): kb_search finds company policies/standards (query "index" lists them), get_test_data returns official fixtures/loaders. Active play only. Authoritative business rules: consult it on the first item and whenever a requirement, an old test, or a migration seem to disagree.',
    inputSchema: obj({ name: { type: 'string', enum: ['kb_search', 'get_test_data'] }, arguments: { type: 'object' } }, ['name']),
  },
  {
    name: 'session_status',
    description: 'Safe snapshot of helper state (phase, paths, known backlog, submissions). Never includes secrets.',
    inputSchema: obj({}),
  },
];

// MCP tool annotations. mtm-player runs Codex with approvalsReviewer=auto_review; read-only hints keep
// the reviewer from blocking safe calls such as login/refresh during preparation (seen in practice matches).
const READ_ONLY = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const LOCAL_WRITE = Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
const ANNOTATIONS = {
  login_match: READ_ONLY, refresh_match: READ_ONLY, wait_for_update: READ_ONLY, plan_next: READ_ONLY,
  scan_repo: READ_ONLY, company_tool: READ_ONLY, session_status: READ_ONLY,
  report_progress: LOCAL_WRITE, report_verification: LOCAL_WRITE, update_item: LOCAL_WRITE,
};
for (const tool of TOOLS) if (ANNOTATIONS[tool.name]) tool.annotations = ANNOTATIONS[tool.name];

const handlers = {
  company_tool: (a) => session.company(a),
  configure_session: (a) => session.configure(a),
  login_match: () => session.login(),
  refresh_match: () => session.refresh(),
  start_work: (a) => session.startWork(a),
  submit_work: (a) => session.submitWork(a),
  report_progress: (a) => session.reportProgress(a),
  wait_for_update: (a) => session.waitForUpdate(a),
  plan_next: () => session.planNext(),
  report_verification: (a) => session.reportVerification(a),
  update_item: (a) => session.updateItem(a),
  scan_repo: (a) => session.scanRepository(a),
  session_status: () => session.safeStatus(),
};

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function callTool(name, args) {
  const handler = handlers[name];
  if (!handler) return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'UNKNOWN_TOOL' }) }], isError: true };
  try {
    // configure_session (pause/end control) and status are synchronous and must not wait behind a poll.
    const unlocked = name === 'configure_session' || name === 'session_status';
    const result = unlocked ? await handler(args ?? {}) : await session.run(() => handler(args ?? {}));
    const text = session.http.redact(JSON.stringify(result));
    return { content: [{ type: 'text', text }], isError: result?.ok === false };
  } catch (err) {
    const text = session.http.redact(JSON.stringify({ ok: false, error: err.code ?? 'INTERNAL_ERROR', message: err.message }));
    return { content: [{ type: 'text', text }], isError: true };
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    switch (method) {
      case 'initialize':
        return isRequest && send({ jsonrpc: '2.0', id, result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'mtm_minimal', version: pkg.version },
        } });
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return;
      case 'ping':
        return isRequest && send({ jsonrpc: '2.0', id, result: {} });
      case 'tools/list':
        return isRequest && send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      case 'tools/call':
        return isRequest && send({ jsonrpc: '2.0', id, result: await callTool(params?.name, params?.arguments) });
      default:
        if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (err) {
    if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32603, message: session.http.redact(err.message) } });
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (!line.trim()) return;
  if (line.length > 1_000_000) return send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } });
  let msg;
  try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
  handle(msg);
});
rl.on('close', () => process.exit(0));
