// Loopback mock of mtm-game-server for smoke tests (fictitious data only).
import { createServer } from 'node:http';

export const MATCH_UUID = '11111111-1111-4111-8111-111111111111';

export function startMockServer({ username, password, bearer, repo, matchId = 'ABCD1234', teamCode = 'FRA' }) {
  const state = {
    sessions: new Set(),
    backlog: [{ key: 'TASK-01', title: 'Fix customer search', backlogType: 'TASK', points: 10, status: 'OPEN', revisionNo: 1, deadlineMinutes: 30, revealedElapsedSec: 0 }],
    elapsedSec: 60,
    started: new Set(),
    submissions: new Map(), // idempotencyKey -> { bodyText, response }
    submittedKeys: new Set(),
    failNextSubmit: 0,
    calls: [],
    sequence: 1,
  };

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'X-Request-Id': `req-${state.calls.length}`, ...headers });
    res.end(JSON.stringify(body));
  };
  const err = (res, status, code) => json(res, status, { error: { code, message: code, requestId: `req-${state.calls.length}`, details: null } });

  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      state.calls.push({ method: req.method, path: url.pathname, headers: req.headers, raw });
      const cookie = /sid=([a-z0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
      const authed = cookie && state.sessions.has(cookie);
      const bearerOk = req.headers.authorization === `Bearer ${bearer}`;

      if (req.method === 'POST' && url.pathname === '/api/v1/auth/login') {
        const b = JSON.parse(raw || '{}');
        if (b.username !== username || b.password !== password) return err(res, 401, 'INVALID_CREDENTIALS');
        const sid = Math.random().toString(36).slice(2);
        state.sessions.add(sid);
        return json(res, 200, { user: { role: 'CUDER' } }, { 'Set-Cookie': `sid=${sid}; Path=/; HttpOnly` });
      }

      if (req.method === 'GET' && url.pathname === `/api/v1/match/${matchId}`) {
        if (!authed) return err(res, 401, 'UNAUTHENTICATED');
        return json(res, 200, {
          match: { id: MATCH_UUID, status: 'IN_PROGRESS', currentSequence: state.sequence, elapsedSec: state.elapsedSec, remainingSec: 2400 - state.elapsedSec },
          team: { code: teamCode, name: 'FRA Master Machine' },
          repo,
          backlog: state.backlog,
          projectContext: { name: 'Solova', summary: 'Mock project', features: [] },
          api: { startEndpoint: `/api/v1/matches/${MATCH_UUID}/backlogs/start`, submissionEndpoint: `/api/v1/matches/${MATCH_UUID}/submissions`, feedEndpoint: null, pollActiveMs: 5000, pollIdleMs: 10000 },
          events: [],
        });
      }

      if (req.method === 'POST' && url.pathname === `/api/v1/matches/${MATCH_UUID}/backlogs/start`) {
        if (!bearerOk) return err(res, 401, 'INVALID_API_KEY');
        const { backlogItemKey } = JSON.parse(raw || '{}');
        if (!state.backlog.some((b) => b.key === backlogItemKey)) return err(res, 404, 'BACKLOG_ITEM_NOT_FOUND');
        const replay = state.started.has(backlogItemKey);
        state.started.add(backlogItemKey);
        const template = { backlogId: backlogItemKey, status: 'NOT_STARTED', changeSummary: '', evidenceFiles: [] };
        return json(res, replay ? 200 : 201, {
          backlogId: backlogItemKey,
          backlogType: 'TASK',
          startInstruction: 'Implement the change and fill the template.',
          submitTemplate: template,
          minimumVerificationScenarios: [{ id: 'TC-01' }, { id: 'TC-02' }],
          files: { [`challenge/${backlogItemKey}-submit.json`]: JSON.stringify(template, null, 2) },
          replay,
        });
      }

      if (req.method === 'POST' && url.pathname === `/api/v1/matches/${MATCH_UUID}/submissions`) {
        if (!bearerOk) return err(res, 401, 'INVALID_API_KEY');
        const key = req.headers['idempotency-key'];
        if (!/^[A-Za-z0-9._~-]{8,128}$/.test(key ?? '')) return err(res, 422, 'VALIDATION_ERROR');
        if (state.failNextSubmit > 0) { state.failNextSubmit--; return err(res, 503, 'UNAVAILABLE'); }
        const prev = state.submissions.get(key);
        if (prev) {
          if (prev.bodyText !== raw) return err(res, 409, 'IDEMPOTENCY_CONFLICT');
          return json(res, 201, prev.response, { 'Idempotent-Replay': 'true' });
        }
        const body = JSON.parse(raw);
        if (body.clientSubmissionId !== key) return err(res, 422, 'INVALID_SUBMISSION');
        if (state.submittedKeys.has(body.backlogItemKey)) return err(res, 409, 'ALREADY_SUBMITTED');
        state.submittedKeys.add(body.backlogItemKey);
        const response = { receiptId: `receipt-${state.submissions.size + 1}`, status: 'ACCEPTED', scoreStatus: 'PENDING' };
        state.submissions.set(key, { bodyText: raw, response });
        return json(res, 201, response);
      }

      return err(res, 404, 'NOT_FOUND');
    });
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    resolve({ server, state, origin, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) });
  }));
}
