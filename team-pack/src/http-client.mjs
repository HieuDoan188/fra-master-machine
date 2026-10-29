// Guarded HTTP client: origin allowlist, no redirects, bounded time and size,
// per-origin cookie jar. Secrets never leave this module in results or errors.

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export function isLoopbackTestMode() {
  return process.env.MTM_PACK_ALLOW_LOOPBACK === '1';
}

export function normalizeOrigin(url) {
  const u = new URL(url);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol === 'https:') return u.origin;
  if (u.protocol === 'http:' && loopback && isLoopbackTestMode()) return u.origin;
  throw new Error(`ORIGIN_NOT_HTTPS: ${u.origin}`);
}

// Origin as it may appear in progress events (schema requires https). Loopback test origins log as null.
export function loggableOrigin(origin) {
  return origin.startsWith('https://') ? origin : null;
}

export class GuardedHttp {
  constructor() {
    this.allowedOrigins = new Set();
    this.cookies = new Map(); // origin -> Map(name -> value)
    this.secrets = new Set();
  }

  allow(origins) {
    for (const o of origins) this.allowedOrigins.add(normalizeOrigin(o));
  }

  registerSecret(s) {
    if (s) this.secrets.add(String(s));
  }

  redact(text) {
    let out = String(text ?? '');
    for (const s of this.secrets) if (s.length >= 4) out = out.split(s).join('[REDACTED]');
    return out;
  }

  clearCookies(origin) {
    this.cookies.delete(origin);
  }

  hasCookies(origin) {
    return (this.cookies.get(origin)?.size ?? 0) > 0;
  }

  async request(method, url, { json, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, withCookies = true } = {}) {
    const u = new URL(url);
    const origin = normalizeOrigin(u.href);
    if (!this.allowedOrigins.has(origin)) throw new Error(`ORIGIN_NOT_ALLOWED: ${origin}`);
    if (u.username || u.password) throw new Error('URL_CREDENTIALS_FORBIDDEN');

    // Same-origin Origin/Referer, as the match web page sends them: the game server rejects
    // POST /api/v1/auth/login without them (403 "Origin check failed").
    const h = { Accept: 'application/json', Origin: origin, Referer: `${origin}/`, ...headers };
    if (json !== undefined) h['Content-Type'] = 'application/json';
    const jar = this.cookies.get(origin);
    if (withCookies && jar?.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

    let res;
    try {
      res = await fetch(u, {
        method,
        headers: h,
        body: json === undefined ? undefined : JSON.stringify(json),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      return { ok: false, network: true, timeout, status: null, error: timeout ? 'TIMEOUT' : 'NETWORK_ERROR', origin, path: u.pathname };
    }

    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a)) || value === '';
      if (!this.cookies.has(origin)) this.cookies.set(origin, new Map());
      if (expired) this.cookies.get(origin).delete(name);
      else this.cookies.get(origin).set(name, value);
    }

    if (res.status >= 300 && res.status < 400) {
      return { ok: false, status: res.status, error: 'UNEXPECTED_REDIRECT', origin, path: u.pathname, requestId: res.headers.get('x-request-id') };
    }

    const reader = res.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          return { ok: false, status: res.status, error: 'RESPONSE_TOO_LARGE', origin, path: u.pathname };
        }
        chunks.push(value);
      }
    }
    const text = Buffer.concat(chunks).toString('utf8');
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (body === null && /^(event|data):/m.test(text)) {
      // Streamable-HTTP MCP may answer as server-sent events: take the last JSON data line.
      const data = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
      for (const d of data.reverse()) { try { body = JSON.parse(d); break; } catch { /* next */ } }
    }
    const requestId = res.headers.get('x-request-id') ?? body?.requestId ?? body?.error?.requestId ?? null;
    return {
      ok: res.ok,
      status: res.status,
      body,
      requestId,
      retryAfter: res.headers.get('retry-after'),
      idempotentReplay: res.headers.get('idempotent-replay') === 'true',
      mcpSessionId: res.headers.get('mcp-session-id'),
      origin,
      path: u.pathname,
    };
  }
}
