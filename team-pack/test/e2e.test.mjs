// End-to-end smoke test: install the pack into a clean workspace, drive the installed MCP helper
// over stdio against the loopback mock server, and validate every progress line.
//   node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockServer } from './mock-server.mjs';
import { loadProgressSchema, validateProgressEvent } from '../src/schema.mjs';

const packRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'FAKE_PASSWORD_FOR_EXAMPLE';
const BEARER = 'FAKE_TEAM_KEY_FOR_EXAMPLE';
const REPO = { url: 'https://github.com/example/repo.git', branch: 'main', folder: 'ABCD1234' };

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

class McpClient {
  constructor(serverPath) {
    this.child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, MTM_PACK_ALLOW_LOOPBACK: '1' } });
    this.child.unref();
    this.pending = new Map();
    this.nextId = 1;
    this.stdoutLines = [];
    let buf = '';
    this.child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        this.stdoutLines.push(line);
        const msg = JSON.parse(line); // stdout must be JSON-RPC only
        this.pending.get(msg.id)?.(msg);
      }
    });
  }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async call(name, args = {}) {
    if (process.env.MTM_TEST_DEBUG) console.error(`→ ${name}`);
    const msg = await this.request('tools/call', { name, arguments: args });
    const out = JSON.parse(msg.result.content[0].text);
    if (process.env.MTM_TEST_DEBUG) console.error(`← ${name} ${JSON.stringify(out).slice(0, Number(process.env.MTM_TEST_DEBUG_LEN ?? 300))}`);
    return out;
  }
  close() { this.child.stdin.end(); this.child.kill(); }
}

test('full match lifecycle against mock game server', { timeout: 120_000 }, async (t) => {
  const base = mkdtempSync(join(tmpdir(), 'mtm-pack-'));
  const tw = join(base, 'FRA');
  execFileSync(process.execPath, [join(packRoot, 'scripts', 'install.mjs'), '--team-workspace', tw]);
  const check = execFileSync(process.execPath, [join(packRoot, 'scripts', 'check-distribution.mjs'), '--team-workspace', tw], { encoding: 'utf8' });
  assert.match(check, /READY/);

  // Assigned repository: local bare remote reached through https URL rewriting.
  const bare = join(base, 'remote.git');
  git(base, 'init', '--bare', '-b', 'main', bare);
  const seed = join(base, 'seed');
  git(base, 'clone', bare, seed);
  mkdirSync(join(seed, 'ABCD1234', 'src'), { recursive: true });
  writeFileSync(join(seed, 'ABCD1234', 'src', 'app.txt'), 'v1\n');
  git(seed, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git(seed, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'seed');
  git(seed, 'push', 'origin', 'HEAD:main');
  const checkoutRoot = join(tw, 'matches', 'ABCD1234');
  const matchRoot = join(checkoutRoot, 'ABCD1234');
  git(base, '-c', `url.${bare.replace(/\\/g, '/')}.insteadOf=${REPO.url}`, 'clone', '--branch', 'main', REPO.url, checkoutRoot);
  git(checkoutRoot, 'config', `url.${bare.replace(/\\/g, '/')}.insteadOf`, REPO.url);
  git(checkoutRoot, 'config', 'user.email', 't@t');
  git(checkoutRoot, 'config', 'user.name', 't');

  const mock = await startMockServer({ username: 'fra-cuder', password: PASSWORD, bearer: BEARER, repo: REPO });
  t.after(() => mock.close());
  const progressLogFile = join(tw, 'team-sdlc-pack', 'logs', 'ABCD1234.progress.ndjson').replace(/\\/g, '/');
  const common = { schemaVersion: 1, playerSessionId: 'session-example', teamId: 'FRA', teamName: 'FRA Master Machine', matchId: 'ABCD1234' };
  const prepare = {
    ...common, type: 'PREPARE_GAME', requestId: 'prepare-example', username: 'fra-cuder', password: PASSWORD,
    matchPageUrl: `${mock.origin}/match`, allowedMatchOrigins: [mock.origin], repository: REPO,
    hostAuthorization: { schemaVersion: 1, type: 'MTM_PREPARATION_HOST_AUTHORIZATION', playerSessionId: 'session-example', matchId: 'ABCD1234', repository: REPO, gitOperations: ['READ_ASSIGNED_REPOSITORY'] },
    checkoutRoot: checkoutRoot.replace(/\\/g, '/'), matchRoot: matchRoot.replace(/\\/g, '/'),
  };
  const auth = {
    schemaVersion: 1, type: 'MTM_HOST_AUTHORIZATION', playerSessionId: 'session-example', matchId: 'ABCD1234',
    allowedOrigins: [mock.origin], apiScopes: ['backlogs:start', 'submissions:create'],
    apiOperations: [
      { operation: 'START_WORK', method: 'POST', pathTemplate: '/api/v1/matches/{matchUuid}/backlogs/start' },
      { operation: 'SUBMIT', method: 'POST', pathTemplate: '/api/v1/matches/{matchUuid}/submissions' },
    ],
  };
  const start = {
    ...common, type: 'START_GAME', requestId: 'start-example', teamUuid: '22222222-2222-4222-8222-222222222222',
    gameMasterApiUrl: `${mock.origin}/`, apiKeySecret: BEARER, apiKeyLength: Buffer.byteLength(BEARER),
    apiKeySha256: createHash('sha256').update(BEARER).digest('hex'), apiKeyScopes: auth.apiScopes,
    gameMasterUrl: `${mock.origin}/`, matchPageUrl: `${mock.origin}/match`, allowedApiOrigins: [mock.origin],
    teamWorkspace: tw.replace(/\\/g, '/'), challengeWorkspace: join(tw, 'matches').replace(/\\/g, '/'),
    teamSdlcPackWorkspace: join(tw, 'team-sdlc-pack').replace(/\\/g, '/'), progressLogFile,
    environmentRevision: git(checkoutRoot, 'rev-parse', 'HEAD'), hostAuthorization: auth,
    gitPolicy: { commitAssignedRepository: true, pushAssignedRepository: true, forcePush: false, mutateRemote: false, authentication: 'ASK_USER' },
    checkoutRoot: prepare.checkoutRoot, matchRoot: prepare.matchRoot,
  };
  const policy = { schemaVersion: 1, orchestratorModel: 'gpt-x', allowedModels: ['gpt-x'], enforcement: 'STRICT' };
  const wire = (marker, d) => `${marker}\n${JSON.stringify(d)}\nMTM_MODEL_POLICY_V1\n${JSON.stringify(policy)}\n`;

  const server = join(tw, 'team-sdlc-pack', 'runtime', 'bin', 'runtime-server.mjs');
  let mcp = new McpClient(server);
  try {
    const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.equal(init.result.serverInfo.name, 'mtm_minimal');
    const list = await mcp.request('tools/list', {});
    assert.ok(list.result.tools.every((t) => t.inputSchema?.type === 'object'));

    // --- preparation ---
    let r = await mcp.call('configure_session', { input: wire('PREPARE_GAME_V2', prepare) });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.allowedModels, ['gpt-x']);
    for (const stage of ['GIT_AUTH', 'REPOSITORY', 'ENVIRONMENT']) {
      assert.equal((await mcp.call('report_progress', { event: { type: 'PREPARATION_STATUS', stage, status: 'COMPLETED', summary: `${stage} ok` } })).ok, true);
    }
    assert.equal((await mcp.call('report_progress', { event: { type: 'ENVIRONMENT_READY' } })).error, 'NOT_READY');
    assert.equal((await mcp.call('report_progress', { event: { type: 'PREPARATION_STATUS', stage: 'PREPARE_COMPLETE', status: 'COMPLETED', summary: 'x' } })).error, 'EVENT_OWNED_BY_PLAYER');
    r = await mcp.call('login_match');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal((await mcp.call('report_progress', { event: { type: 'PREPARATION_STATUS', stage: 'BUILD', status: 'COMPLETED', summary: 'Build passed.' } })).ok, true);
    assert.equal((await mcp.call('report_progress', { event: { type: 'ENVIRONMENT_READY' } })).ok, true);
    assert.equal((await mcp.call('start_work', { backlogItemKey: 'TASK-01' })).error, 'WRONG_PHASE');

    // --- start game ---
    assert.equal((await mcp.call('configure_session', { input: wire('START_GAME_V4', { ...start, apiKeySha256: '0'.repeat(64) }) })).error, 'API_KEY_HASH_MISMATCH');
    r = await mcp.call('configure_session', { input: wire('START_GAME_V4', start) });
    assert.equal(r.ok, true, JSON.stringify(r));
    r = await mcp.call('refresh_match');
    assert.deepEqual(r.changes.map((c) => c.key), ['TASK-01']);

    r = await mcp.call('start_work', { backlogItemKey: 'TASK-01' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(existsSync(join(matchRoot, 'answers', 'TASK-01', 'submit.json')));
    assert.ok(existsSync(join(matchRoot, 'answers', 'TASK-01', 'evidence')));
    assert.equal((await mcp.call('start_work', { backlogItemKey: 'TASK-01' })).replay, true);

    // --- brain: plan says continue TASK-01 ---
    r = await mcp.call('plan_next');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.next.itemId, 'TASK-01');
    assert.equal(r.next.action, 'CONTINUE');
    assert.equal((await mcp.call('scan_repo', { impactOf: 'app' })).ok, true);

    // --- tests must be honest; final results only through the Submission Authority ---
    assert.equal((await mcp.call('report_progress', { event: { type: 'BACKLOG_TESTS', backlogId: 'TASK-01', status: 'PASSED', required: 2, executed: 2, passed: 2, failed: 0, skipped: 0 } })).error, 'USE_REPORT_VERIFICATION');
    assert.equal((await mcp.call('report_progress', { event: { type: 'BACKLOG_TESTS', backlogId: 'TASK-01', status: 'RUNNING', required: 2, executed: 0, passed: 0, failed: 0, skipped: 0 } })).ok, true);

    // --- implement, answer, evidence ---
    writeFileSync(join(matchRoot, 'src', 'app.txt'), 'v2\n');
    const review = { correctness: 0.9, regressionRisk: 0.05, maintainability: 0.85, security: 0.95 };
    r = await mcp.call('report_verification', { backlogItemKey: 'TASK-01', mvs: { total: 2, passed: 1 }, extra: { total: 1, passed: 1 }, review, evidenceFiles: ['evidence/TASK-01-TC-01.txt'] });
    assert.equal(r.approved, false);
    assert.equal(r.checks.mvs_pass, false);
    assert.deepEqual(r.missingEvidence, ['evidence/TASK-01-TC-01.txt']);
    assert.equal(r.brainStatus, 'IMPLEMENTING');
    writeFileSync(join(matchRoot, 'answers', 'TASK-01', 'evidence', 'TASK-01-TC-01.txt'), 'pass\n');
    r = await mcp.call('report_verification', { backlogItemKey: 'TASK-01', mvs: { total: 2, passed: 2 }, extra: { total: 1, passed: 1 }, review, evidenceFiles: ['evidence/TASK-01-TC-01.txt'] });
    assert.equal(r.approved, true, JSON.stringify(r));
    assert.equal(r.brainStatus, 'READY_TO_SUBMIT');
    assert.equal((await mcp.call('plan_next')).next.action, 'SUBMIT');
    const answer = { backlogId: 'TASK-01', status: 'SUBMITTED', changeSummary: 'Fixed search.', evidenceFiles: ['evidence/TASK-01-TC-01.txt'] };
    writeFileSync(join(matchRoot, 'answers', 'TASK-01', 'submit.json'), JSON.stringify(answer, null, 2) + '\n');
    git(checkoutRoot, 'add', '-A');
    git(checkoutRoot, 'commit', '-m', 'TASK-01');
    const sha = git(checkoutRoot, 'rev-parse', 'HEAD');

    assert.equal((await mcp.call('submit_work', { backlogItemKey: 'TASK-01', gitRevision: sha, answer })).error, 'REVISION_NOT_PUSHED');
    git(checkoutRoot, 'push', 'origin', 'HEAD:main');
    assert.equal((await mcp.call('submit_work', { backlogItemKey: 'TASK-01', gitRevision: sha, answer: { ...answer, changeSummary: 'other' } })).error, 'ANSWER_MISMATCH');
    assert.equal((await mcp.call('submit_work', { backlogItemKey: 'TASK-01', gitRevision: sha, answer: { ...answer, evidenceFiles: ['evidence/missing.txt'] } })).error, 'ANSWER_MISMATCH');

    // --- uncertain outcome → identical retry with the same Idempotency-Key ---
    mock.state.failNextSubmit = 1;
    r = await mcp.call('submit_work', { backlogItemKey: 'TASK-01', gitRevision: sha, answer });
    assert.equal(r.outcome, 'UNCERTAIN');
    const firstId = r.clientSubmissionId;
    assert.equal((await mcp.call('submit_work', { backlogItemKey: 'TASK-01', gitRevision: sha, answer: { ...answer, changeSummary: 'x' } })).error, 'UNCERTAIN_SUBMISSION_PENDING');
    r = await mcp.call('submit_work', { backlogItemKey: 'TASK-01', gitRevision: sha, answer });
    assert.equal(r.outcome, 'ACCEPTED', JSON.stringify(r));
    assert.equal(r.clientSubmissionId, firstId);
    const submitCalls = mock.state.calls.filter((c) => c.path.endsWith('/submissions'));
    assert.ok(submitCalls.every((c) => c.headers['idempotency-key'] === firstId));
    assert.equal((await mcp.call('report_progress', { event: { type: 'BACKLOG_STATUS', backlogId: 'TASK-01', status: 'SUBMITTED' } })).error, 'EVENT_OWNED_BY_HELPER');

    // --- expired cookie + newly published item during wait ---
    mock.state.sessions.clear();
    mock.state.elapsedSec = 900;
    mock.state.backlog.push({ key: 'CR-01', title: 'Add export', backlogType: 'CR', points: 40, status: 'OPEN', revisionNo: 1, deadlineMinutes: 20, revealedElapsedSec: 840 });
    mock.state.backlog.push({ key: 'PI-01', title: 'Checkout is down', backlogType: 'PI', points: 100, status: 'OPEN', revisionNo: 1, deadlineMinutes: 10, revealedElapsedSec: 880 });
    r = await mcp.call('wait_for_update', { timeoutMs: 3000 });
    assert.equal(r.changed, true, JSON.stringify(r));
    assert.deepEqual(r.changes.map((c) => c.key), ['CR-01', 'PI-01']);
    assert.deepEqual(r.incidentsOpened, ['PI-01']);
    r = await mcp.call('plan_next');
    assert.equal(r.next.itemId, 'PI-01');
    assert.equal(r.next.action, 'START_PI');
    assert.equal(r.next.workflow, 'workflow-pi');
    assert.ok(r.actions.some((a) => a.itemId === 'CR-01' && a.action === 'START_WORKING'));
    assert.ok(r.incidents.some((i) => i.itemId === 'PI-01' && i.open));

    // --- pause blocks work ---
    await mcp.call('configure_session', { input: `MATCH_PAUSED_V1\n${JSON.stringify({ ...common, type: 'MATCH_PAUSED', matchStatus: 'PAUSED' })}` });
    assert.equal((await mcp.call('start_work', { backlogItemKey: 'PI-01' })).error, 'MATCH_PAUSED');
  } finally {
    mcp.close();
  }

  // --- replacement orchestrator reconciles from the log; no duplicate submission ---
  mcp = new McpClient(server);
  try {
    await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    const resume = { ...start, ...prepare, ...start, type: 'RESUME_GAME', requestId: 'restart-session-example-1', restartAttempt: 1, reason: 'OPERATOR_RESUME' };
    let r = await mcp.call('configure_session', { input: wire('RESUME_GAME_V1', resume) });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.submissions, [{ key: 'TASK-01', state: 'ACCEPTED', receiptId: 'receipt-1' }]);
    const before = mock.state.calls.length;
    r = await mcp.call('submit_work', { backlogItemKey: 'TASK-01', gitRevision: git(checkoutRoot, 'rev-parse', 'HEAD'), answer: {} });
    assert.equal(r.alreadyAccepted, true);
    assert.equal(mock.state.calls.length, before);
    r = await mcp.call('refresh_match');
    assert.equal(r.changes.length, 0, 'no duplicate DISCOVERED after resume');
    await mcp.call('configure_session', { input: `MATCH_ENDED_V1\n${JSON.stringify({ ...common, type: 'MATCH_ENDED', matchStatus: 'FINISHED' })}` });
    assert.equal((await mcp.call('refresh_match')).error, 'MATCH_ENDED');
    assert.ok(mcp.stdoutLines.every((l) => !l.includes(PASSWORD) && !l.includes(BEARER)), 'no secret in MCP output');
  } finally {
    mcp.close();
    await mock.close();
  }

  // --- progress log contract ---
  const schema = loadProgressSchema();
  const text = readFileSync(progressLogFile, 'utf8');
  assert.ok(!text.includes(PASSWORD) && !text.includes(BEARER), 'no secret in progress log');
  const events = text.trim().split('\n').map((l) => JSON.parse(l));
  for (const e of events) assert.deepEqual(validateProgressEvent(schema, e), [], JSON.stringify(e));
  const types = events.map((e) => e.type);
  assert.equal(types[0], 'ORCHESTRATOR_STARTED');
  assert.equal(types.filter((t) => t === 'ORCHESTRATOR_STARTED').length, 1);
  assert.ok(types.includes('ENVIRONMENT_READY'));
  assert.ok(types.includes('ORCHESTRATOR_RESTARTED'));
  assert.equal(types.at(-1), 'ORCHESTRATOR_ENDED');
  const submitted = events.filter((e) => e.type === 'BACKLOG_STATUS' && e.status === 'SUBMITTED');
  assert.equal(submitted.length, 1);
  assert.equal(submitted[0].receiptId, 'receipt-1');
  const discovered = events.filter((e) => e.type === 'BACKLOG_STATUS' && e.status === 'DISCOVERED').map((e) => e.backlogId);
  assert.deepEqual(discovered, ['TASK-01', 'CR-01', 'PI-01']);
  assert.ok(events.some((e) => e.type === 'BACKLOG_STATUS' && e.backlogId === 'TASK-01' && e.status === 'COMPLETED'));
  assert.deepEqual(events.filter((e) => e.type === 'BACKLOG_TESTS' && e.backlogId === 'TASK-01').map((e) => e.status), ['NOT_RUN', 'RUNNING', 'FAILED', 'PASSED']);
  // Every API request is bracketed by REQUESTED then SUCCEEDED/FAILED.
  const api = events.filter((e) => e.type === 'GAME_MASTER_API');
  for (let i = 0; i < api.length; i += 2) {
    assert.equal(api[i].phase, 'REQUESTED');
    assert.notEqual(api[i + 1].phase, 'REQUESTED');
    assert.equal(api[i].operation, api[i + 1].operation);
  }

  // Tampering with the runtime payload makes the checker fail.
  appendFileSync(join(tw, 'team-sdlc-pack', 'runtime', 'src', 'git.mjs'), '\n// tampered\n');
  let failed = false;
  try { execFileSync(process.execPath, [join(packRoot, 'scripts', 'check-distribution.mjs'), '--team-workspace', tw], { encoding: 'utf8' }); } catch { failed = true; }
  assert.ok(failed, 'checker must fail after tampering');
  rmSync(base, { recursive: true, force: true });
});
